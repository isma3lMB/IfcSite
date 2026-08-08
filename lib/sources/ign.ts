import { AppError } from '@/lib/errors';
import { conformToTerrain, touchedFaces } from '@/lib/geo/conform';
import { MAX_GRID_N, gridSampler, gridSize } from '@/lib/geo/grid';
import { prismInto } from '@/lib/geo/mesh';
import { clipToBox, dedupe, densify } from '@/lib/geo/rings';
import { BUILDING_CAP, pushBuilding, pushRoadway } from '@/lib/scene/push';
import { LAYER_DZ, layerOpacity } from '@/lib/scene/stack';
import type { LayerKey } from '@/lib/i18n/keys';
import type {
  CutAccumulator,
  Grid,
  HeightSource,
  PropBag,
  SampleZ,
  SceneData,
  Site,
  SiteRect,
  StatusFn,
  ToGeo,
  ToLocal,
  Vec2,
  Vec3,
} from '@/lib/types';

/* =====================================================================
   IGN Géoplateforme — WFS vector layers and the RGE ALTI elevation service.
   Both send Access-Control-Allow-Origin:* and need no API key, so the whole
   thing stays client side. France only; OSM remains the worldwide path.
   ===================================================================== */

const GEOPF_WFS = 'https://data.geopf.fr/wfs/ows';
const GEOPF_ALTI = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json';

// Metropolitan France's actual extent: Bray-Dunes to southern Corsica,
// Ouessant to the Corsican east coast. Keep it tight — slack of even half a
// degree at the top puts London inside the box.
export const FR_BOUNDS = { minLat: 41.3, maxLat: 51.15, minLon: -5.2, maxLon: 9.6 };

export type IgnLayer = {
  type: string;
  geom: string;
  props: string[];
  label?: LayerKey;
  ifc?: string;
  color?: number;
  line?: boolean;
  /** Required for every entry in IGN_LAYERS (veg/hedge/water/parcel); the ad-hoc
   *  layer literals `wfs()` takes for buildings/roads don't need one since those
   *  compute their z elsewhere (lib/scene/push.ts). */
  dz?: number;
};

// geom field name differs between BD TOPO and the cadastre — confirmed against
// DescribeFeatureType, and PROPERTYNAME silently returns nothing if it is wrong.
export const IGN_LAYERS: Record<'veg' | 'hedge' | 'water' | 'parcel', IgnLayer> = {
  veg: {
    type: 'BDTOPO_V3:zone_de_vegetation',
    geom: 'geometrie',
    label: 'layer.vegetation',
    props: ['cleabs', 'nature'],
    ifc: 'VEGETATION',
    color: 0xc0d4b6,
    dz: LAYER_DZ.vegetation,
  },
  hedge: {
    type: 'BDTOPO_V3:haie',
    geom: 'geometrie',
    label: 'layer.hedges',
    props: ['cleabs', 'hauteur', 'largeur'],
    // Deliberately stronger than the vegetation fill it usually sits on: a hedge
    // is an object, not more park, and at this palette a pale green loses it.
    ifc: 'VEGETATION',
    color: 0x93c07e,
    line: true,
    dz: LAYER_DZ.hedge,
  },
  water: {
    type: 'BDTOPO_V3:surface_hydrographique',
    geom: 'geometrie',
    label: 'layer.water',
    props: ['cleabs', 'nature'],
    ifc: 'WATER',
    color: 0xa3c1d2,
    dz: LAYER_DZ.water,
  },
  parcel: {
    type: 'CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle',
    geom: 'geom',
    label: 'layer.parcels',
    props: ['idu', 'section', 'numero', 'contenance'],
    ifc: 'USERDEFINED',
    color: 0x6b6252,
    dz: LAYER_DZ.parcel,
  },
};

export type ThemeKey = keyof typeof IGN_LAYERS;

/**
 * Stable English names written into the IFC when a feature has no `nature` of
 * its own. Deliberately NOT translated: the exported file is a deliverable, and
 * its element names should not change depending on which language the page
 * happened to be in when the button was pressed.
 */
export const LAYER_IFC_NAME: Record<ThemeKey, string> = {
  veg: 'vegetation',
  hedge: 'hedges',
  water: 'water',
  parcel: 'parcels',
};

/** Vegetation rings are clipped to the site but still carry edges hundreds of
 * metres long; the drape needs stations to follow the ground between them. */
const VEG_STEP = 8;

