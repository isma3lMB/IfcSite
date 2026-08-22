import type { Tunables } from '@/lib/build/tunables';
import { AppError } from '@/lib/errors';
import type { SplitPolygon } from '@/lib/geo/boolean';
import { sameRect } from '@/lib/geo/rect';
import { RegionCache } from '@/lib/sources/cache';
import { pushBuilding, pushRoadway } from '@/lib/scene/push';
import { LAYER_DZ } from '@/lib/scene/stack';
import { newXf } from '@/lib/scene/xf';
import type {
  HeightSource,
  PropBag,
  SampleZ,
  SceneData,
  Site,
  SiteRect,
  StatusFn,
  ToLocal,
  Tree,
  Vec2,
} from '@/lib/types';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const ROADS =
  'motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|pedestrian|service';

// Surface rail only — subway is normally underground infrastructure, and
// disused/abandoned track is not really "there" for a site context model.
const RAILWAYS = 'rail|light_rail|tram|narrow_gauge|funicular|monorail';

/**
 * The query's own `[out:json][timeout:N]` only binds the server's own work. A
 * mirror that is overloaded sits on the connection and 504s much later, so
 * without a client deadline three wedged mirrors can stall a build for minutes —
 * twice over now that trees are a second round trip.
 *
 * The two used to be written down separately (45 s here, 40 s in the query) and
 * had to be edited together to stay coherent. Deriving one from the other makes
 * that structural: the server is asked to give up first, by a margin, so a slow
 * mirror answers "I could not" rather than being cut off mid-sentence.
 */
const serverSecs = (t: Tunables): number =>
  Math.max(10, Math.round(t.overpassTimeoutMs / 1000) - 5);

type OverpassGeom = { lat: number; lon: number };
type OverpassElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: OverpassGeom[];
  members?: { role?: string; geometry?: OverpassGeom[] }[];
};
type OverpassResponse = { elements: OverpassElement[] };

async function overpassQuery(
  q: string,
  tune: Tunables,
  onStatus?: StatusFn,
): Promise<OverpassResponse> {
  let lastErr: AppError | undefined;
  for (const url of ENDPOINTS) {
    const host = url.split('/')[2];
    // Each mirror is given the full timeout before the next is tried, so a bad
    // day here is three of them end to end under one unchanging sentence. Naming
    // the host is what separates "still going" from "hung".
    onStatus?.('status.overpassMirror', { host });
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(tune.overpassTimeoutMs),
      });
      if (!res.ok) throw new AppError('err.overpassStatus', { host, status: res.status });
      return (await res.json()) as OverpassResponse;
    } catch (e) {
      lastErr =
        e instanceof Error && e.name === 'TimeoutError'
          ? new AppError('err.overpassTimeout', { host })
          : e instanceof AppError
            ? e
            : new AppError('err.overpassStatus', { host, status: String(e) });
    }
  }
  throw new AppError('err.overpassAllRefused', { detail: lastErr ? lastErr.code : '' });
}

// Overpass takes the drawn rectangle straight as a bbox filter (south,west,
// north,east) — the site is no longer a circle around a point.
const overpassBox = (b: SiteRect) => `${b.minLat},${b.minLon},${b.maxLat},${b.maxLon}`;

/* =====================================================================
   Session reuse. Both queries below go through one cache, which may hand back a
   payload fetched for a WIDER rectangle than the one being asked about — see
   lib/sources/cache. That is what the site filters underneath are for.
   ===================================================================== */

const estOverpass = (els: OverpassElement[]): number => {
  let pts = 0;
  for (const el of els) {
    pts += el.geometry?.length ?? 1;
    if (el.members) for (const m of el.members) pts += m.geometry?.length ?? 0;
  }
  // ~200 B for the element and its tag map, ~48 B for a two-property {lat,lon}.
  // Within a factor of two is fine: this is a safety valve, not an invoice.
  return els.length * 200 + pts * 48;
};

