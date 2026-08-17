import proj4 from 'proj4';
import { DEFAULT_FORM } from '@/lib/build/defaults';
import { sanitizeTunables } from '@/lib/build/tunables';
import { AppError } from '@/lib/errors';
import { gridFrom } from '@/lib/geo/grid';
import { isIfcSchema } from '@/lib/ifc/writer';
import { LAYER_IDS, newLayerState } from '@/lib/types';
import type {
  Building,
  BuildOptions,
  Grid,
  HeightSource,
  LayerId,
  LayerXf,
  PropBag,
  RoadFace,
  SceneData,
  Site,
  SiteMeta,
  SiteRect,
  Surface,
  SurfaceLayer,
  ToLocal,
  Tree,
  Vec2,
  Vec3,
  Xf,
} from '@/lib/types';

/* =====================================================================
   The draft file — a site you can put down and pick up again.

   This is the document half of the app, as against the deliverable the IFC
   writer produces: an IFC opens in everything except here, and a draft opens
   only here but brings back every edit — the hand-drawn footprints, the per
   element transforms and colours, the layer offsets, the origin marker, the
   project placement. None of that survives a rebuild, because element ids come
   from the source data and shift between fetches.

   It is a full snapshot rather than a recipe for the same reason: replaying
   `rect + BuildOptions` re-queries Overpass or IGN, and there is no honest way to
   reattach a colour to a building whose id moved. So the file carries the scene,
   and opening one touches the network not at all.
   ===================================================================== */

export const DRAFT_MAGIC = 'ifcsite.draft';
export const DRAFT_VERSION = 1;
export const DRAFT_EXT = '.ifcsite.json';
export const DRAFT_MIME = 'application/json';

/**
 * Terrain, trimmed to the column of heights it was read on.
 *
 * The lattice is a pure function of (rect, n), the faces are a pure function of
 * n, and the xy of every vertex is that lattice through the projection — so the
 * heights are the only part that is not recomputable, and storing the rest would
 * be storing an answer next to its own question. At the ceiling (n = 211, 44944
 * vertices and 89888 faces) that is the difference between ~650 kB and ~3.6 MB.
 * gridFrom in lib/geo/grid is what both the DEM providers and this go through, so
 * the reconstruction is exact by construction rather than by two loops agreeing.
 */
export type DraftGrid = { n: number; zn: number[] };

export type DraftScene = Omit<SceneData, 'terrain'> & { terrain: DraftGrid | null };

export type Draft = {
  magic: typeof DRAFT_MAGIC;
  version: number;
  /** Informational only — nothing reads it back but the slot list. */
  savedAt: string;
  name: string;
  rect: SiteRect;
  site: Site;
  form: BuildOptions;
  /** Whether the CRS was the user's choice. Restored so that reopening a draft
   *  and nudging its rectangle does not silently reproject the site. */
  epsgPicked: boolean;
  /** The proj4 definition string. The one field that makes opening offline:
   *  without it the loader would have to resolve the EPSG code again, which for
   *  anything outside the curated four means fetching the generated index. */
  crsDef: string;
  meta: SiteMeta;
  scene: DraftScene;
};

/** What the loader hands back: a Draft with its terrain already a real Grid, so
 *  the caller receives the same shape a BuildResult has. */
export type LoadedDraft = {
  name: string;
  rect: SiteRect;
  site: Site;
  form: BuildOptions;
  epsgPicked: boolean;
  crsDef: string;
  meta: SiteMeta;
  scene: SceneData;
};

/* ---- writing ---------------------------------------------------------- */

export function toDraft(p: {
  name: string;
  rect: SiteRect;
  site: Site;
  form: BuildOptions;
  epsgPicked: boolean;
  crsDef: string;
  meta: SiteMeta;
  scene: SceneData;
}): Draft {
  const { terrain, ...rest } = p.scene;
  return {
    magic: DRAFT_MAGIC,
    version: DRAFT_VERSION,
    savedAt: new Date().toISOString(),
    name: p.name,
    rect: p.rect,
    site: p.site,
    form: p.form,
    epsgPicked: p.epsgPicked,
    crsDef: p.crsDef,
    meta: p.meta,
    scene: {
      ...rest,
      // verts[k][2] is zn[k] in both DEM producers, by construction.
      terrain: terrain ? { n: terrain.n, zn: terrain.verts.map((v) => v[2]) } : null,
    },
  };
}

/**
 * The serialised form.
 *
 * Deliberately not pretty-printed and deliberately not rounded. The IFC writer
 * emits full doubles (see formatReal in lib/ifc/writer), so trimming a coordinate
 * here would mean a draft that reopens and re-exports a *different* file from the
 * one it was saved beside — and round-tripping a double through JSON is exact, so
 * the fidelity is free.
 */
