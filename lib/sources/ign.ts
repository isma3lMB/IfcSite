import type { Tunables } from '@/lib/build/tunables';
import { AppError } from '@/lib/errors';
import { clipPolygonToRect, type SplitPolygon } from '@/lib/geo/boolean';
import { conformToTerrain } from '@/lib/geo/conform';
import { gridFrom, gridLattice, gridSize } from '@/lib/geo/grid';
import { prismInto, skirtInto } from '@/lib/geo/mesh';
import { rectArea, sameRect } from '@/lib/geo/rect';
import { clipToBox, dedupe, densify } from '@/lib/geo/rings';
import {
  ALTI_MAX as ALTI_MEMO_MAX,
  DATUM_MAX,
  RegionCache,
  altiMemo,
  datumMemo,
  memo,
  trimMemo,
} from '@/lib/sources/cache';
import { pushBuilding, pushRoadway } from '@/lib/scene/push';
import { LAYER_DZ, SURFACE_COLOR, skirtDepth, type SkirtLayer } from '@/lib/scene/stack';
import type { LayerKey } from '@/lib/i18n/keys';
import type {
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

// A rectangle can straddle the border, so every corner has to be inside.
export function isOutsideFrance(rect: SiteRect): boolean {
  return (
    rect.minLat < FR_BOUNDS.minLat ||
    rect.maxLat > FR_BOUNDS.maxLat ||
    rect.minLon < FR_BOUNDS.minLon ||
    rect.maxLon > FR_BOUNDS.maxLon
  );
}

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
    color: SURFACE_COLOR.vegetation,
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
    color: SURFACE_COLOR.hedge,
    line: true,
    dz: LAYER_DZ.hedge,
  },
  water: {
    type: 'BDTOPO_V3:surface_hydrographique',
    geom: 'geometrie',
    label: 'layer.water',
    props: ['cleabs', 'nature'],
    ifc: 'WATER',
    color: SURFACE_COLOR.water,
    dz: LAYER_DZ.water,
  },
  parcel: {
    type: 'CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle',
    geom: 'geom',
    label: 'layer.parcels',
    props: ['idu', 'section', 'numero', 'contenance'],
    ifc: 'USERDEFINED',
    color: SURFACE_COLOR.parcel,
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

/* Vegetation rings are clipped to the site but still carry edges hundreds of
   metres long; the drape needs stations to follow the ground between them. That
   spacing is `tune.conformStep` — the same number the conform itself uses, which
   is what the old VEG_STEP was already set to by hand. */

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

/** GeoJSON positions in a coordinate tree of any nesting depth. */
const countCoords = (c: unknown): number =>
  Array.isArray(c)
    ? typeof c[0] === 'number'
      ? 1
      : (c as unknown[]).reduce<number>((s, v) => s + countCoords(v), 0)
    : 0;

const estWfs = (fs: Feature[]): number =>
  fs.length * 300 + fs.reduce((s, f) => s + countCoords(f.geometry?.coordinates ?? []), 0) * 80;

/**
 * One cache for every BD TOPO and cadastre layer, namespaced by TYPENAMES and
 * PROPERTYNAME together: the service returns only the attributes it was asked
 * for, so the same layer requested with two property lists is two different
 * payloads and must not collide.
 *
 * Every consumer of `wfs` is already superset-safe — parseIGN tests inSite,
 * pushRoadway clips, and fetchThemeLayer clips every ring — so unlike the OSM
 * path this needed no filtering work to be handed a wider rectangle.
 *
 * Identity falls back through the three things a BD TOPO or cadastre feature can
 * be named by, because no one of them is universal: `cleabs` is absent from the
 * parcel layer, which carries `idu` instead, and neither is guaranteed to be in
 * PROPERTYNAME for a layer whose props list did not ask for it.
 *
 * Returning null when all three are missing is what stops the dedupe from
 * collapsing every anonymous feature into one — see `put`. Such a payload is
 * used but never stored.
 */
const ignCache = new RegionCache<Feature>((f) => {
  const p = f.properties || {};
  const id = f.id ?? p.cleabs ?? p.idu;
  return id == null || id === '' ? null : String(id);
}, estWfs);

const wfsQuery = async (layer: IgnLayer, box: SiteRect, cap: number): Promise<Feature[]> => {
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
};

// WFS hands back at most 5000 features per call; dense Paris at 900 m matches
// 6423 buildings, so paging is not optional.
async function wfs(
  layer: IgnLayer,
  box: SiteRect,
  cap = 10000,
  onStatus?: StatusFn,
): Promise<Feature[]> {
  const ns = layer.type + '|' + [...layer.props].sort().join(',');
  const p = ignCache.plan(ns, box, ['*']);
  if (p.hit) {
    onStatus?.('status.reusingData');
    return p.have;
  }

  // The cap is a feature budget over an area, so a padded box has to be allowed
  // proportionally more of it. Left as it was, a grown rectangle could truncate
  // where the drawn one would not have, and the features lost would be real ones
  // inside the site.
  const scaled = (r: SiteRect): number =>
    Math.ceil(cap * Math.max(1, rectArea(r) / rectArea(box)));

  const run = async (rects: SiteRect[], cover: SiteRect, seed: Feature[]): Promise<Feature[]> => {
    const got = [...seed];
    let full = true;
    for (const r of rects) {
      const c = scaled(r);
      const part = await wfsQuery(layer, r, c);
      // A run that stopped at its cap is a truncation, not an answer. Use it
      // once — the drawn box may well be complete within it — but never store
      // it, or every later build inherits the hole.
      if (part.length >= c) full = false;
      got.push(...part);
    }
    return ignCache.put(ns, cover, ['*'], got, full);
  };

  try {
    return await run(p.fetch, p.cover, p.have);
  } catch (e) {
    // Same reasoning as the Overpass path: a padded or split request must not be
    // what turns a working build into a failed one.
    if (p.fetch.length === 1 && sameRect(p.fetch[0], box)) throw e;
    return run([box], box, []);
  }
}

/** One outer ring with the inner rings belonging to it, in source lon/lat. */
export type GeoPart = { ring: number[][]; holes: number[][][] };

/**
 * Every layer arrives as some mix of Point/LineString/Polygon/MultiPolygon.
 * One part per polygon, carrying its inner rings alongside the outer — an
 * island in a river, a clearing in a forest.
 *
 * Those used to be dropped here, and dropping them is not the harmless
 * simplification it reads as: the flat layers are opaque solids that ENCLOSE
 * whatever they cover (see lib/scene/stack), so a hole thrown away at ingest
 * takes the island's ground, its streets and its buildings with it rather than
 * merely tinting them. The Seine paved over Ile Saint-Louis. Everything
 * downstream — triangulate and skirtInto in lib/geo/mesh, conformToTerrain in
 * lib/geo/conform — has taken holes since roads started arriving as unioned
 * ribbons with roundabouts in them, so carrying them here was the whole fix.
 *
 * The point and line cases carry no holes by construction, which is why the
 * centreline callers can stay on geoRings below.
 */
export function geoParts(g: GeoJsonGeometry | null | undefined): GeoPart[] {
  const open = (rings: number[][][]): GeoPart[] => rings.map((ring) => ({ ring, holes: [] }));
  if (!g) return [];
  switch (g.type) {
    case 'Point':
      return open([[g.coordinates]]);
    case 'MultiPoint':
    case 'LineString':
      return open([g.coordinates]);
    case 'MultiLineString':
      return open(g.coordinates);
    case 'Polygon':
      return [{ ring: g.coordinates[0], holes: g.coordinates.slice(1) }];
    case 'MultiPolygon':
      return g.coordinates.map((p) => ({ ring: p[0], holes: p.slice(1) }));
    default:
      return [];
  }
}

/** Outer rings alone, for the callers that never meet a hole: building
 *  footprints, road and rail centrelines. */
export const geoRings = (g: GeoJsonGeometry | null | undefined): number[][][] =>
  geoParts(g).map((p) => p.ring);

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
  const lon = site.lon.toFixed(6);
  const lat = site.lat.toFixed(6);
  // Hits on every rebuild of a site that has not moved, which is the common one.
  return memo(datumMemo, lon + ',' + lat, async () => {
    const [v] = await altiPost([lon], [lat]);
    const z = altiZ(v);
    if (z === null) throw new AppError('err.altiOutsideCoverage');
    trimMemo(datumMemo, DATUM_MAX);
    return z;
  });
}