// Every IGN request shares the drawn rectangle with the terrain grid, so
// surfaces and ground always cover the same extent.
// Axis order is lat,lon and the urn has to be repeated as a 5th element —
// with a bare EPSG:4326 the service swaps the axes and returns nothing.
const bboxParam = (b: SiteRect) =>
  `${b.minLat},${b.minLon},${b.maxLat},${b.maxLon},urn:ogc:def:crs:EPSG::4326`;

type GeoJsonGeometry =
  | { type: 'Point'; coordinates: number[] }
  | { type: 'MultiPoint' | 'LineString'; coordinates: number[][] }
  | { type: 'MultiLineString' | 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

type Feature = {
  id?: string;
  properties?: Record<string, string | number | null>;
  geometry?: GeoJsonGeometry | null;
};

// WFS hands back at most 5000 features per call; dense Paris at 900 m matches
// 6423 buildings, so paging is not optional.
async function wfs(layer: IgnLayer, box: SiteRect, cap = 10000): Promise<Feature[]> {
  const feats: Feature[] = [];
  let start = 0;
  for (;;) {
    const p = new URLSearchParams({
      SERVICE: 'WFS',
      VERSION: '2.0.0',
      REQUEST: 'GetFeature',
      TYPENAMES: layer.type,
      SRSNAME: 'urn:ogc:def:crs:EPSG::4326',
      BBOX: bboxParam(box),
      OUTPUTFORMAT: 'application/json',
      COUNT: '5000',
      STARTINDEX: String(start),
      PROPERTYNAME: layer.props.concat(layer.geom).join(','),
    });
    const res = await fetch(GEOPF_WFS + '?' + p);
    if (!res.ok) throw new AppError('err.ignWfsStatus', { layer: layer.type, status: res.status });
    const j = (await res.json()) as { features?: Feature[]; numberMatched?: number };
    const got = j.features || [];
    feats.push(...got);
    const matched = j.numberMatched;
    if (!got.length || feats.length >= cap || typeof matched !== 'number' || feats.length >= matched)
      break;
    start += got.length;
  }
  return feats;
}

/**
 * Every layer arrives as some mix of Point/LineString/Polygon/MultiPolygon.
 * Outer rings only, matching how the OSM relation path already drops holes.
 */
export function geoRings(g: GeoJsonGeometry | null | undefined): number[][][] {
  if (!g) return [];
  switch (g.type) {
    case 'Point':
      return [[g.coordinates]];
    case 'MultiPoint':
    case 'LineString':
      return [g.coordinates];
    case 'MultiLineString':
      return g.coordinates;
    case 'Polygon':
      return [g.coordinates[0]];
    case 'MultiPolygon':
      return g.coordinates.map((p) => p[0]);
    default:
      return [];
  }
}

/**
 * Drop-in replacement for terrariumGrid: same signature, same {verts,faces,
 * sample} shape. Terrarium is a mosaic of ~13 m tiles; RGE ALTI is a 1 m raster,
 * so the only thing between the caller and metre cells is the point budget.
 *
 * The service takes 5000 points per POST. Chunking up to ALTI_MAX_CHUNKS of them
 * is what lets the top accuracy level mean something: a single request caps a
 * 1 km site at ~14.5 m cells, which is coarser than the Terrarium path it is
 * supposed to improve on. The chunks go out sequentially — this is a free,
 * key-less public endpoint, and serialising also gives us something to report
 * while nine round trips are in flight.
 */
const ALTI_MAX = 5000;
const ALTI_MAX_CHUNKS = 9;

/** One post to the elevation service. Shared by the full grid and the single-point
 *  datum probe below, so both speak the service's one dialect. */
async function altiPost(lons: string[], lats: string[]): Promise<unknown[]> {
  // The service rejects real JSON booleans ("'' is not an accepted indent") and
  // 500s on form encoding — it wants JSON with the flags as strings.
  const res = await fetch(GEOPF_ALTI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lon: lons.join('|'),
      lat: lats.join('|'),
      resource: 'ign_rge_alti_wld',
      delimiter: '|',
      zonly: 'true',
      measures: 'false',
      indent: 'false',
    }),
  });
  if (!res.ok) throw new AppError('err.altiStatus', { status: res.status });
  const part = ((await res.json()) as { elevations?: unknown[] }).elevations;
  if (!Array.isArray(part) || part.length !== lons.length)
    throw new AppError('err.altiShortGrid');
  return part;
}

/** Off-coverage posts come back as a large negative sentinel rather than an error,
 *  so a plain Number() is not enough to tell a reading from a miss. */
const altiZ = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= -999 ? n : null;
};