export const draftToText = (d: Draft): string => JSON.stringify(d);

/* ---- reading ---------------------------------------------------------- */

/* The sanitisers below follow lib/build/tunables' rule: check finiteness first,
   then clamp or default. The other order lets NaN through — Math.min(hi,
   Math.max(lo, NaN)) is NaN — and a NaN in a ring or a height is a mesh that
   silently vanishes rather than a wrong number on screen.

   Each walks the shape it *expects* rather than the keys it was *given*, which is
   what makes an older or a newer file a non-event: a missing field takes its
   default, an unknown one is dropped, and adding a field later needs no
   migration step. */

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const num = (v: unknown, d = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : d;

const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);

const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d);

const vec2 = (v: unknown): Vec2 => (Array.isArray(v) ? [num(v[0]), num(v[1])] : [0, 0]);

const vec3 = (v: unknown): Vec3 =>
  Array.isArray(v) ? [num(v[0]), num(v[1]), num(v[2])] : [0, 0, 0];

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A ring or a face loop. Anything under three corners cannot be a polygon, and
 *  passing one on would put a degenerate geometry into the viewer and the
 *  writer; the record that owns it is dropped instead. */
const ring2 = (v: unknown): Vec2[] | null => {
  const r = arr(v).map(vec2);
  return r.length >= 3 ? r : null;
};

const verts3 = (v: unknown): Vec3[] => arr(v).map(vec3);

/** Face index lists, with anything pointing outside the vertex array dropped —
 *  a stale index is an out-of-bounds read in the mesh builder. */
const faceList = (v: unknown, nVerts: number): number[][] =>
  arr(v)
    .map((f) => arr(f).map((i) => num(i, -1)))
    .filter((f) => f.length >= 3 && f.every((i) => Number.isInteger(i) && i >= 0 && i < nVerts));

const propBag = (v: unknown): PropBag => {
  if (!isObj(v)) return {};
  const out: PropBag = {};
  for (const [k, val] of Object.entries(v))
    if (typeof val === 'string' || (typeof val === 'number' && Number.isFinite(val)))
      out[k] = val;
  return out;
};

const clamp01 = (v: unknown, d: number): number => Math.min(1, Math.max(0, num(v, d)));

/** A colour is an RGB integer or null for "use the source-derived default". */
const colorOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(0xffffff, Math.max(0, Math.round(v))) : null;

const xf = (v: unknown): Xf => {
  const s = isObj(v) ? v : {};
  return {
    pos: vec3(s.pos),
    rot: vec3(s.rot),
    // A zero scale collapses the mesh to nothing and cannot be dragged back out
    // of it, so it is the one transform component with a floor.
    scale: (() => {
      const t = vec3(s.scale);
      return t.map((n) => (n === 0 ? 1 : n)) as Vec3;
    })(),
    color: colorOrNull(s.color),
    opacity: clamp01(s.opacity, 1),
  };
};

const HEIGHT_SOURCES: ReadonlySet<string> = new Set<HeightSource>([
  'tag:height',
  'tag:levels',
  'ign:hauteur',
  'ign:etages',
  'fallback',
  'user',
]);

const SURFACE_LAYERS: ReadonlySet<string> = new Set<SurfaceLayer>([
  'vegetation',
  'water',
  'parcel',
  'hedge',
]);

const building = (v: unknown, i: number): Building | null => {
  if (!isObj(v)) return null;
  const r = ring2(v.ring);
  if (!r) return null;
  const src = str(v.src, 'fallback');
  return {
    id: str(v.id, `b-${i}`),
    name: str(v.name, ''),
    props: propBag(v.props),
    ring: r,
    center: vec2(v.center),
    h: Math.max(0.1, num(v.h, 3)),
    baseZ: num(v.baseZ),
    src: (HEIGHT_SOURCES.has(src) ? src : 'fallback') as HeightSource,
    xf: xf(v.xf),
  };
};

const tree = (v: unknown, i: number): Tree | null => {
  if (!isObj(v)) return null;
  return {
    id: str(v.id, `t-${i}`),
    x: num(v.x),
    y: num(v.y),
    z: num(v.z),
    h: Math.max(0.1, num(v.h, 6)),
    cr: Math.max(0.05, num(v.cr, 2)),
    tr: Math.max(0.01, num(v.tr, 0.2)),
    name: str(v.name, ''),
    props: propBag(v.props),
    xf: xf(v.xf),
    src: v.src === 'user' ? 'user' : 'osm',
  };
};