/** One cache for both queries. A buildings entry can never answer a tree
 *  question — the kinds test sees to that — so they share a namespace safely and
 *  share the byte budget usefully. */
const osmCache = new RegionCache<OverpassElement>((el) => `${el.type}/${el.id}`, estOverpass);

/**
 * Is this way part of the site?
 *
 * A NO-OP on a response fetched at exactly this rectangle, which is what makes
 * it safe to add. Overpass's `(bbox)` filter on a way selects ways with at least
 * one NODE inside the box, so the first clause is the predicate the server
 * already applied and every element of an exact response passes it.
 *
 * It earns its keep on a cached SUPERSET, where without it a padded fetch would
 * plant buildings from outside the drawn rectangle. The second clause is what
 * keeps a building large enough to enclose the whole site, all of whose vertices
 * sit out in the padding ring — Overpass cannot return one of those from an
 * exact fetch either, so that clause is a no-op today as well.
 *
 * Tested in lat/lon against the drawn rectangle rather than in local metres
 * against ±halfX/±halfY. Those half-extents are taken from the outermost
 * projected corner (see Site in lib/types), which makes the local box slightly
 * WIDER than what was drawn — close enough for parseIGN's purposes, but not the
 * same predicate as Overpass's, and matching Overpass exactly is the whole
 * argument that this changes nothing.
 */
const geomInSite = (g: OverpassGeom[], s: SiteRect): boolean => {
  let nLat = 90;
  let xLat = -90;
  let nLon = 180;
  let xLon = -180;
  for (const p of g) {
    if (p.lat >= s.minLat && p.lat <= s.maxLat && p.lon >= s.minLon && p.lon <= s.maxLon)
      return true;
    if (p.lat < nLat) nLat = p.lat;
    if (p.lat > xLat) xLat = p.lat;
    if (p.lon < nLon) nLon = p.lon;
    if (p.lon > xLon) xLon = p.lon;
  }
  return nLat <= s.minLat && xLat >= s.maxLat && nLon <= s.minLon && xLon >= s.maxLon;
};

/** The point case, where "inside the box" is the whole test. */
const nodeInSite = (lat: number, lon: number, s: SiteRect): boolean =>
  lat >= s.minLat && lat <= s.maxLat && lon >= s.minLon && lon <= s.maxLon;

const mainQuery = (
  b: SiteRect,
  wantBuildings: boolean,
  wantRoads: boolean,
  wantRailways: boolean,
  tune: Tunables,
): string => {
  const bb = overpassBox(b);
  return `[out:json][timeout:${serverSecs(tune)}];(
    ${wantBuildings ? `way["building"](${bb});` : ''}
    ${wantBuildings ? `relation["building"]["type"="multipolygon"](${bb});` : ''}
    ${wantRoads ? `way["highway"~"^(${ROADS})$"](${bb});` : ''}
    ${wantRailways ? `way["railway"~"^(${RAILWAYS})$"](${bb});` : ''}
  );out geom;`;
};

export async function overpass(
  box: SiteRect,
  wantBuildings: boolean,
  wantRoads: boolean,
  wantRailways: boolean,
  tune: Tunables,
  onStatus?: StatusFn,
): Promise<OverpassResponse> {
  // What a stored payload has to carry to answer this. A buildings+roads
  // response answers a buildings-only question, because parseOSM is told
  // wantRoads=false and never looks at them.
  const kinds = [
    ...(wantBuildings ? ['building'] : []),
    ...(wantRoads ? ['highway'] : []),
    ...(wantRailways ? ['railway'] : []),
  ];
  const p = osmCache.plan('main', box, kinds);
  if (p.hit) {
    onStatus?.('status.reusingData');
    return { elements: p.have };
  }

  const q = (r: SiteRect) => mainQuery(r, wantBuildings, wantRoads, wantRailways, tune);
  try {
    const got = [...p.have];
    for (const r of p.fetch) got.push(...(await overpassQuery(q(r), tune, onStatus)).elements);
    return { elements: osmCache.put('main', p.cover, kinds, got) };
  } catch (e) {
    // Padding is an optimisation and must never be the reason a build fails. A
    // grown box is up to 44% more area, which on a dense site is enough to tip a
    // mirror into a timeout the drawn box would have survived — so pay for one
    // more round trip rather than hand back an error. Nothing to retry if what
    // was already attempted WAS the drawn rectangle.
    if (p.fetch.length === 1 && sameRect(p.fetch[0], box)) throw e;
    const got = (await overpassQuery(q(box), tune, onStatus)).elements;
    return { elements: osmCache.put('main', box, kinds, got) };
  }
}

