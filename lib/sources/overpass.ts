import { AppError } from '@/lib/errors';
import type { SplitPolygon } from '@/lib/geo/boolean';
import { BUILDING_CAP, pushBuilding, pushRoadway } from '@/lib/scene/push';
import { LAYER_DZ } from '@/lib/scene/stack';
import { newXf } from '@/lib/scene/xf';
import type {
  HeightSource,
  PropBag,
  SampleZ,
  SceneData,
  Site,
  SiteRect,
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

// [out:json][timeout:40] only binds the server's own work. A mirror that is
// overloaded sits on the connection and 504s much later, so without a client
// deadline three wedged mirrors can stall a build for minutes — twice over now
// that trees are a second round trip.
const OVERPASS_TIMEOUT = 45000;

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

async function overpassQuery(q: string): Promise<OverpassResponse> {
  let lastErr: AppError | undefined;
  for (const url of ENDPOINTS) {
    const host = url.split('/')[2];
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(OVERPASS_TIMEOUT),
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

export async function overpass(box: SiteRect, wantRoads: boolean): Promise<OverpassResponse> {
  const bb = overpassBox(box);
  return overpassQuery(`[out:json][timeout:40];(
    way["building"](${bb});
    relation["building"]["type"="multipolygon"](${bb});
    ${wantRoads ? `way["highway"~"^(${ROADS})$"](${bb});` : ''}
  );out geom;`);
}

// Individual trees are the one thing IGN has no national layer for — BD TOPO
// stops at vegetation polygons — so this stays on OSM under both providers.
export const TREE_CAP = 1500;

export async function osmTrees(box: SiteRect, toLocal: ToLocal, sampleZ: SampleZ): Promise<Tree[]> {
  const data = await overpassQuery(
    `[out:json][timeout:40];node["natural"="tree"](${overpassBox(box)});out geom;`,
  );
  const out: Tree[] = [];
  for (const el of data.elements) {
    if (el.type !== 'node' || el.lat === undefined || el.lon === undefined) continue;
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
    if (out.length >= TREE_CAP) break;
  }
  return out;
}

export function parseHeight(
  tags: Record<string, string>,
  fallback: number,
): [number, HeightSource] {
  const h = tags.height || tags['building:height'];
  if (h) {
    const v = parseFloat(String(h).replace(/[^\d.]/g, ''));
    if (v > 0) return [v, 'tag:height'];
  }
  const l = tags['building:levels'];
  if (l) {
    const v = parseFloat(l);
    if (v > 0) return [v * 3.0, 'tag:levels'];
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
  wantRoads: boolean,
): { tagged: number; roadRibbons: SplitPolygon[] } {
  let tagged = 0;
  const rings: [OverpassGeom[], Record<string, string>, number][] = [];
  for (const el of data.elements) {
    if (el.tags && el.tags.building) {
      if (el.type === 'way' && el.geometry) rings.push([el.geometry, el.tags, el.id]);
      else if (el.type === 'relation' && el.members) {
        for (const m of el.members)
          if (m.role === 'outer' && m.geometry) rings.push([m.geometry, el.tags, el.id]);
      }
    }
  }
  for (const [geom, tags, id] of rings) {
    if (scene.buildings.length >= BUILDING_CAP) break;
    const ring = geom.map((p) => toLocal(p.lon, p.lat));
    if (ring.length < 4) continue;
    const [h, src] = parseHeight(tags, fallbackH);
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

  const roadRibbons: SplitPolygon[] = [];
  if (wantRoads) {
    for (const el of data.elements) {
      if (el.type !== 'way' || !el.tags || !el.tags.highway || !el.geometry) continue;
      const lanes =
        parseFloat(el.tags.lanes) || (/motorway|trunk|primary/.test(el.tags.highway) ? 4 : 2);
      const w = Math.max(parseFloat(el.tags.width) || lanes * 3.25, 3);
      pushRoadway(roadRibbons, el.geometry.map((p): Vec2 => toLocal(p.lon, p.lat)), w, site);
    }
  }
  return { tagged, roadRibbons };
}