const surface = (v: unknown): Surface | null => {
  if (!isObj(v)) return null;
  const verts = verts3(v.verts);
  const faces = faceList(v.faces, verts.length);
  if (!verts.length || !faces.length) return null;
  const layer = str(v.layer, '');
  const out: Surface = {
    verts,
    faces,
    name: str(v.name, ''),
    type: str(v.type, 'IfcGeographicElement'),
  };
  const c = colorOrNull(v.color);
  if (c !== null) out.color = c;
  if (isObj(v.props)) out.props = propBag(v.props);
  if (SURFACE_LAYERS.has(layer)) out.layer = layer as SurfaceLayer;
  return out;
};

/** Road and railway ribbons: 3-5 convex corners in site coordinates. */
const roadFaces = (v: unknown): RoadFace[] =>
  arr(v)
    .map((f) => verts3(f))
    .filter((f) => f.length >= 3);

const layerState = (v: unknown): Record<LayerId, LayerXf> => {
  const out = newLayerState();
  if (!isObj(v)) return out;
  for (const id of LAYER_IDS) {
    const s = v[id];
    if (!isObj(s)) continue;
    out[id] = {
      color: colorOrNull(s.color),
      opacity: s.opacity === null || s.opacity === undefined ? null : clamp01(s.opacity, 1),
      offset: vec3(s.offset),
    };
  }
  return out;
};

const siteRect = (v: unknown): SiteRect | null => {
  if (!isObj(v)) return null;
  const r = {
    minLat: num(v.minLat, NaN),
    maxLat: num(v.maxLat, NaN),
    minLon: num(v.minLon, NaN),
    maxLon: num(v.maxLon, NaN),
  };
  const ok = Object.values(r).every(Number.isFinite) && r.maxLat > r.minLat && r.maxLon > r.minLon;
  return ok ? r : null;
};

const site = (v: unknown, rect: SiteRect): Site | null => {
  if (!isObj(v)) return null;
  const halfX = num(v.halfX, NaN);
  const halfY = num(v.halfY, NaN);
  if (!(halfX > 0) || !(halfY > 0)) return null;
  return {
    ...rect,
    lat: num(v.lat, (rect.minLat + rect.maxLat) / 2),
    lon: num(v.lon, (rect.minLon + rect.maxLon) / 2),
    halfX,
    halfY,
    radius: num(v.radius, Math.max(halfX, halfY)),
  };
};

/** BuildOptions, walked against DEFAULT_FORM so the fields are exactly the ones
 *  runBuild reads. `tune` goes through sanitizeTunables rather than being
 *  re-checked here — one clamp table, in the module that owns it. */
const buildOptions = (v: unknown): BuildOptions => {
  const s = isObj(v) ? v : {};
  const d = DEFAULT_FORM;
  return {
    epsg: str(s.epsg, d.epsg),
    ifcSchema: isIfcSchema(s.ifcSchema) ? s.ifcSchema : d.ifcSchema,
    defaultHeight: Math.min(200, Math.max(1, num(s.defaultHeight, d.defaultHeight))),
    provider: s.provider === 'osm' || s.provider === 'ign' ? s.provider : d.provider,
    buildings: bool(s.buildings, d.buildings),
    roads: bool(s.roads, d.roads),
    railways: bool(s.railways, d.railways),
    terrain: bool(s.terrain, d.terrain),
    terrainAccuracy:
      s.terrainAccuracy === 'coarse' ||
      s.terrainAccuracy === 'standard' ||
      s.terrainAccuracy === 'fine' ||
      s.terrainAccuracy === 'max'
        ? s.terrainAccuracy
        : d.terrainAccuracy,
    trees: bool(s.trees, d.trees),
    veg: bool(s.veg, d.veg),
    water: bool(s.water, d.water),
    parcels: bool(s.parcels, d.parcels),
    tune: sanitizeTunables(s.tune),
  };
};

const siteMeta = (v: unknown, rect: SiteRect): SiteMeta | null => {
  if (!isObj(v)) return null;
  const lat = num(v.lat, (rect.minLat + rect.maxLat) / 2);
  const lon = num(v.lon, (rect.minLon + rect.maxLon) / 2);
  return {
    origin: vec2(v.origin),
    exportOffset: vec3(v.exportOffset),
    projectBase: vec3(v.projectBase),
    projectAngle: num(v.projectAngle),
    lat,
    lon,
    epsg: str(v.epsg, 'EPSG:4326'),
    crsName: str(v.crsName, ''),
    geodeticDatum: str(v.geodeticDatum, ''),
    verticalDatum: typeof v.verticalDatum === 'string' ? v.verticalDatum : null,
    // Defaulted here and overwritten by fromDraft with the envelope's own copy,
    // which is validated and present in every draft — including those written
    // before the meta carried one.
    crsDef: str(v.crsDef, ''),
    projectName: str(v.projectName, `Context ${lat.toFixed(4)}, ${lon.toFixed(4)}`),
    // A draft written before there was a choice was written as IFC4, so the
    // default is not a guess — it is what that file actually says.
    schema: isIfcSchema(v.schema) ? v.schema : 'IFC4',
  };
};