/**
 * The site's ground elevation, from a single post at its centre.
 *
 * A scene needs a vertical datum even when the user has declined a terrain mesh:
 * BD TOPO hands out absolute NGF building bases either way, and with nothing to
 * hold the roads, the reference grid and the camera at the same altitude they all
 * sit at sea level while the buildings hang hundreds of metres overhead. One point
 * on a free, key-less endpoint is a cheap price for the two agreeing.
 */
export async function siteDatumZ(site: Site): Promise<number> {
  const [v] = await altiPost([site.lon.toFixed(6)], [site.lat.toFixed(6)]);
  const z = altiZ(v);
  if (z === null) throw new AppError('err.altiOutsideCoverage');
  return z;
}

export async function rgeAltiGrid(
  site: Site,
  toLocal: ToLocal,
  cell: number,
  onStatus: StatusFn,
): Promise<Grid> {
  const span = 2 * Math.max(site.halfX, site.halfY);
  const N = gridSize(span, cell, MAX_GRID_N);
  const box = site;
  const lats: string[] = [];
  const lons: string[] = [];
  const ll: [number, number][] = [];
  for (let j = 0; j <= N; j++)
    for (let i = 0; i <= N; i++) {
      const la = box.minLat + ((box.maxLat - box.minLat) * j) / N;
      const lo = box.minLon + ((box.maxLon - box.minLon) * i) / N;
      lats.push(la.toFixed(6));
      lons.push(lo.toFixed(6));
      ll.push([la, lo]);
    }
  const chunks = Math.ceil(ll.length / ALTI_MAX);
  // gridSize already clamps to ALTI_MAX_N, so this is a guard on the constants
  // agreeing with each other rather than on anything a caller can trigger.
  if (chunks > ALTI_MAX_CHUNKS) throw new AppError('err.altiGridTooLarge');

  const z: unknown[] = [];
  for (let c = 0; c < chunks; c++) {
    const from = c * ALTI_MAX;
    const to = Math.min(ll.length, from + ALTI_MAX);
    if (chunks > 1) onStatus('status.samplingAltiChunk', { done: c + 1, total: chunks });
    z.push(...(await altiPost(lons.slice(from, to), lats.slice(from, to))));
  }
  if (z.length !== ll.length) throw new AppError('err.altiShortGrid');

  // A few off-coverage posts are fine to patch; a mostly-empty grid means we are
  // outside the dataset.
  let bad = 0;
  const zs: (number | null)[] = z.map((v) => {
    const n = altiZ(v);
    if (n === null) bad++;
    return n;
  });
  if (bad > zs.length / 2) throw new AppError('err.altiOutsideCoverage');
  const mean = zs.reduce<number>((s, v) => (v === null ? s : s + v), 0) / Math.max(1, zs.length - bad);
  for (let i = 0; i < zs.length; i++) if (zs[i] === null) zs[i] = mean;
  const zn = zs as number[];

  const verts: Vec3[] = [];
  const faces: number[][] = [];
  for (let k = 0; k < ll.length; k++) {
    const p = toLocal(ll[k][1], ll[k][0]);
    verts.push([p[0], p[1], zn[k]]);
  }
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i;
      const b = a + 1;
      const c = a + N + 1;
      const d = c + 1;
      // Counter-clockwise in local metres, so the ground's normals point up
      // like every other surface in the scene. Wound the other way the export
      // is one inside-out mesh among right-side-out ones, and a viewer that
      // lights or culls by normal has to guess. Split on the b-c diagonal,
      // which is the same halving lib/geo/grid samples over.
      faces.push([a, b, c], [b, d, c]);
    }

  // Unlike Terrarium there is no raster left to re-query, so arbitrary lookups
  // interpolate the grid we already have — over the same triangles as `faces`,
  // so a sampled point sits exactly on the ground the viewer draws.
  return { n: N, verts, faces, sample: gridSampler(zn, N, box) };
}

/**
 * BD TOPO carries a surveyed hauteur on nearly every building, which is the
 * whole reason to prefer it over OSM's levels-times-three guess. The polygon Z
 * is the roof outline, not the ground, so the base comes from
 * altitude_minimale_sol instead (min_sol + hauteur == max polygon Z).
 */