// Individual trees are the one thing IGN has no national layer for — BD TOPO
// stops at vegetation polygons — so this stays on OSM under both providers, and
// tune.treeCap binds whichever one is selected.
export async function osmTrees(
  box: SiteRect,
  toLocal: ToLocal,
  sampleZ: SampleZ,
  tune: Tunables,
  onStatus?: StatusFn,
): Promise<Tree[]> {
  // Fetch and parse are separated here for the cache's sake: what is worth
  // keeping is the OSM nodes, not the Tree[] built from them, because every
  // field of a Tree past its tags comes from toLocal and sampleZ — the CRS and
  // the terrain, which change without OSM changing.
  const q = (r: SiteRect) =>
    `[out:json][timeout:${serverSecs(tune)}];node["natural"="tree"](${overpassBox(r)});out geom;`;
  const p = osmCache.plan('trees', box, ['tree']);
  let els: OverpassElement[];
  if (p.hit) {
    onStatus?.('status.reusingData');
    els = p.have;
  } else {
    try {
      const got = [...p.have];
      for (const r of p.fetch) got.push(...(await overpassQuery(q(r), tune)).elements);
      els = osmCache.put('trees', p.cover, ['tree'], got);
    } catch (e) {
      if (p.fetch.length === 1 && sameRect(p.fetch[0], box)) throw e;
      els = osmCache.put('trees', box, ['tree'], (await overpassQuery(q(box), tune)).elements);
    }
  }

  const out: Tree[] = [];
  for (const el of els) {
    if (el.type !== 'node' || el.lat === undefined || el.lon === undefined) continue;
    // Above the cap, not below it: on a superset payload the out-of-site nodes
    // come in the same arbitrary order as the rest, and testing after the break
    // would spend the budget on trees the site never gets to keep.
    if (!nodeInSite(el.lat, el.lon, box)) continue;
    const t = el.tags || {};
    const [x, y] = toLocal(el.lon, el.lat);
    const h = Math.min(parseFloat(t.height) || 8, 60);
    const crown = parseFloat(t.diameter_crown);
    const circ = parseFloat(t.circumference);
    out.push({
      id: 'osm-node/' + el.id,
      x,
      y,
      // Trees are the top of the stack, so a trunk foot clears the road ribbon
      // it stands beside instead of being crossed by it. See lib/scene/stack.
      z: sampleZ(el.lat, el.lon) + LAYER_DZ.tree,
      h,
      cr: Math.max(crown > 0 ? crown / 2 : Math.min(2.5, h * 0.32), 0.4),
      tr: Math.max(circ > 0 ? circ / Math.PI / 2 : 0.15, 0.06),
      name: t.species || t.genus || 'Tree',
      props: {
        osm_id: 'node/' + el.id,
        height_m: h,
        ...(t.species ? { species: t.species } : {}),
        ...(t.genus ? { genus: t.genus } : {}),
        ...(t.leaf_type ? { leaf_type: t.leaf_type } : {}),
      },
      xf: newXf(),
      src: 'osm',
    });
    if (out.length >= tune.treeCap) break;
  }
  return out;
}

