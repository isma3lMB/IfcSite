import type { LayerKey, Params, StatusKey } from '@/lib/i18n/keys';

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** The drawn rectangle, in WGS84 degrees. The whole site definition. */
export type SiteRect = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};

/**
 * A SiteRect resolved against a projected CRS. halfX/halfY are the local metre
 * half-extents (taken from the outermost corner, so grid convergence cannot
 * crop a sliver off what was drawn); radius is only what the camera frames on.
 */
export type Site = SiteRect & {
  lat: number;
  lon: number;
  halfX: number;
  halfY: number;
  radius: number;
};

/**
 * Where a building's height came from — drives the default preview colour.
 *
 * `user` is the one value no provider produces: it marks a footprint drawn in
 * the 3D view, whose height was typed rather than read off anything. It is also
 * what a rebuild counts to warn before discarding hand-drawn work.
 */
export type HeightSource =
  | 'tag:height'
  | 'tag:levels'
  | 'ign:hauteur'
  | 'ign:etages'
  | 'fallback'
  | 'user';

/** A user edit riding on top of a building. Composed as M = T·R·S. */
export type Xf = {
  pos: Vec3;
  rot: Vec3;
  scale: Vec3;
  /** null = use the source-derived default pair. */
  color: number | null;
  /**
   * How solid the building draws, 0..1. Sits beside colour because it is the
   * same kind of decision — a view choice the deliverable carries too: the
   * viewer reads it as material opacity and the writer exports `1 - it` as
   * IfcSurfaceStyleRendering.Transparency, the same pairing lib/scene/stack
   * makes for the context layers.
   */
  opacity: number;
};

export type PropBag = Record<string, string | number>;

/**
 * `ring` is relative to `center`, so rotation and scale pivot on the building
 * rather than on a site origin hundreds of metres away.
 */
export type Building = {
  id: string;
  name: string;
  props: PropBag;
  ring: Vec2[];
  center: Vec2;
  h: number;
  baseZ: number;
  src: HeightSource;
  xf: Xf;
};

/**
 * A terrain mesh plus an arbitrary-point elevation lookup.
 *
 * `verts` is the (n+1)^2 lattice in LOCAL METRES, row-major at index
 * `j * (n + 1) + i`, with i running west to east and j south to north. `faces`
 * cuts every cell on the same anti-diagonal that `sample` interpolates over
 * (see lib/geo/grid), which is what lets lib/geo/conform clip a draped layer
 * onto a terrain triangle and land exactly on the surface the viewer draws.
 * Both producers and this comment have to stay in step.
 */
export type Grid = {
  n: number;
  verts: Vec3[];
  faces: number[][];
  sample: (lat: number, lon: number) => number;
};

/**
 * What every opaque cutting layer (water, vegetation, roads, ...) feeds
 * lib/geo/conform's final terrain pass, threaded through lib/build/run and
 * accumulated per-layer by lib/sources/ign's fetchThemeLayer and
 * lib/scene/push's finishRoads.
 *
 * `coverage` is the existing fractional map, keyed by terrain face index,
 * used as a cheap pre-filter (drop a face once it reads ~fully covered).
 * `touched`/`rings` are what let a partially-covered face be split exactly
 * along the true boundary instead of kept whole: `touched` names the real
 * terrain faces some ring's own boundary actually crosses, and `rings` is
 * the flat list of contributing rings (local metres, post site-clip) that a
 * touched face re-clips against on demand — no per-triangle geometry is
 * stored during the walk, only these two small, boundary-bounded collections.
 */
export type CutAccumulator = {
  coverage: Map<number, number>;
  touched: Set<number>;
  rings: Vec2[][];
};

/**
 * A draped, triangulated context layer (vegetation, water, parcels, merged
 * hedges). Every vertex carries its own elevation, so a layer follows the
 * terrain instead of taking one arbitrary corner's height.
 */
export type Surface = {
  verts: Vec3[];
  faces: number[][];
  name: string;
  type: string;
  color?: number;
  props?: PropBag;
  /** Which LAYER_DZ tier this came from — `type` alone can't tell vegetation
   *  and hedges apart, and the viewer needs to know to give each its own
   *  render-order/polygon-offset so the stacking order always holds on screen. */
  layer?: 'vegetation' | 'water' | 'parcel' | 'hedge';
};

export type Tree = {
  id: string;
  x: number;
  y: number;
  z: number;
  /** total height */
  h: number;
  /** crown radius */
  cr: number;
  /** trunk radius */
  tr: number;
  name: string;
  props: PropBag;
  xf: Xf;
  /** Fetched vs hand-placed — same narrow purpose as Building.src: only to
   *  drive the "discard hand-drawn work" rebuild warning, not colour. */
  src: 'osm' | 'user';
};