export async function parseIGN(
  scene: SceneData,
  site: Site,
  toLocal: ToLocal,
  toGeo: ToGeo,
  sampleZ: SampleZ,
  fallbackH: number,
  wantRoads: boolean,
  onStatus: StatusFn,
): Promise<{ tagged: number; over: boolean; roadRings: Vec2[][] }> {
  const box = site;
  const inSite = (x: number, y: number) => Math.abs(x) <= site.halfX && Math.abs(y) <= site.halfY;
  let tagged = 0;
  let over = false;
  const roadRings: Vec2[][] = [];

  onStatus('status.fetchingIgnBuildings');
  const bat = await wfs(
    {
      type: 'BDTOPO_V3:batiment',
      geom: 'geometrie',
      props: [
        'cleabs',
        'hauteur',
        'altitude_minimale_sol',
        'nature',
        'usage_1',
        'nombre_d_etages',
        'identifiants_rnb',
      ],
    },
    box,
  );

  for (const f of bat) {
    if (scene.buildings.length >= BUILDING_CAP) {
      over = true;
      break;
    }
    const p = f.properties || {};
    let h = Number(p.hauteur);
    let src: HeightSource = 'ign:hauteur';
    if (!(h > 0)) {
      h = Number(p.nombre_d_etages) * 3;
      src = 'ign:etages';
    }
    if (!(h > 0)) {
      h = fallbackH;
      src = 'fallback';
    }
    for (const r of geoRings(f.geometry)) {
      const ring = r.map((c): Vec2 => toLocal(c[0], c[1]));
      if (ring.length < 4 || !ring.some((q) => inSite(q[0], q[1]))) continue;
      // Two traps here. Number(null) is 0 and finite, and BD TOPO returns an
      // explicit null on every building it has no surveyed ground altitude for —
      // testing the converted number planted all of those at sea level. And the
      // altitude is absolute NGF, which only means anything if the rest of the
      // scene is on that datum too; without one it would float above ground that
      // sampleZ has flattened to zero. So: check the property, then the datum.
      const abs = Number(p.altitude_minimale_sol);
      const baseZ =
        scene.datumZ !== null && p.altitude_minimale_sol != null && Number.isFinite(abs)
          ? abs
          : sampleZ(r[0][1], r[0][0]);
      // cleabs is BATIMENT0000000000162547 — unusable as a label, so the
      // editor gets the nature plus the significant tail, like OSM's ids.
      const tail = String(p.cleabs || f.id || '').replace(/^\D+0*/, '') || '?';
      const nature = p.nature ? String(p.nature) : '';
      const kind = nature && !/^Indifférenci/.test(nature) ? nature : 'Building';
      const props: PropBag = {
        ign_id: p.cleabs ? String(p.cleabs) : '',
        height_source: src,
        height_m: h,
        ...(p.nature ? { nature: String(p.nature) } : {}),
        ...(p.usage_1 ? { usage: String(p.usage_1) } : {}),
        ...(p.nombre_d_etages ? { storeys: Number(p.nombre_d_etages) } : {}),
        ...(p.identifiants_rnb ? { rnb_id: String(p.identifiants_rnb) } : {}),
      };
      const ok = pushBuilding(
        scene,
        ring,
        h,
        src,
        baseZ,
        String(p.cleabs || f.id || ''),
        `${kind} ${tail}`,
        props,
      );
      if (ok && src !== 'fallback') tagged++;
    }
  }

  if (wantRoads) {
    onStatus('status.fetchingIgnRoads');
    const rt = await wfs(
      {
        type: 'BDTOPO_V3:troncon_de_route',
        geom: 'geometrie',
        props: ['cleabs', 'largeur_de_chaussee', 'nombre_de_voies', 'nature'],
      },
      box,
    );
    for (const f of rt) {
      const p = f.properties || {};
      const w = Math.max(
        Number(p.largeur_de_chaussee) || (Number(p.nombre_de_voies) || 2) * 3.25,
        3,
      );
      for (const r of geoRings(f.geometry)) {
        // No inSite pre-test: pushRoadway clips to the box itself, which is both
        // stricter and less lossy than the some(inSite) that used to stand here.
        // That test kept a whole 5 km troncon for one vertex inside, and dropped
        // a road crossing the site cleanly with every vertex outside it — routine
        // on a small site, where a straight run spans the box in one segment.
        pushRoadway(roadRings, r.map((c): Vec2 => toLocal(c[0], c[1])), w, site);
      }
    }
  }
  return { tagged, over, roadRings };
}

/**
 * Vegetation / water / parcels all follow the same road: fetch, clip to the
 * site rectangle, then conform onto the terrain as a flat skin. Hedges are the
 * exception — they arrive as centrelines and get buffered into prisms that
 * keep their surveyed height.
 */