export async function rgeAltiGrid(
  site: Site,
  toLocal: ToLocal,
  cell: number,
  onStatus: StatusFn,
  tune: Tunables,
): Promise<Grid> {
  const span = 2 * Math.max(site.halfX, site.halfY);
  const N = gridSize(span, cell, tune.maxGridN);
  const box = site;

  // The heights, and not the nine chunk payloads they were assembled from —
  // those ARE this array, and keeping both would store the same numbers twice.
  //
  // Keyed exactly, with no area reuse, because none is available: the lattice is
  // a pure function of (box, N) — see gridLattice in lib/geo/grid — so a smaller
  // rectangle's sample points are not a subset of a larger one's. An unmoved
  // rebuild at the same accuracy is the hit, and it is worth up to nine
  // sequential posts.
  //
  // Float32 resolves the highest ground in France to about half a millimetre;
  // Float64 would be storing noise.
  const key = `${box.minLat},${box.minLon},${box.maxLat},${box.maxLon}|${N}`;
  if (altiMemo.has(key)) onStatus('status.reusingData');
  const zn = await memo(altiMemo, key, async () => {
    const ll = gridLattice(box, N);
    const lats = ll.map(([la]) => la.toFixed(6));
    const lons = ll.map(([, lo]) => lo.toFixed(6));
    const chunks = Math.ceil(ll.length / ALTI_MAX);
    // gridSize clamps to tune.maxGridN, whose own ceiling — MAX_GRID_N, pinned in
    // TUNE_RANGE — is the largest N these two constants can pay for. So this stays
    // a guard on the constants agreeing with each other rather than on anything a
    // caller, or the options panel, can trigger.
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
    const mean =
      zs.reduce<number>((s, v) => (v === null ? s : s + v), 0) / Math.max(1, zs.length - bad);
    for (let i = 0; i < zs.length; i++) if (zs[i] === null) zs[i] = mean;
    trimMemo(altiMemo, ALTI_MEMO_MAX);
    return Float32Array.from(zs as number[]);
  });

  // Unlike Terrarium there is no raster left to re-query, so arbitrary lookups
  // interpolate the grid we already have — over the same triangles as `faces`,
  // so a sampled point sits exactly on the ground the viewer draws. gridFrom
  // builds both off the one lattice these heights were read on.
  return gridFrom(box, N, Array.from(zn), toLocal);
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
  wantBuildings: boolean,
  wantRoads: boolean,
  wantRailways: boolean,
  onStatus: StatusFn,
  tune: Tunables,
): Promise<{
  tagged: number;
  over: boolean;
  roadRibbons: SplitPolygon[];
  railwayRibbons: SplitPolygon[];
}> {
  const box = site;
  const inSite = (x: number, y: number) => Math.abs(x) <= site.halfX && Math.abs(y) <= site.halfY;
  let tagged = 0;
  let over = false;
  const roadRibbons: SplitPolygon[] = [];
  const railwayRibbons: SplitPolygon[] = [];

  if (wantBuildings) {
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
      undefined,
      onStatus,
    );

    for (const f of bat) {
      if (scene.buildings.length >= tune.buildingCap) {
        over = true;
        break;
      }
      const p = f.properties || {};
      let h = Number(p.hauteur);
      let src: HeightSource = 'ign:hauteur';
      if (!(h > 0)) {
        h = Number(p.nombre_d_etages) * tune.storeyHeight;
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
      undefined,
      onStatus,
    );
    for (const f of rt) {
      const p = f.properties || {};
      const w = Math.max(
        Number(p.largeur_de_chaussee) || (Number(p.nombre_de_voies) || 2) * tune.laneWidth,
        3,
      );
      for (const r of geoRings(f.geometry)) {
        // No inSite pre-test: pushRoadway clips to the box itself, which is both
        // stricter and less lossy than the some(inSite) that used to stand here.
        // That test kept a whole 5 km troncon for one vertex inside, and dropped
        // a road crossing the site cleanly with every vertex outside it — routine
        // on a small site, where a straight run spans the box in one segment.
        pushRoadway(roadRibbons, r.map((c): Vec2 => toLocal(c[0], c[1])), w, site);
      }
    }
  }

  if (wantRailways) {
    onStatus('status.fetchingIgnRailways');
    const rf = await wfs(
      {
        type: 'BDTOPO_V3:troncon_de_voie_ferree',
        geom: 'geometrie',
        props: ['cleabs', 'nature', 'nombre_de_voies', 'largeur', 'electrifie'],
      },
      box,
      undefined,
      onStatus,
    );
    for (const f of rf) {
      const p = f.properties || {};
      // `largeur` on this layer is a categorical string, not a metre value —
      // size from track count instead, same as roads size from lane count.
      const w = Math.max(
        (Number(p.nombre_de_voies) || 1) * tune.railTrackWidth,
        tune.railTrackWidth,
      );
      for (const r of geoRings(f.geometry)) {
        pushRoadway(railwayRibbons, r.map((c): Vec2 => toLocal(c[0], c[1])), w, site);
      }
    }
  }

  return { tagged, over, roadRibbons, railwayRibbons };
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
  tune: Tunables,
  onStatus?: StatusFn,
): Promise<number> {
  const L = IGN_LAYERS[key];
  const hx = site.halfX;
  const hy = site.halfY;
  const feats = await wfs(L, site, undefined, onStatus);
  const hedge: { verts: Vec3[]; faces: number[][] } = { verts: [], faces: [] };
  // Distinguishes vegetation/water/parcel/hedge for the viewer's render-order
  // tiers, since `L.ifc` alone can't (vegetation and hedges both say VEGETATION).
  const layer = key === 'veg' ? 'vegetation' : key;
  // Which of the opaque flat drapes this is, if it is one. Named rather than
  // looked up through a cast: a parcel is a cadastral tint meant to be read
  // through, and a hedge never reaches the drape below — it takes the `L.line`
  // branch and is already extruded as a real prism — so neither is a
  // SkirtLayer, and a cast would quietly hand back undefined instead of
  // saying so.
  const solid: SkirtLayer | undefined =
    layer === 'vegetation' || layer === 'water' ? layer : undefined;
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

    for (const part of geoParts(f.geometry)) {
      let ring = part.ring.map((c): Vec2 => toLocal(c[0], c[1]));
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
        ring = densify(ring, tune.conformStep);
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

      const holes = part.holes.map((h) => dedupe(h.map((c): Vec2 => toLocal(c[0], c[1]))));
      // Two clippers on purpose. With no holes the site box is four half-planes
      // and Sutherland-Hodgman is the whole job, which is what all but a handful
      // of features take. With holes the outer and the holes have to be cut
      // TOGETHER — see clipPolygonToRect — so an island straddling the site edge
      // does not come back touching the boundary.
      const pieces = holes.length
        ? clipPolygonToRect({ outer: dedupe(ring), holes }, -hx, -hy, hx, hy)
        : [{ outer: clipToBox(dedupe(ring), -hx, -hy, hx, hy), holes: [] }];

      for (const piece of pieces) {
        if (piece.outer.length < 3) continue;
        // Cut on the terrain's own triangles before draping. Elevation is only
        // ever looked up at vertices and the triangulator adds none, so a river
        // or a forest spanning the site used to come back as a few huge
        // triangles stretched between its boundary elevations — a tilted plane
        // through the hillside and through every layer above it. Conforming is
        // what makes the centimetre offsets in lib/scene/stack decide the order.
        // The holes ride along and are cut with it; a sub-centimetre one is
        // dropped there rather than here, by the same guard the road union needs.
        const { verts, faces } = conformToTerrain(
          piece.outer,
          scene.terrain,
          toGeo,
          sampleZ,
          L.dz!,
          piece.holes,
          tune.conformStep,
        );
        if (!faces.length) continue;
        // Close the drape into a solid that reaches under the terrain, so the
        // layer is a grounded slab rather than a skin hovering over the ground
        // it covers — and so anything below it in the stack ends up enclosed
        // rather than merely a few centimetres lower. See lib/scene/stack.
        // An island's rim is walled the same way: skirtInto reads the outline
        // back off the triangulation and tells a hole from a surface by signed
        // area, so it needs to be told nothing about them.
        if (solid) skirtInto(verts, faces, skirtDepth(solid));
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
  }

  if (hedge.faces.length)
    scene.surfaces.push({
      ...hedge,
      color: L.color,
      type: L.ifc!,
      layer,
      name: `${layerName} (BD TOPO)`,
    });

  return n;
}