/**
 * One road segment's face, in site coordinates. Four corners as buffered, three
 * to five once the site clip has cut it — always convex, so consumers can fan
 * it into triangles without a triangulator.
 */
export type RoadFace = Vec3[];

export type SceneData = {
  buildings: Building[];
  roads: RoadFace[];
  terrain: Grid | null;
  terrainSource?: string;
  vectorSource?: string;
  /**
   * Site ground elevation in model z, and the flag for whether model z means
   * anything vertically at all.
   *
   * A number says the scene has a real vertical datum — a terrain grid, or the
   * single-post RGE ALTI probe — so an absolute altitude off a source (BD TOPO's
   * altitude_minimale_sol) is on the same footing as everything draped with
   * sampleZ, and the viewer's reference plane belongs at this height rather than
   * at zero. null says the scene is a bare flat datum: nothing knows its
   * altitude, so nothing may claim one.
   */
  datumZ: number | null;
  surfaces: Surface[];
  trees: Tree[];
};

export const emptyScene = (): SceneData => ({
  buildings: [],
  roads: [],
  terrain: null,
  datumZ: null,
  surfaces: [],
  trees: [],
});

/** Everything the IFC writer needs that is not geometry. */
export type SiteMeta = {
  origin: Vec2;
  /**
   * Local-site offset of the point the user wants exported as model (0,0,0),
   * written by the origin marker. [0,0,0] is the site centre, which is where a
   * fresh build leaves it.
   *
   * This moves where zero sits in the file, never where anything is on the
   * ground: the site is placed back by -exportOffset and the map conversion
   * carries the same offset forward, so every element keeps its real-world
   * coordinates. See ContextModel in lib/ifc/writer.
   */
  exportOffset: Vec3;
  /**
   * The project coordinates that origin point is mapped to, and how far the
   * project's +X axis is turned counter-clockwise from grid east, in DEGREES.
   *
   * Degrees, not radians like Xf.rot: this is a typed export parameter that never
   * drives a three.js transform, and the writer is the only thing that converts.
   * All zero puts the origin point on model (0,0,0) with the axes on the map
   * grid, which is where every build starts. Georeferencing is unaffected either
   * way — the rotation and the shift are cancelled in IfcMapConversion.
   */
  projectBase: Vec3;
  projectAngle: number;
  lat: number;
  lon: number;
  epsg: string;
  crsName: string;
  geodeticDatum: string;
  verticalDatum: string | null;
  /** Site ground elevation above verticalDatum, for IfcSite.RefElevation. Null
   *  when the scene has no altimetry — see SceneData.datumZ. */
  refElevation: number | null;
  projectName: string;
};

export type Provider = 'osm' | 'ign';
export type GizmoMode = 'translate' | 'rotate' | 'scale';
export type ViewTab = 'map' | '3d';

/**
 * How densely the DEM is sampled, as a request rather than a promise: each level
 * names a target ground cell size, and each provider reaches whatever it can
 * within its own budget. See ACCURACY_CELL in lib/geo/grid.
 */
export type TerrainAccuracy = 'coarse' | 'standard' | 'fine' | 'max';

export type BuildOptions = {
  epsg: string;
  defaultHeight: number;
  provider: Provider;
  roads: boolean;
  terrain: boolean;
  terrainAccuracy: TerrainAccuracy;
  trees: boolean;
  veg: boolean;
  water: boolean;
  parcels: boolean;
};

/**
 * The closing summary, structured rather than pre-formatted. The original built
 * it from six conditional clauses (`Built N buildings from X — …`); those clauses
 * order differently in French, so the UI composes the sentence, not the builder.
 */
export type BuildSummary = {
  buildings: number;
  tagged: number;
  provider: Provider;
  fallbackH: number;
  capped: boolean;
  capAt: number;
  treesCapped: boolean;
  treeCap: number;
  skipped: LayerKey[];
};

/** Readout numbers, returned by emitIFC instead of written into the DOM. */
export type IfcStats = {
  roadFaces: number;
  trees: number;
  layers: number;
  entities: number;
  bytes: number;
};

/** lon/lat degrees -> local metres, relative to the site origin. */
export type ToLocal = (lon: number, lat: number) => Vec2;
/** local metres -> lon/lat degrees. */
export type ToGeo = (x: number, y: number) => Vec2;
/** lat/lon degrees -> elevation in metres. */
export type SampleZ = (lat: number, lon: number) => number;

export type StatusFn = (key: StatusKey, params?: Params) => void;