export async function fetchThemeLayer(
  scene: SceneData,
  key: ThemeKey,
  site: Site,
  toLocal: ToLocal,
  toGeo: ToGeo,
  sampleZ: SampleZ,
  layerName: string,
  cut?: CutAccumulator,
): Promise<number> {
  const L = IGN_LAYERS[key];
  const hx = site.halfX;
  const hy = site.halfY;
  const feats = await wfs(L, site);
  const hedge: { verts: Vec3[]; faces: number[][] } = { verts: [], faces: [] };
  // Distinguishes vegetation/water/parcel/hedge for the viewer's render-order
  // tiers, since `L.ifc` alone can't (vegetation and hedges both say VEGETATION).
  const layer = key === 'veg' ? 'vegetation' : key;
  // Only a layer you cannot see through may take the ground out from under
  // itself — a cadastral overlay is meant to be read against the terrain.
  // Tallied per layer and merged by max at the end: two neighbouring water
  // bodies each taking part of a face should add up, but water lying over
  // vegetation must not, or their two partial claims would sum into a hole.
  const mine = cut && layerOpacity(layer) >= 1 ? new Map<number, number>() : undefined;
  const mineRings: Vec2[][] = [];
  let n = 0;

  // Every vertex of every prism gets its own elevation, so the base follows the
  // terrain instead of taking one arbitrary corner's height for a hedge that
  // can run hundreds of metres.
  const groundAt = (p: Vec2): number => {
    const g = toGeo(p[0], p[1]);
    return sampleZ(g[1], g[0]) + L.dz!;
  };

  for (const f of feats) {
    const p = f.properties || {};
    const props: PropBag = {};
    for (const k of L.props)
      if (p[k] !== null && p[k] !== undefined && p[k] !== '') props[k] = p[k] as string | number;

    for (const r of geoRings(f.geometry)) {
      let ring = r.map((c): Vec2 => toLocal(c[0], c[1]));
      if (L.line) {
        // Hedges arrive as centrelines. Buffer each segment the way roads are
        // buffered, but merge every segment of every hedge into one faceset: a
        // single hedge is dozens of segments, and one IFC element apiece would
        // outnumber the buildings for no gain.
        // hauteur is surveyed, so hedges keep their real height; only the base
        // is corrected. Densifying first keeps each buffered quad short enough
        // for its four corner samples to track the ground.
        const w = Math.max(Number(p.largeur) || 1.5, 0.8);
        const h = Math.max(Number(p.hauteur) || 3, 0.5);
        ring = densify(ring, VEG_STEP);
        for (let i = 0; i < ring.length - 1; i++) {
          const [x1, y1] = ring[i];
          const [x2, y2] = ring[i + 1];
          const dx = x2 - x1;
          const dy = y2 - y1;
          const Ln = Math.hypot(dx, dy);
          if (Ln < 0.5) continue;
          const nx = (-dy / Ln) * (w / 2);
          const ny = (dx / Ln) * (w / 2);
          const quad = clipToBox(
            [
              [x1 + nx, y1 + ny],
              [x1 - nx, y1 - ny],
              [x2 - nx, y2 - ny],
              [x2 + nx, y2 + ny],
            ],
            -hx,
            -hy,
            hx,
            hy,
          );
          if (quad.length < 3) continue;
          prismInto(quad, groundAt, h, hedge.verts, hedge.faces);
          n++;
        }
        continue;
      }

      ring = clipToBox(dedupe(ring), -hx, -hy, hx, hy);
      if (ring.length < 3) continue;
      // Cut on the terrain's own triangles before draping. Elevation is only
      // ever looked up at vertices and the triangulator adds none, so a river
      // or a forest spanning the site used to come back as a few huge
      // triangles stretched between its boundary elevations — a tilted plane
      // through the hillside and through every layer above it. Conforming is
      // what makes the centimetre offsets in lib/scene/stack decide the order.
      const { verts, faces } = conformToTerrain(ring, scene.terrain, toGeo, sampleZ, L.dz!, mine);
      if (!faces.length) continue;
      if (mine) mineRings.push(ring);
      scene.surfaces.push({
        verts,
        faces,
        color: L.color,
        type: L.ifc!,
        layer,
        props,
        name: p.nature ? String(p.nature) : p.idu ? String(p.idu) : layerName,
      });
      n++;
    }
  }

  if (hedge.faces.length)
    scene.surfaces.push({
      ...hedge,
      color: L.color,
      type: L.ifc!,
      layer,
      name: `${layerName} (BD TOPO)`,
    });

  if (cut && mine) {
    for (const rr of mineRings) {
      cut.rings.push(rr);
      for (const f of touchedFaces(rr, scene.terrain)) cut.touched.add(f);
    }
    for (const [k, v] of mine) cut.coverage.set(k, Math.max(cut.coverage.get(k) ?? 0, v));
  }
  return n;
}
