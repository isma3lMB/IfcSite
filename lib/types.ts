import type { Tunables } from '@/lib/build/tunables';
import type { LayerKey, Params, StatusKey } from '@/lib/i18n/keys';
import type { IfcSchema } from '@/lib/ifc/writer';

export type { IfcSchema };

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
  layer?: SurfaceLayer;
};

/** The context-surface tiers. A subset of LayerId, and the discriminator the
 *  viewer's render order and lib/scene/stack's opacity table are keyed on. */
export type SurfaceLayer = 'vegetation' | 'water' | 'parcel' | 'hedge';

/**
 * The top-level nodes of the model tree, in the order the tree lists them.
 *
 * Nine categories, and the taxonomy is already implicit everywhere else — it is
 * the BuildOptions toggles, the SceneData arrays and the LAYER_DZ rungs saying
 * the same thing three times. Naming it once here is what lets the viewer, the
 * IFC emitter and the panel agree on what a layer is.
 */
export const LAYER_IDS = [
  'terrain',
  'buildings',
  'roads',
  'railways',
  'trees',
  'vegetation',
  'hedge',
  'water',
  'parcel',
] as const;

export type LayerId = (typeof LAYER_IDS)[number];

/**
 * The layers that reach the scene as a flat skin conformed onto the terrain,
 * and so the layers a drape can be turned off for. Hedges are absent on
 * purpose: they are prisms that already keep their surveyed `hauteur`, and only
 * their base is draped, so there is nothing here for them to gain.
 *
 * Named in the FORM's vocabulary (`veg`, `parcels`), not LayerId's
 * (`vegetation`, `parcel`), because that is what BuildOptions.drape is keyed on
 * and what the options panel reads. See the Glyph helper in
 * components/controls-panel for the bridge between the two spellings.
 */
export const DRAPE_LAYERS = ['roads', 'railways', 'veg', 'water', 'parcels'] as const;

export type DrapeLayer = (typeof DRAPE_LAYERS)[number];

/**
 * Per-layer edits that have nowhere else to live.
 *
 * `color` is only ever read for the layers with no per-record colour store —
 * terrain, roads and railways. Buildings, trees and context surfaces carry
 * their own, so a layer recolour is stamped into the records themselves and
 * this stays null for them; see tintedOf in lib/scene/layers.
 */
export type LayerXf = {
  /** null = the palette default. See defaultLayerColor in lib/scene/layers. */
  color: number | null;
  /**
   * How solid the layer draws, 0..1; null = the stack's own default for it (see
   * layerOpacity in lib/scene/stack — parcels are a faint cadastral tint,
   * everything else is a real surface and draws solid).
   *
   * Unlike colour this is the authority for the context surfaces too, not just
   * for the merged layers: a Surface has never carried an opacity of its own,
   * and the viewer and the writer both read the tier's value. Buildings and
   * trees do have one on their Xf, so a layer edit is stamped into theirs the
   * same way a colour is.
   */
  opacity: number | null;
  /**
   * Layer translation, local site metres. Applied as a group transform in the
   * viewer and as the IfcLocalPlacement of the merged element in the export, so
   * both read the same number rather than re-deriving one.
   */
  offset: Vec3;
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
  /** Vertical skirt (wall + bottom cap) under each road ribbon, giving it
   *  real thickness instead of a paper-thin drape. Kept separate from
   *  `roads` — the top surface — so the viewer's road outline (built from an
   *  EdgesGeometry pass over just the top) doesn't pick up the skirt's own
   *  vertical/bottom edges. See lib/scene/push's finishRoads. */
  roadWalls: RoadFace[];
  /** Railway track ribbons — same top/skirt split as roads/roadWalls, built
   *  by the same finishRoads-style helper in lib/scene/push. */
  railways: RoadFace[];
  railwayWalls: RoadFace[];
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
  /**
   * Layer-level colour and offset, one entry per LayerId.
   *
   * It rides on the scene rather than on the viewer because the emitter and the
   * viewer hold this same object (see IfcSite), so a layer edit reaches the
   * download through the onDirty the viewer already fires — the same route a
   * gizmo drag on a building takes. A rebuild produces a fresh scene, which is
   * what resets the layers with it.
   */
  layers: Record<LayerId, LayerXf>;
};

/** Every layer at its palette default, unmoved. */
export const newLayerState = (): Record<LayerId, LayerXf> =>
  Object.fromEntries(
    LAYER_IDS.map((id) => [id, { color: null, opacity: null, offset: [0, 0, 0] }]),
  ) as Record<LayerId, LayerXf>;

export const emptyScene = (): SceneData => ({
  buildings: [],
  roads: [],
  roadWalls: [],
  railways: [],
  railwayWalls: [],
  terrain: null,
  datumZ: null,
  surfaces: [],
  trees: [],
  layers: newLayerState(),
});

/**
 * Everything the exported file says about itself that the user chooses, as
 * against the geometry the build produces.
 *
 * One bag rather than a field each on SiteMeta because they share a lifetime and
 * a rule: none of them is an input to runBuild. Nothing is re-fetched and no
 * coordinate moves when one changes, so they reach an already-open model by
 * being written into the live meta and re-serialised — the same route the origin
 * marker's own fields take. That is also why they survive a rebuild: they are
 * properties of the document, not measurements of the site.
 *
 * Every string is '' by default, meaning "leave it out". Two of them have a
 * fallback rather than being omitted — see defaultProjectName and
 * DEFAULT_SITE_NAME — so a bag nobody has touched writes the file this wrote
 * before any of these fields existed.
 */