export function parseHeight(
  tags: Record<string, string>,
  fallback: number,
  storeyHeight: number,
): [number, HeightSource] {
  const h = tags.height || tags['building:height'];
  if (h) {
    const v = parseFloat(String(h).replace(/[^\d.]/g, ''));
    if (v > 0) return [v, 'tag:height'];
  }
  const l = tags['building:levels'];
  if (l) {
    const v = parseFloat(l);
    if (v > 0) return [v * storeyHeight, 'tag:levels'];
  }
  return [fallback, 'fallback'];
}

/** Returns how many buildings arrived with a real height tag. */
export function parseOSM(
  scene: SceneData,
  data: OverpassResponse,
  site: Site,
  toLocal: ToLocal,
  sampleZ: SampleZ,
  fallbackH: number,
  wantBuildings: boolean,
  wantRoads: boolean,
  wantRailways: boolean,
  tune: Tunables,
): { tagged: number; roadRibbons: SplitPolygon[]; railwayRibbons: SplitPolygon[] } {
  let tagged = 0;
  if (wantBuildings) {
    const rings: [OverpassGeom[], Record<string, string>, number][] = [];
    for (const el of data.elements) {
      if (el.tags && el.tags.building) {
        // Filtered as the rings are collected rather than as they are pushed, so
        // that a reused superset cannot spend tune.buildingCap slots below on
        // footprints outside the site. Same ordering parseIGN already keeps.
        if (el.type === 'way' && el.geometry) {
          if (geomInSite(el.geometry, site)) rings.push([el.geometry, el.tags, el.id]);
        } else if (el.type === 'relation' && el.members) {
          for (const m of el.members)
            if (m.role === 'outer' && m.geometry && geomInSite(m.geometry, site))
              rings.push([m.geometry, el.tags, el.id]);
        }
      }
    }
    for (const [geom, tags, id] of rings) {
      if (scene.buildings.length >= tune.buildingCap) break;
      const ring = geom.map((p) => toLocal(p.lon, p.lat));
      if (ring.length < 4) continue;
      const [h, src] = parseHeight(tags, fallbackH, tune.storeyHeight);
      const props: PropBag = { osm_id: 'way/' + id, height_source: src, height_m: h };
      const ok = pushBuilding(
        scene,
        ring,
        h,
        src,
        sampleZ(geom[0].lat, geom[0].lon),
        'way/' + id,
        tags.name || `Building ${id}`,
        props,
      );
      if (ok && src !== 'fallback') tagged++;
    }
  }

  const roadRibbons: SplitPolygon[] = [];
  if (wantRoads) {
    for (const el of data.elements) {
      if (el.type !== 'way' || !el.tags || !el.tags.highway || !el.geometry) continue;
      // pushRoadway clips to the box itself, so this is not needed for
      // correctness — but rejecting a five-kilometre trunk road before
      // projecting every vertex of it is free, and it keeps the three loops
      // reading alike.
      if (!geomInSite(el.geometry, site)) continue;
      const lanes =
        parseFloat(el.tags.lanes) || (/motorway|trunk|primary/.test(el.tags.highway) ? 4 : 2);
      const w = Math.max(parseFloat(el.tags.width) || lanes * tune.laneWidth, 3);
      pushRoadway(roadRibbons, el.geometry.map((p): Vec2 => toLocal(p.lon, p.lat)), w, site);
    }
  }

  const railwayRibbons: SplitPolygon[] = [];
  if (wantRailways) {
    for (const el of data.elements) {
      if (el.type !== 'way' || !el.tags || !el.tags.railway || !el.geometry) continue;
      if (!geomInSite(el.geometry, site)) continue;
      const tracks = parseFloat(el.tags.tracks) || 1;
      const w = Math.max(
        parseFloat(el.tags.width) || tracks * tune.railTrackWidth,
        tune.railTrackWidth,
      );
      pushRoadway(railwayRibbons, el.geometry.map((p): Vec2 => toLocal(p.lon, p.lat)), w, site);
    }
  }
  return { tagged, roadRibbons, railwayRibbons };
}