/**
 * The projection the draft was built through, rebuilt from its own definition
 * string.
 *
 * Registered under a private name rather than the 'TARGET' slot runBuild uses:
 * proj4's defs table is global, and a build running in another tab of the same
 * page would otherwise have its projection swapped out from under it mid-fetch.
 */
const DRAFT_PROJ = 'IFCSITE_DRAFT';

const localiser = (crsDef: string, origin: Vec2): ToLocal => {
  proj4.defs(DRAFT_PROJ, crsDef);
  return (lo, la) => {
    const p = proj4('EPSG:4326', DRAFT_PROJ, [lo, la]) as Vec2;
    return [p[0] - origin[0], p[1] - origin[1]];
  };
};

const terrainGrid = (v: unknown, rect: SiteRect, toLocal: ToLocal): Grid | null => {
  if (!isObj(v)) return null;
  const n = num(v.n, 0);
  const zn = arr(v.zn).map((z) => num(z));
  // The lattice is square by definition; a zn of any other length describes a
  // mesh that cannot be rebuilt, and a flat scene is a better answer than a
  // ragged one.
  if (!Number.isInteger(n) || n < 1 || zn.length !== (n + 1) * (n + 1)) return null;
  return gridFrom(rect, n, zn, toLocal);
};

const scene = (v: unknown, rect: SiteRect, toLocal: ToLocal): SceneData => {
  const s = isObj(v) ? v : {};
  const out: SceneData = {
    buildings: arr(s.buildings)
      .map(building)
      .filter((b): b is Building => b !== null),
    roads: roadFaces(s.roads),
    roadWalls: roadFaces(s.roadWalls),
    railways: roadFaces(s.railways),
    railwayWalls: roadFaces(s.railwayWalls),
    terrain: terrainGrid(s.terrain, rect, toLocal),
    datumZ: numOrNull(s.datumZ),
    surfaces: arr(s.surfaces)
      .map(surface)
      .filter((x): x is Surface => x !== null),
    trees: arr(s.trees)
      .map(tree)
      .filter((t): t is Tree => t !== null),
    layers: layerState(s.layers),
  };
  if (typeof s.terrainSource === 'string') out.terrainSource = s.terrainSource;
  if (typeof s.vectorSource === 'string') out.vectorSource = s.vectorSource;
  return out;
};

/**
 * A trusted LoadedDraft out of a string, or an AppError the status line can
 * translate.
 *
 * The three failures are told apart on purpose: "not our file" is a different
 * thing to fix from "our file, from a newer build" and from "our file, damaged".
 * The parse sits inside the try with everything else for the reason loadTunables
 * gives — corrupt JSON has to land in the same place a wrong shape does.
 */
export function parseDraft(text: string): LoadedDraft {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError('err.draftUnreadable');
  }
  if (!isObj(raw) || raw.magic !== DRAFT_MAGIC) throw new AppError('err.draftUnreadable');

  const version = num(raw.version, 0);
  if (!Number.isInteger(version) || version < 1) throw new AppError('err.draftUnreadable');
  if (version > DRAFT_VERSION)
    throw new AppError('err.draftVersion', { version });

  const rect = siteRect(raw.rect);
  if (!rect) throw new AppError('err.draftCorrupt');

  const st = site(raw.site, rect);
  const meta = siteMeta(raw.meta, rect);
  const crsDef = typeof raw.crsDef === 'string' && raw.crsDef ? raw.crsDef : null;
  if (!st || !meta || !crsDef || !isObj(raw.scene)) throw new AppError('err.draftCorrupt');
  // The envelope's copy wins over anything the embedded meta carried: it is the
  // one this loader has just validated, and the one the scene is rebuilt through.
  meta.crsDef = crsDef;

  // proj4 rejects a malformed definition by throwing, and that is a corrupt file
  // rather than an unreadable one — the envelope parsed fine.
  let toLocal: ToLocal;
  try {
    toLocal = localiser(crsDef, meta.origin);
    toLocal(meta.lon, meta.lat);
  } catch {
    throw new AppError('err.draftCorrupt');
  }

  return {
    name: str(raw.name, meta.projectName),
    rect,
    site: st,
    form: buildOptions(raw.form),
    epsgPicked: bool(raw.epsgPicked, false),
    crsDef,
    meta,
    scene: scene(raw.scene, rect, toLocal),
  };
}