export type IfcMeta = {
  /**
   * Which IFC schema Download writes.
   *
   * IFC4 is what this wrote before it could write anything else, and the one
   * most readers do best with. IFC2X3 is there for the older ones, IFC4X3 for
   * infrastructure work.
   */
  schema: IfcSchema;
  projectName: string;
  projectLongName: string;
  projectDescription: string;
  projectPhase: string;
  siteName: string;
  siteLongName: string;
  siteDescription: string;
  siteLandTitle: string;
  /** Goes to the STEP header's author list and, where a file carries one, to
   *  IfcOwnerHistory's person. The organisation beside it is not a field —
   *  see ORGANISATION in lib/ifc/writer, which is fixed. */
  author: string;
};

export const newIfcMeta = (): IfcMeta => ({
  schema: 'IFC4',
  projectName: '',
  projectLongName: '',
  projectDescription: '',
  projectPhase: '',
  siteName: '',
  siteLongName: '',
  siteDescription: '',
  siteLandTitle: '',
  author: '',
});

/**
 * The name an unnamed project takes.
 *
 * Applied at write time rather than stamped into the meta at build time: a name
 * derived from where the site is would otherwise become an explicit value, and
 * moving the site would leave the old coordinates behind in the file. Here
 * because the writer, the draft loader and the panel's placeholder all need to
 * agree on the same one.
 */
export const defaultProjectName = (lat: number, lon: number): string =>
  `Context ${lat.toFixed(4)}, ${lon.toFixed(4)}`;

/** IfcSite.Name when the field is blank. Exported so the panel's placeholder and
 *  the writer cannot drift apart. */
export const DEFAULT_SITE_NAME = 'Site';

/** Everything the IFC writer needs that is not geometry. */
export type SiteMeta = {
  origin: Vec2;
  /**
   * Local-site offset of the point the user wants exported as model (0,0,0),
   * written by the origin marker. A fresh build leaves it at the site centre,
   * resting on the ground — [0,0,datumZ] when the scene has a vertical datum,
   * [0,0,0] otherwise (see Viewer.setScene).
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
  /** Both null together, and both from VERTICAL_DATUMS in lib/geo/vertical: the
   *  name for the UI, the EPSG code for the IFC header. */
  verticalDatum: string | null;
  verticalDatumEpsg: string | null;
  /**
   * The proj4 definition the site was projected through.
   *
   * Carried here so the writer can invert the origin marker's easting/northing
   * back to WGS84 for IfcSite's RefLatitude/RefLongitude. Derived at write time
   * from this rather than stored as a lat/lon pair of its own: the marker moves,
   * and a second copy of its position is a second thing to keep in step.
   */
  crsDef: string;
  /**
   * The schema, the names and the authorship — everything about the file that
   * is a choice rather than a measurement. See IfcMeta, which explains why they
   * travel together and why none of them costs a rebuild.
   */
  ifc: IfcMeta;
  /**
   * Which provider the scene was built from.
   *
   * Here rather than only on BuildOptions because the writer has to credit the
   * data it is writing, and this is the writer's whole input — see sourceOf in
   * lib/sources/licence, which turns this plus the kind of element into the
   * dataset whose licence the file must carry. Note it does not answer the
   * question for every element: trees are OSM under both providers.
   */
  provider: Provider;
  /**
   * When the data was pulled, as YYYY-MM-DD.
   *
   * IGN's Licence Ouverte 2.0 asks for the source name and "la date de la
   * dernière mise à jour de l'Information réutilisée", so the export has to be
   * able to say when it fetched. On the meta rather than taken at write time
   * because a draft reopened months later has to still report when its data
   * actually came down, not when the button was pressed.
   *
   * Empty means unknown — a draft written before this existed — and the
   * property is then omitted rather than guessed at.
   */
  fetched: string;
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

/**
 * What a build is about: where, from whom, and with what in it.
 *
 * The IFC schema used to sit here too, between the CRS and the default height.
 * It has moved to IfcMeta, because it never answered this question — nothing is
 * fetched or reprojected when it changes, and a scene built under one schema is
 * exactly the scene the next build would produce under another.
 */
export type BuildOptions = {
  epsg: string;
  defaultHeight: number;
  provider: Provider;
  buildings: boolean;
  roads: boolean;
  railways: boolean;
  terrain: boolean;
  terrainAccuracy: TerrainAccuracy;
  trees: boolean;
  veg: boolean;
  water: boolean;
  parcels: boolean;
  /** Per layer: conform onto the DEM (true, and the default), or take elevation
   *  from the source geometry's own Z (false). Off falls back to draping for
   *  any feature whose source carries no Z, which is most of them outside the
   *  BD TOPO road and rail centrelines — see lib/geo/sourcez. */
  drape: Record<DrapeLayer, boolean>;
  /** Pipeline limits and geometry fallbacks. Nested rather than flattened in
   *  beside the rest so the fields above stay the things a build is *about* —
   *  where, from whom, with what in it — and the knobs stay knobs. See
   *  lib/build/tunables. */
  tune: Tunables;
};

/**
 * What the options panel hands back on a change.
 *
 * `tune` is partial in its own right — the panel sends one slider at a time —
 * which a plain Partial<BuildOptions> would type as a whole Tunables, obliging
 * every row to spread the other eight fields it has no opinion about. The
 * reducer merges it one level deeper to match; see onFormChange.
 */
export type FormPatch = Omit<Partial<BuildOptions>, 'tune'> & { tune?: Partial<Tunables> };

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
  /** Fetches this build answered out of the session cache rather than off the
   *  network. Reported because a build that normally takes forty seconds
   *  finishing in two is otherwise unexplained — and because it is the only
   *  standing signal that what is on screen was not pulled just now. */
  reused: number;
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
