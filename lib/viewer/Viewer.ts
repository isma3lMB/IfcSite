import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { DEFAULT_TUNABLES, TUNE_RANGE } from '@/lib/build/tunables';
import { treeCanopyGeometry, treeTrunkGeometry, treeTrunkHeight } from '@/lib/geo/treeShape';
import {
  LAYER_LABEL,
  MOVABLE_LAYERS,
  type Style,
  type Styled,
  cloneLayerXf,
  defaultLayerColor,
  defaultLayerOpacity,
  layerAlpha,
  layerCount,
  readStyle,
  sameLayerXf,
  sameStyle,
  styledOf,
  writeStyle,
} from '@/lib/scene/layers';
import { BUILDING_CAP, defaultTreeDims, pushBuilding, pushTree } from '@/lib/scene/push';
import {
  DRAW_ORDER,
  RAILWAY_COLOR,
  ROAD_COLOR,
  TERRAIN_COLOR,
  TREE_CANOPY_COLOR,
  TREE_TRUNK_COLOR,
} from '@/lib/scene/stack';
import {
  MIN_SCALE,
  buildingColors,
  cloneXf,
  defaultColors,
  lighten,
  newXf,
  roofZ,
  sameXf,
} from '@/lib/scene/xf';
import { type FootprintDraft, createFootprintDraft } from '@/lib/viewer/footprintDraft';
import {
  type Measure,
  type MeasureFormat,
  type MeasureKind,
  type MeasureLayer,
  createMeasureLayer,
} from '@/lib/viewer/measureLayer';
import { createOriginMarker, markerPick, setMarkerActive } from '@/lib/viewer/originMarker';
import {
  ENTRY_MS,
  type OrbitPose,
  easeInOut,
  eyeOf,
  lerpPose,
  orbitPose,
  poseOf,
} from '@/lib/viewer/presentation';
import { SKY, SKY_THEMES, applySky, createSkyDome } from '@/lib/viewer/sky';
import { type Snap, resolveSnap, toScreen } from '@/lib/viewer/snap';
import { setTranslucency } from '@/lib/viewer/translucency';
import { type ViewAxis, type ViewTriad, axisEye, createViewTriad } from '@/lib/viewer/viewTriad';
import type { EditLabelKey, Params, StatusKey } from '@/lib/i18n/keys';
import {
  type Building,
  type GizmoMode,
  LAYER_IDS,
  type LayerId,
  type LayerXf,
  type SceneData,
  type Site,
  type Surface,
  type Tree,
  type Vec2,
  type Vec3,
  type Xf,
} from '@/lib/types';

/** The scene's own vertex/face pairs — terrain, context surfaces, draped
 * vegetation — all arrive in the same shape, so they all build the same way. */
const facesetGeometry = (verts: Vec3[], faces: number[][]): THREE.BufferGeometry => {
  const pos = new Float32Array(verts.length * 3);
  verts.forEach((v, i) => {
    pos[i * 3] = v[0];
    pos[i * 3 + 1] = v[1];
    pos[i * 3 + 2] = v[2];
  });
  const index: number[] = [];
  faces.forEach((f) => index.push(...f));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
};

const MODE_LABEL: Record<GizmoMode, EditLabelKey> = {
  translate: 'edit.move',
  rotate: 'edit.rotate',
  scale: 'edit.scale',
};

export type Selection = {
  /**
   * 'origin' is the scene's own centre point rather than a building. It carries
   * its offset in xf.pos with an identity rot/scale, so the editor's position
   * row renders it with no second code path; rot, scale and colour do not apply.
   *
   * 'layer' is a whole category from the model tree — every road, or every
   * building. It borrows the same trick: its LayerXf is presented as an Xf with
   * the offset in pos and an identity rot/scale, so the editor reuses the
   * position row and the colour swatch unchanged. Rotation, scale, opacity and
   * height do not apply and the editor does not offer them.
   */
  kind: 'building' | 'tree' | 'origin' | 'layer';
  /** For a layer, the prefixed form — see layerSelId. */
  id: string;
  /**
   * The label. A dictionary key rather than a sentence for the origin and for
   * every layer, since neither has a name of its own that the viewer could
   * know — see ORIGIN_NAME.
   */
  name: string;
  xf: Xf;
  /**
   * Extrusion height in metres, before xf.scale[2]. Not part of Xf — it is the
   * building's own dimension rather than an edit riding on top of one — but the
   * editor writes it, so it travels with the selection and rides the same undo
   * command as the transform. Zero for the origin, which has no extent.
   */
  h: number;
  /** The source-derived side colour, shown in the swatch when xf.color is null. */
  defaultColor: number;
};

/** The id reported for the origin marker — it has no Building behind it. */
export const ORIGIN_ID = '__origin__';

/** The id reported for a layer, and the form `select()` recognises. Prefixed
 *  for the same reason ORIGIN_ID is: a Selection.id is one flat namespace, and
 *  a building is entitled to be called anything at all. */
export const layerSelId = (id: LayerId): string => `__layer:${id}`;
/** The inverse. Null for anything that is not a layer id, which is how React
 *  tells a layer selection from an element one without a second field. */
export const layerIdOf = (selId: string): LayerId | null => {
  const raw = selId.startsWith('__layer:') ? selId.slice(8) : null;
  return raw && (LAYER_IDS as readonly string[]).includes(raw) ? (raw as LayerId) : null;
};

/**
 * One row of the model tree.
 *
 * Two levels, so a node is a category and its `items` are its leaves. The
 * merged layers — terrain, roads, railways — are one element on screen and one
 * element in the file, so they report a single item rather than pretending to a
 * structure they do not have.
 */
export type LayerNode = {
  id: LayerId;
  /** A LayerKey; the panel translates it. */
  label: string;
  count: number;
  /** What the swatch shows: the layer's override, or the palette default. */
  color: number;
  /** Whether the layer accepts an offset. See MOVABLE_LAYERS. */
  movable: boolean;
  /** Whether the layer is on screen. View state only — see setLayerVisible. */
  visible: boolean;
  /** Individually selectable leaves. Empty for the merged layers. */
  items: { id: string; name: string }[];
};

/**
 * Which tool the clicks are feeding, if any. 'tree' is a single click rather
 * than a footprint — no drag, no ring.
 *
 * The two measure members read the scene instead of adding to it, and they are
 * in this union rather than beside it on purpose: everything a tool needs
 * already hangs off it — the pressed state on the rail, the pinned hint in the
 * toast, the Escape ladder in React, Enter closing a ring — and a parallel union
 * would mean a second copy of all four. The handful of places that assume a
 * footprint guard on measureKindOf instead.
 */
export type DrawTool = 'rect' | 'polygon' | 'tree' | 'measure' | 'measureArea';

/** Which kind of measurement a tool makes, or null when it makes none. Doubles
 *  as the "is this a measure tool" test, so there is only one list of them. */
const measureKindOf = (tool: DrawTool | null): MeasureKind | null =>
  tool === 'measure' ? 'dist' : tool === 'measureArea' ? 'area' : null;

/** The two backdrops. Named here rather than imported from lib/theme so nothing
 *  under lib/viewer depends on a React context. */
export type ViewerTheme = 'light' | 'dark';

/**
 * The lighting rig per backdrop.
 *
 * Both intensities are written as the irradiance actually wanted times π, for
 * the reason set out at length where they are first applied — read the light
 * ones as 0.85 fill and 0.3 sun.
 *
 * The dark set is not the light set turned down. The massing keeps its paper
 * colours (they are the export palette, and the file must not change with the
 * toggle), so dimming the fill would only make a grey model on a black card.
 * What changes is the *ratio*: a much darker ground bounce, so undersides fall
 * away from the lit roofs, and a slightly stronger, warmer key to hold the
 * silhouette against the dark dome.
 */
const LIGHTS: Record<
  ViewerTheme,
  { sky: number; ground: number; fill: number; sun: number; key: number }
> = {
  light: { sky: 0xffffff, ground: 0xe0e2e4, fill: 0.85, sun: 0xffffff, key: 0.3 },
  dark: { sky: 0xdfe6ec, ground: 0x272d33, fill: 0.72, sun: 0xfff4e2, key: 0.42 },
};

export type ViewerCallbacks = {
  onSelect: (sel: Selection | null) => void;
  /** Live during a gizmo drag, and after undo/redo. Always a clone. */
  onTransform: (xf: Xf, h: number) => void;
  onHistory: (canUndo: boolean, canRedo: boolean) => void;
  onStatus: (key: StatusKey, params?: Params) => void;
  onDirty: () => void;
  /** The export origin moved. Local site metres; [0,0,0] is the site centre. */
  onOrigin: (off: Vec3) => void;
  /** The viewer changed the gizmo mode itself, so the UI can follow. */
  onMode: (m: GizmoMode) => void;
  /** The scene gained or lost a building, so the readout can follow. */
  onCount: (n: number) => void;
  /**
   * What the model tree lists has changed — a layer recoloured or moved, an
   * element added or removed, a scene rebuilt, an edit undone.
   *
   * Fired on committed changes only, never on the live previews between them:
   * a colour drag repaints the scene continuously, and re-deriving a few
   * thousand leaf rows per mouse-move to tell the panel what its own swatch is
   * already showing would be the one slow thing in it.
   */
  onLayers: () => void;
  /**
   * The draw tool or the corner count changed. The viewer cancels a gesture on
   * its own (Esc, a completed shape), so the toolbar has to be told rather than
   * assuming the mode it last asked for is still live.
   */
  onDraw: (tool: DrawTool | null, points: number) => void;
  /** How many measurements are on screen, across both kinds. Deliberately not
   *  onCount, which means buildings and feeds the site readout. */
  onMeasure: (n: number) => void;
};

/**
 * What the gizmo is attached to. A point has no ring, no colour and no source,
 * so it cannot be squeezed into a Building — the two ride a union instead, and
 * every site that only makes sense for one of them says so.
 */
type Target =
  | { kind: 'building'; obj: THREE.Mesh; b: Building }
  | { kind: 'tree'; obj: THREE.Group; t: Tree }
  | { kind: 'origin'; obj: THREE.Object3D }
  | { kind: 'layer'; obj: THREE.Group; id: LayerId };

/**
 * One undoable gesture.
 *
 * 'building' carries the height beside the xf rather than in a command of its
 * own: both are written from the same panel, both are read back by the same
 * begin/commit pair, and folding them together is what keeps "one gesture, one
 * command" true when a drag and a typed height land in the same edit.
 *
 * 'life' is a building entering or leaving the scene. It holds the record
 * itself, so an undo restores the very same object — with its ring, colour and
 * transform intact — at the index it came from.
 */
type Cmd =
  | {
      label: EditLabelKey;
      kind: 'building';
      b: Building;
      before: Xf;
      after: Xf;
      beforeH: number;
      afterH: number;
    }
  | {
      label: EditLabelKey;
      kind: 'tree';
      t: Tree;
      before: Xf;
      after: Xf;
      beforeH: number;
      afterH: number;
    }
  | { label: EditLabelKey; kind: 'origin'; before: Vec3; after: Vec3 }
  | { label: EditLabelKey; kind: 'life'; b: Building; index: number; added: boolean }
  | { label: EditLabelKey; kind: 'treeLife'; t: Tree; index: number; added: boolean }
  | {
      label: EditLabelKey;
      kind: 'layer';
      id: LayerId;
      before: LayerXf;
      after: LayerXf;
      /**
       * The per-record appearance a restyle stamped over.
       *
       * A layer's colour and opacity are written through into the records that
       * have somewhere to keep them (see styledOf in lib/scene/layers), so
       * undoing means putting every one of them back. The records are held by
       * reference, the way 'life' holds its Building, rather than by index into
       * an array a later add or delete is free to reorder.
       *
       * Empty for a move, and for the merged layers, whose values live on
       * LayerXf and travel in before/after above.
       */
      styles: { rec: Styled; before: Style; after: Style }[];
    };

/**
 * The name the origin reports. A dictionary key rather than a string: the status
 * line translates any param whose value is one (see interpolate in lib/i18n),
 * which is how "Origin recentred — Model origin" comes out in one language.
 */
const ORIGIN_NAME = 'ed.originName';

/** On-screen arm length of each marker, in CSS pixels. Both are deliberately
 *  smaller than the gizmo they sit beside. */
const ORIGIN_PX = 54;
const PIVOT_PX = 38;

/** Diameter of the snap cursor, in CSS pixels. Sized to sit just outside the
 *  10 px the snap itself searches, so the ring reads as the catchment. */
const SNAP_CURSOR_PX = 22;

/**
 * The perspective vertical field of view, and the frustum height it spans per
 * unit of distance.
 *
 * FOV_K is the bridge between the two projections: a perspective camera sitting
 * `d` from its target shows `FOV_K * d` of world height there, so the same
 * expression run backwards turns an orthographic frustum height into the
 * distance that would frame it identically. Both directions of setProjection
 * are that one identity, which is what makes the toggle round-trip exactly.
 */
const FOV = 45;
const FOV_K = 2 * Math.tan((FOV * Math.PI) / 360);

/**
 * How far back the site is framed from, as a multiple of its radius.
 *
 * The 1.05 is margin — the rectangle is not left touching the edges — and the
 * 2.4 is the cone: at 45° it takes ~2.4 radii to span a radius of world at the
 * target. Named because presentation mode has to fly to exactly this distance
 * for its wide shot; two copies of the arithmetic would drift the moment one
 * was tuned.
 */
const FIT_K = 1.05 * 2.4;

/** Either projection. The viewer holds one of each and swaps which is live. */
type ViewerCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

/** How long an axis snap takes, in ms. Long enough to read as a move rather
 *  than a cut — which is the whole point of animating it, since a jump leaves
 *  you working out what you are now looking at. */
const SNAP_MS = 380;

const originXf = (off: THREE.Vector3): Xf => ({
  pos: [off.x, off.y, off.z],
  rot: [0, 0, 0],
  scale: [1, 1, 1],
  color: null,
  opacity: 1,
});

/** A LayerXf dressed as an Xf, so the element editor's position row, colour
 *  swatch and opacity slider render a layer with no second code path — same
 *  trick as originXf. Opacity is resolved rather than passed through, since an
 *  Xf has no null to mean "whatever the stack says this tier draws at". */
const layerXf = (id: LayerId, l: LayerXf): Xf => ({
  pos: [...l.offset] as Vec3,
  rot: [0, 0, 0],
  scale: [1, 1, 1],
  color: l.color,
  opacity: l.opacity ?? defaultLayerOpacity(id),
});

/** What a mesh inside a layer group is for, so a recolour knows which of them
 *  take the layer's colour and which take the accent derived from it. */
type LayerRole = 'fill' | 'edge';

/** Below this a drawn footprint is a slip of the pointer, not a building. */
const MIN_FOOTPRINT_M2 = 1;
/** Shortest extrusion the editor will accept, in metres. */
const MIN_HEIGHT = 0.5;
/** Same purpose as BUILDING_CAP, for the tree tool. */
const TREE_DRAW_CAP = 4000;
/** Click-versus-orbit threshold, in CSS pixels. A press that travels further
 *  than this was a camera move, whether it was aimed at picking or at drawing. */
const CLICK_PX = 5;

/** Twice the shoelace area — sign tells winding, magnitude tells whether the
 *  ring is worth extruding. */
const ringArea2 = (r: Vec2[]): number => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a;
};

/**
 * The three.js preview, kept imperative.
 *
 * This is deliberately not react-three-fiber: it carries TransformControls drag
 * arbitration against OrbitControls, raycast picking with a click-versus-orbit
 * threshold, InstancedMesh trees, and an undo stack keyed on live mesh state.
 * React owns none of that — it hands over a scene and receives callbacks.
 */
export class Viewer {
  private readonly host: HTMLElement;
  private readonly cb: ViewerCallbacks;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly sceneGL: THREE.Scene;
  /**
   * Whichever projection is live. Both cameras exist for the life of the
   * viewer and setProjection swaps which one is pointed at — rather than one
   * camera being rebuilt — so the orbit, the gizmo and the dome all move
   * between two stable objects instead of chasing a new one each time.
   */
  private camera: ViewerCamera;
  private readonly perspCam: THREE.PerspectiveCamera;
  private readonly orthoCam: THREE.OrthographicCamera;
  private ortho = false;
  private readonly controls: OrbitControls;
  private readonly contentGroup: THREE.Group;
  private readonly skyDome: THREE.Mesh;
  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private theme: ViewerTheme = 'light';
  private readonly gizmo: TransformControls;
  private readonly resizeObserver: ResizeObserver;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();

  /* ---- the orientation widget ----
     Drawn into a corner of the same canvas rather than as DOM, so it needs its
     own pointer arbitration; see initTriadPicking. */
  private readonly triad: ViewTriad;
  /** How far the widget is held clear of the right edge, in CSS pixels. React
   *  drives this: the element editor takes that corner when it is open. */
  private rightInset = 12;
  /** The axis a press landed on, and where it landed, pending the release. */
  private triadPress: { axis: ViewAxis; x: number; y: number } | null = null;
  /** Listeners on the host, which outlives the viewer — see initTriadPicking. */
  private readonly listeners = new AbortController();
  /** A snap in flight: where the eye started, the turn to make, the radius to
   *  hold, and the clock. */
  private snap: { from: THREE.Vector3; q: THREE.Quaternion; r: number; t0: number } | null = null;
  private readonly slerpQ = new THREE.Quaternion();

  /**
   * The presentation orbit in flight: two clocks, the azimuth it was entered at,
   * and the camera it was handed — the last two so the sweep can pick up from
   * where the user was rather than cutting to a canned pose. Null when the mode
   * is off, which is the only thing anything else needs to test.
   *
   * The clocks are separate because they answer to different things. `t0` anchors
   * the entry blend and never moves. `tPhase`/`phase0` anchor the loop itself and
   * are re-seated every time the cycle length changes, which is what lets the
   * pace change under a camera that does not — see setOrbitCycle.
   */
  private present: {
    t0: number;
    phase0: number;
    tPhase: number;
    az0: number;
    from: OrbitPose;
    fromTarget: THREE.Vector3;
  } | null = null;
  /** How long one revolution takes. The panel's, once React pushes it down. */
  private orbitCycleMs = DEFAULT_TUNABLES.orbitCycleMs;
  /** Scratch for stepPresent, which runs every frame. */
  private readonly orbitEye = new THREE.Vector3();
  private readonly orbitTarget = new THREE.Vector3();

  /** The scene's centre point: where the exported model's zero sits. */
  private readonly originMarker: THREE.Group;
  private readonly originPick: THREE.Mesh;
  /** A read-only copy drawn at the selected element's own pivot. */
  private readonly pivotGhost: THREE.Group;
  private readonly originOffset = new THREE.Vector3();

  /* ---- footprint authoring ----
     The ground is whatever a new corner lands on: a building's roof when one is
     in front of the terrain, so a new massing can be laid on top of an existing
     or previously drawn one; the terrain mesh next, so a drawn building follows
     a slope instead of floating over it; and a flat plane at the datum
     otherwise. The plane's normal is +Z because this scene is Z-up (see
     camera.up in the constructor), and it doubles as the roof work plane. */
  private groundMesh: THREE.Mesh | null = null;
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private readonly draft: FootprintDraft;
  private drawTool: DrawTool | null = null;
  /** Corners placed so far, in world metres. The last entry of a live gesture
   *  is the one under the cursor, replaced on every move. */
  private drawPts: THREE.Vector3[] = [];
  private drawHeight = 9;
  private drawName = 'Building';
  private drawSeq = 0;
  private drawTreeName = 'Tree';
  private drawTreeSeq = 0;
  /** Where a rectangle drag started; null unless one is in progress. */
  private rectAnchor: THREE.Vector3 | null = null;
  /**
   * The elevation the live gesture is pinned to, once its first corner landed
   * on a roof rather than on the ground; null while drawing on terrain.
   *
   * The start of the gesture decides, and every later corner is picked on a
   * horizontal plane at that height. That is what lets a footprint overhang the
   * roof it was started on instead of falling to the terrain the moment the
   * cursor clears the edge, and it keeps all four corners at one base. On
   * terrain it stays null so each corner keeps its own elevation and the base
   * can go on being the lowest of them.
   *
   * Strictly paired with rectAnchor and drawPts: a stale value would silently
   * pin the next gesture to a roof the user has moved on from.
   */
  private drawPlaneZ: number | null = null;

  /* ---- measuring ----
     Session state only: measurements are never written to the scene, the draft
     or the IFC file, and setScene drops them because their points are world
     coordinates against geometry that is being replaced. */
  private readonly measure: MeasureLayer;
  /**
   * Points placed in the measurement being made. One list serves both tools —
   * a distance completes at two, a ring closes on demand — and it is separate
   * from drawPts because commitFootprint owns that one.
   */
  private measurePts: THREE.Vector3[] = [];
  private measures: Measure[] = [];
  private measureSeq = 0;
  private measureFmt: MeasureFormat = {
    length: (m) => `${m.toFixed(2)} m`,
    area: (a) => `${a.toFixed(2)} m²`,
  };
  /**
   * The last pointer position a measure tool has yet to resolve.
   *
   * Measuring is the first tool that has to raycast the scene before a gesture
   * is live — the snap has to answer while the pointer is merely hovering — and
   * the note on the pointermove handler explains why that is the cost worth
   * avoiding. So the move handler only records where the pointer is and the
   * frame does the work: however fast the pointer travels, the scene is cast at
   * most once per frame.
   */
  private hoverEvent: PointerEvent | null = null;

  private firstFrame = true;
  /** frameCamera's inputs, kept because a projection swap has to re-derive the
   *  frustum from the site and nothing else stored it. */
  private fitRadius = 0;
  private fitZ0 = 0;
  private buildingMeshes: THREE.Mesh[] = [];
  private treeMeshes: THREE.Group[] = [];
  /**
   * One group per category, under contentGroup — what the model tree selects,
   * recolours and moves.
   *
   * LOAD-BEARING: only the groups in MOVABLE_LAYERS ever hold a transform, and
   * nothing individually selectable lives inside one. The buildings and trees
   * groups stay at identity for exactly that reason, so applyXf, applyTreeXf
   * and every world/local conversion the gizmo makes on an element selection
   * are unaffected by their meshes having gained a parent.
   */
  private readonly layerGroups = new Map<LayerId, THREE.Group>();
  /** Layers hidden from view. Deliberately not in LayerXf: hiding is a way to
   *  see through the model, not an edit — it stays out of the undo stack and
   *  out of the file the emitter writes. */
  private readonly hidden = new Set<LayerId>();
  /** The box drawn round the selected layer. Layers have no outline of their
   *  own to recolour the way a building does, and tinting their materials would
   *  fight the colour being edited. */
  private readonly layerBox: THREE.Box3Helper;
  private selected: Target | null = null;
  /** false while the 2D map covers the viewport — nothing to draw behind it. */
  private active = false;
  private raf = 0;
  private disposed = false;

  private scene: SceneData | null = null;
  private compass: HTMLElement | null = null;
  /** Last good compass azimuth, held through a straight-down view. */
  private lastAz = 0;

  private readonly edits: { stack: Cmd[]; index: number; limit: number } = {
    stack: [],
    index: -1,
    limit: 100,
  };
  private pending:
    | { kind: 'building'; b: Building; before: Xf; beforeH: number }
    | { kind: 'tree'; t: Tree; before: Xf; beforeH: number }
    | { kind: 'origin'; before: Vec3 }
    | {
        kind: 'layer';
        id: LayerId;
        before: LayerXf;
        styles: { rec: Styled; before: Style }[];
      }
    | null = null;

  constructor(host: HTMLElement, cb: ViewerCallbacks) {
    this.host = host;
    this.cb = cb;

    this.sceneGL = new THREE.Scene();
    // Fallback for the frame before frameCamera() sizes the dome; the dome covers it after.
    this.sceneGL.background = new THREE.Color(SKY.horizon);

    const aspect = host.clientWidth / Math.max(1, host.clientHeight);
    this.perspCam = new THREE.PerspectiveCamera(FOV, aspect, 1, 200000);
    // The frustum is filled in by frameCamera/applyFrustum before this one is
    // ever rendered; it only has to be non-degenerate until then.
    this.orthoCam = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, -1, 1000);
    // data is E/N/height (Z-up) — must be set before OrbitControls is built.
    //
    // Neither camera's up may change afterwards, and they have to agree:
    // OrbitControls computes its orbit axis from object.up exactly once, when
    // update() is defined (OrbitControls.js:177), and never recomputes it. A
    // camera whose up differs from the one the controls were built with would
    // render on one axis and orbit about another.
    this.perspCam.up.set(0, 0, 1);
    this.orthoCam.up.set(0, 0, 1);
    this.camera = this.perspCam;

    // The dome rides on the camera so orbit distance can never escape it, and the
    // camera goes into the scene graph or its children are never traversed.
    // Both cameras live in the graph; only the dome moves between them.
    this.skyDome = createSkyDome();
    this.camera.add(this.skyDome);
    this.sceneGL.add(this.perspCam, this.orthoCam);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 100000;
    // Orthographic dolly changes zoom rather than distance, so it needs its own
    // clamp — the distance pair above still bounds the orbit radius in both
    // projections and stays as it is. minZoom must not be left at its default
    // of 0: a zero zoom is an infinite frustum, and the sky dome stops covering
    // the viewport.
    this.controls.minZoom = 0.05;
    this.controls.maxZoom = 400;

    // A hemisphere fill does what a flat ambient cannot: an up-facing surface
    // takes the full sky colour, a wall a half-mix with the ground bounce, an
    // underside the bounce alone. That gradient is the whole look — bright roofs,
    // softly shaded sides — and it comes from the light rather than from colours
    // pre-lifted per face, which is what lib/scene/xf used to have to do.
    // The sun is left as the tie-breaker that keeps a sunlit wall apart from a
    // shaded one; carrying the fill as well would flatten the sides again.
    //
    // Both intensities are written as the irradiance actually wanted times π —
    // read them as 0.85 fill and 0.3 sun. three r155+ passes light intensities
    // through unscaled (WebGLRenderer._useLegacyLights is false) while the Lambert
    // BRDF keeps its 1/π, so an intensity of 1 reaches a surface as 1/π. Drop the
    // Math.PI and the whole scene goes three times too dark — which does not look
    // like a bug from inside the render, because it darkens everything uniformly:
    // it reads as "the colours were chosen too dark", and sends you editing hexes.
    const hemi = new THREE.HemisphereLight(0xffffff, 0xe0e2e4, 0.85 * Math.PI);
    // HemisphereLight reads "up" off its own position, which defaults to +Y.
    // Data is Z-up (see camera.up above), so left alone the sky would shine from
    // due north and roofs would come out no brighter than walls.
    hemi.position.set(0, 0, 1);
    this.sceneGL.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 0.3 * Math.PI);
    sun.position.set(180, -260, 520);
    this.sceneGL.add(sun);
    // Held so setTheme can retune them. Both stay in the scene for its life.
    this.hemi = hemi;
    this.sun = sun;

    this.contentGroup = new THREE.Group();
    this.sceneGL.add(this.contentGroup);

    // The gizmo lives on the scene, never on contentGroup — disposeGroup() would
    // eat it on the next rebuild.
    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSpace('local');
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value; // or OrbitControls fights the drag
      if (e.value) this.beginEdit(); // one drag == one undo step
      else this.commitEdit(MODE_LABEL[this.gizmo.getMode() as GizmoMode] || 'edit.move');
    });
    this.gizmo.addEventListener('objectChange', () => {
      const t = this.selected;
      if (!t) return;
      if (t.kind === 'origin') {
        this.originOffset.copy(this.originMarker.position);
        this.cb.onOrigin(this.originOffset.toArray() as Vec3);
        this.cb.onTransform(originXf(this.originOffset), 0);
      } else if (t.kind === 'building') {
        this.readMeshInto(t.obj, t.b.xf);
        this.cb.onTransform(cloneXf(t.b.xf), t.b.h);
      } else if (t.kind === 'layer') {
        // The group's transform IS the offset, so there is nothing to convert.
        const l = this.layerState(t.id);
        if (!l) return;
        l.offset = t.obj.position.toArray() as Vec3;
        this.syncLayerBox();
        this.cb.onTransform(layerXf(t.id, l), 0);
      } else {
        this.readTreeMeshInto(t.obj, t.t.xf);
        this.cb.onTransform(cloneXf(t.t.xf), t.t.h);
      }
      this.cb.onDirty();
    });

    this.gizmo.setSize(0.5);
    this.sceneGL.add(this.gizmo);


    // Both markers sit on the scene for the same reason the gizmo does.
    this.originMarker = createOriginMarker(false);
    // Off until asked for: the model origin matters when you are placing the
    // file, not while you are reading the massing.
    this.originMarker.visible = false;
    this.originPick = markerPick(this.originMarker);
    this.pivotGhost = createOriginMarker(true);
    this.pivotGhost.visible = false;
    // The draft sits on the scene beside the markers, for the same reason: it
    // has to survive the disposeGroup that clears contentGroup on a rebuild.
    this.draft = createFootprintDraft();
    // And the measure layer beside it, for the same reason. Its labels are DOM
    // rather than geometry, so they go on the host under the canvas overlay
    // instead — see .measureLayer in globals.css for where that sits.
    this.measure = createMeasureLayer();
    host.appendChild(this.measure.dom);
    this.sceneGL.add(this.originMarker, this.pivotGhost, this.draft.group, this.measure.group);

    // Same reason again — and it is drawn round contentGroup's children, so
    // being one of them would make it enclose itself.
    this.layerBox = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(0x1f8ac0));
    this.layerBox.visible = false;
    this.sceneGL.add(this.layerBox);

    this.triad = createViewTriad();

    // Registered on the host and in the capture phase, so it runs before both
    // OrbitControls and initPicking — see initTriadPicking.
    this.initTriadPicking();
    this.initPicking();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.animate();
  }

  /** The compass HUD is written to directly: it updates every frame. */
  setCompassElement(el: HTMLElement | null): void {
    this.compass = el;
  }

  private resize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (w <= 0 || h <= 0) return;
    this.renderer.setSize(w, h, false);
    const c = this.camera;
    if (c instanceof THREE.OrthographicCamera) {
      // The vertical extent is the state of record and left/right follow it,
      // which is what a vertical fov does under perspective — so widening the
      // window reveals more of the site in both projections rather than
      // stretching in one and revealing in the other.
      const half = (c.top - c.bottom) / 2;
      c.left = -half * (w / h);
      c.right = half * (w / h);
    } else {
      c.aspect = w / h;
    }
    c.updateProjectionMatrix();
  }

  private updateCompass(): void {
    if (!this.compass) return;
    const dir = this.camera.position.clone().sub(this.controls.target);
    // Looking straight down there is no horizontal component to take a bearing
    // from, and atan2 on the float noise that is left spins the needle. Hold
    // the last real reading instead — which is also what the eye expects, since
    // a plan view has no heading to report in the first place.
    if (Math.hypot(dir.x, dir.y) > 1e-6 * Math.abs(dir.z))
      this.lastAz = (Math.atan2(dir.x, dir.y) * 180) / Math.PI; // Y=north in local E/N coords
    // The needle marks north, so the 180 is not a fudge — it is the half turn
    // between the two things being measured. lastAz is the bearing of the eye
    // seen from the pivot; you look back the other way, so the bearing at the
    // top of the screen is lastAz + 180, and north lands at -lastAz - 180 from
    // there. The needle rests pointing up and rotate() runs clockwise, so that
    // angle is the transform. Drop the 180 and the needle points due south at
    // every camera angle, which is what it used to do.
    //
    // A flat rose can only ever show the plan bearing: tilt the camera and the
    // projected direction of north drifts off it (~57 degrees against a plan
    // bearing of ~36 at the default framing). That is inherent to drawing a 3D
    // heading in 2D, and the plan bearing is the honest half of it.
    this.compass.style.transform = `rotate(${180 - this.lastAz}deg)`;
  }

  /**
   * Hold an object at a constant pixel size, the way TransformControls holds the
   * gizmo — a marker sized in metres is either invisible across a 1 km site or
   * fills the screen at a doorway. Rendering is continuous, so this is free.
   */
  private scaleToScreen(o: THREE.Object3D, px: number): void {
    const c = this.camera;
    const h = Math.max(1, this.host.clientHeight);
    const worldPerPx =
      c instanceof THREE.OrthographicCamera
        ? // A parallel projection has no foreshortening, so how far away the
          // marker is does not enter into it — the frustum height alone sets
          // the scale.
          (c.top - c.bottom) / c.zoom / h
        : (FOV_K * c.position.distanceTo(o.position)) / h;
    o.scale.setScalar(worldPerPx * px);
  }

  private updateMarkers(): void {
    if (this.originMarker.visible) this.scaleToScreen(this.originMarker, ORIGIN_PX);
    const t = this.selected;
    // The ghost tracks the mesh's own frame, rotation included, so it reads as
    // the element's local axes rather than as a second copy of the world's.
    this.pivotGhost.visible = t?.kind === 'building';
    if (t?.kind === 'building') {
      this.pivotGhost.position.copy(t.obj.position);
      this.pivotGhost.quaternion.copy(t.obj.quaternion);
      this.scaleToScreen(this.pivotGhost, PIVOT_PX);
    }
  }

  /**
   * Resolve the pointer the move handler parked, then hold the readouts and the
   * snap cursor where the camera puts them.
   *
   * Done here rather than on pointermove so that a fast sweep across a large
   * terrain costs one raycast per frame instead of one per event, and so that
   * the labels follow an orbit — which moves them without the pointer moving at
   * all.
   */
  private updateMeasure(): void {
    const kind = measureKindOf(this.drawTool);
    // Nothing measured and no tool in hand is the overwhelmingly common case, and
    // it has to cost nothing: sync reads the canvas rect, which forces layout.
    if (!kind && !this.measures.length) return;

    const e = this.hoverEvent;
    this.hoverEvent = null;
    if (kind && e) {
      const s = this.pickMeasure(e);
      if (s) this.measure.setLive(kind, [...this.measurePts, s.p], s.kind);
    }

    const cur = this.measure.snapCursor;
    if (cur.visible) {
      this.scaleToScreen(cur, SNAP_CURSOR_PX);
      // A flat ring in a Z-up scene lies on the ground and vanishes edge-on the
      // moment the camera drops towards the horizon. Facing it at the camera is
      // what keeps it a ring from every angle.
      cur.quaternion.copy(this.camera.quaternion);
    }

    this.measure.sync(
      this.camera,
      this.renderer.domElement.getBoundingClientRect(),
      this.measureFmt,
    );
  }

  private animate = (now = 0): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.animate);
    if (!this.active) return; // the map is up; nothing to draw behind it
    // A snap writes the camera position itself, so the controls have to stand
    // down for the duration or they overwrite it on the same frame. They still
    // get the last word on orientation — see stepSnap. The presentation orbit
    // drives the camera the same way and for the same reasons, and the two are
    // mutually exclusive: entering the mode cancels any snap, and nothing can
    // start one while it runs.
    if (this.snap) this.stepSnap(now);
    else if (this.present) this.stepPresent(now);
    this.controls.update();
    // Scroll changes zoom rather than distance under a parallel projection, so
    // the dome has to follow it every frame — see syncSkyDome.
    if (this.ortho) this.syncSkyDome();
    this.updateCompass();
    this.updateMarkers();
    this.updateMeasure();
    this.renderer.render(this.sceneGL, this.camera);
    this.triad.render(this.renderer, this.camera, this.rightInset);
  };

  setActive(on: boolean): void {
    // animate() returns early while the map is up, so a snap left in flight
    // would freeze part-way and resume whenever the tab came back. Land it.
    if (!on) this.finishSnap();
    this.active = on;
    if (on) this.resize();
  }

  /* ---- axis snapping --------------------------------------------------
     The camera is driven directly for the length of the tween, then handed
     back. OrbitControls re-derives its own spherical state from wherever the
     camera ends up on the next update(), so the two can never disagree — the
     only thing that has to be true is that they are not both writing at once.
     -------------------------------------------------------------------- */

  /** Point the camera down an axis, keeping the orbit target and distance. */
  snapTo(axis: ViewAxis): void {
    const off = this.camera.position.clone().sub(this.controls.target);
    const r = off.length();
    if (r < 1e-6) return;
    const from = off.divideScalar(r);
    const to = axisEye(axis);
    if (from.dot(to) > 1 - 1e-9) return; // already there

    // The tail of the last drag is still in the controls' spherical delta, and
    // it decays rather than stopping — left alone it keeps turning underneath
    // the tween and kicks the camera when the tween hands back. One update with
    // damping off applies it and zeroes it in the same call.
    const damp = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = damp;

    // The whole rotation, resolved once. setFromUnitVectors picks an arbitrary
    // perpendicular axis when the two are opposed, which is what makes E->W and
    // N->S work at all — there is no shortest arc between them to find.
    this.snap = {
      from,
      q: new THREE.Quaternion().setFromUnitVectors(from, to),
      r,
      t0: performance.now(),
    };
  }

  private stepSnap(now: number): void {
    const s = this.snap;
    if (!s) return;
    const k = Math.min(1, (now - s.t0) / SNAP_MS);
    // Cubic in-out: the ends matter more than the middle here, because a snap
    // that starts abruptly reads as a jump however long it then takes.
    const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
    // Rotate the eye *direction* and hold the radius. Lerping the position
    // instead would cut the corner, swinging the camera in through the site and
    // back out again.
    const dir = s.from.clone().applyQuaternion(this.slerpQ.identity().slerp(s.q, e));
    this.camera.position.copy(this.controls.target).addScaledVector(dir, s.r);
    if (k >= 1) this.snap = null;
  }

  /** Land a snap where it was headed. */
  private finishSnap(): void {
    if (this.snap) this.stepSnap(this.snap.t0 + SNAP_MS);
  }

  /** Drop a snap where it stands. The controls pick up from there. */
  private cancelSnap(): void {
    this.snap = null;
  }

  /* ---- presentation ---------------------------------------------------
     An endless cinematic orbit about the model origin, for showing the model
     without a hand on the mouse. It borrows the snap's handshake wholesale —
     the camera is driven directly and handed back on exit — and adds one thing
     the snap does not need: the controls are switched off for the duration.

     A snap is over in 380 ms, so leaving the controls live merely means they
     have nothing to say. This runs until it is stopped, and a drag against a
     scripted path is not an orbit — every frame would overwrite it, and the
     model would judder rather than respond. So the pointer is parked, the same
     arbitration the gizmo makes in dragging-changed and the rectangle tool
     makes for the length of its drag.
     -------------------------------------------------------------------- */

  /** The distance the whole site is framed from — frameCamera's own, so the
   *  wide end of the orbit is exactly the shot a rebuild composes. */
  private fitDistance(): number {
    return Math.max(1, this.fitRadius * FIT_K);
  }

  /**
   * Start or stop the presentation orbit.
   *
   * Idempotent at this end like every other toggle here, so React can push it
   * on a render without having to know whether it is already in force.
   */
  setPresentation(on: boolean): void {
    if (on === !!this.present) return;
    if (!on) {
      this.present = null;
      // Wherever the orbit left the camera is now the view. The controls
      // re-derive their spherical state from it on this call, so there is no
      // moment where the two disagree.
      this.controls.enabled = true;
      this.controls.update();
      return;
    }
    // Nothing to orbit, and fitRadius is still zero — the wide shot would be a
    // metre from the origin. React gates the button on hasScene; this is the
    // guard for every other caller.
    if (!this.scene) return;

    this.cancelSnap();
    // A tool armed behind a hidden toolbar is waiting on clicks that no longer
    // reach it, and a gizmo floating over the model is the one thing a
    // presentation must not show.
    this.setDrawMode(null);
    this.select(null);

    // The tail of the last drag is still in the controls' spherical delta and
    // decays rather than stopping. Left alone it turns underneath the orbit and
    // kicks the camera when the mode ends. One update with damping off applies
    // it and zeroes it in the same call — see snapTo, which does this for the
    // identical reason.
    const damp = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = damp;
    this.controls.enabled = false;

    const t0 = performance.now();
    const from = poseOf(this.camera.position.clone().sub(this.controls.target));
    this.present = {
      t0,
      phase0: 0,
      tPhase: t0,
      az0: from.az,
      from,
      fromTarget: this.controls.target.clone(),
    };

    // Under parallel rays the eye's distance frames nothing — zoom does. Fix
    // the frustum height at the site's framing distance here so stepPresent can
    // carry the whole breath of the orbit in zoom alone, using the same FOV_K
    // identity setProjection is built on.
    if (this.camera instanceof THREE.OrthographicCamera) {
      const h = FOV_K * this.fitDistance();
      this.camera.top = h / 2;
      this.camera.bottom = -h / 2;
      this.resize(); // left/right follow the vertical extent
    }
  }

  /** Whether the orbit is running. */
  isPresenting(): boolean {
    return !!this.present;
  }

  /** Where in the loop we are, 0..1, given an anchor and the phase it stood at. */
  private phaseAt(now: number, tPhase: number, phase0: number): number {
    return (((now - tPhase) / this.orbitCycleMs + phase0) % 1 + 1) % 1;
  }

  /**
   * How long one revolution takes, in ms.
   *
   * Idempotent like every other setter here, so React can push it on a render
   * without knowing whether it is already in force — and safe to call while the
   * orbit is running, which is the point. The phase is frozen at its current
   * value before the divisor changes, so what the viewer does at the moment of
   * the change is speed up or slow down; azimuth, elevation and distance are all
   * exactly where they were. Recomputing phase from an unmoved anchor instead
   * would teleport the camera, which is the one thing this mode exists to avoid.
   *
   * `t0` is deliberately left alone: it anchors the entry blend, and re-seating
   * it would restart the ease-in under someone who nudged the slider on the way in.
   */
  setOrbitCycle(ms: number): void {
    // The panel's slider cannot emit a bad value, but this is a public surface
    // and localStorage is not the only way in. Finiteness before the clamp, the
    // same order sanitizeTunables takes and for the same reason.
    const [lo, hi] = TUNE_RANGE.orbitCycleMs;
    const next = Number.isFinite(ms)
      ? Math.min(hi, Math.max(lo, ms))
      : DEFAULT_TUNABLES.orbitCycleMs;
    if (next === this.orbitCycleMs) return;
    const p = this.present;
    if (p) {
      const now = performance.now();
      p.phase0 = this.phaseAt(now, p.tPhase, p.phase0);
      p.tPhase = now;
    }
    this.orbitCycleMs = next;
  }

  private stepPresent(now: number): void {
    const p = this.present;
    if (!p) return;
    const fit = this.fitDistance();
    const elapsed = now - p.t0;
    // Modulo rather than a wrapped counter: the phase is a pure function of the
    // clock since the last change of pace, so a dropped frame costs a frame
    // rather than desynchronising the loop from its own elevation. Only
    // setOrbitCycle moves the anchor, and it moves phase0 with it.
    const phase = this.phaseAt(now, p.tPhase, p.phase0);
    let pose = orbitPose(phase, p.az0, fit);

    // The entry blend. Azimuth is already continuous — orbitPose is built from
    // the azimuth the mode was entered at — so this is easing elevation,
    // distance and the pivot from wherever the user was onto the path. Without
    // it the mode opens with a cut, which is the one thing it exists to avoid.
    const k = Math.min(1, elapsed / ENTRY_MS);
    this.orbitTarget.set(0, 0, this.fitZ0);
    if (k < 1) {
      const e = easeInOut(k);
      pose = lerpPose(p.from, pose, e);
      this.orbitTarget.lerpVectors(p.fromTarget, this.orbitTarget, e);
    }

    this.controls.target.copy(this.orbitTarget);
    this.camera.position.copy(eyeOf(pose, this.orbitTarget, this.orbitEye));

    if (this.camera instanceof THREE.OrthographicCamera) {
      // The framing a perspective camera would show from pose.dist, expressed
      // as zoom against the fixed frustum height set on entry.
      this.camera.zoom = fit / Math.max(1e-3, pose.dist);
      this.camera.updateProjectionMatrix();
    }
    // Perspective needs no frustum work: applyFrustum spans on fitRadius * 2.52
    // rather than on the current distance, and the orbit never goes further out
    // than that, so near and far are already right for every pose in the loop.
  }

  /**
   * Pointer handling for the orientation widget.
   *
   * The widget is drawn into the canvas, so its clicks arrive as canvas clicks
   * and something has to take them first. Capture phase on the host rather than
   * on the canvas: at the target element listeners run in the order they were
   * added whatever phase they claim, and OrbitControls got there first.
   *
   * The rule is that a press either belongs to the widget entirely or does not
   * touch it. Nothing downstream — initPicking, OrbitControls, the gizmo — has
   * to know this exists.
   */
  private initTriadPicking(): void {
    const opt = { capture: true, signal: this.listeners.signal };
    const dom = this.renderer.domElement;
    // A footprint tool owns every click on the ground; the widget must not
    // swallow one and turn a corner into a view change. The presentation orbit
    // owns the camera outright, so a widget press during one would start a snap
    // that fights it for the length of the tween.
    const hit = (e: PointerEvent): ViewAxis | null =>
      this.active && !this.drawTool && !this.present
        ? this.triad.pick(e, dom, this.rightInset)
        : null;

    this.host.addEventListener(
      'pointerdown',
      (e) => {
        const axis = hit(e);
        if (!axis) return this.cancelSnap(); // a press anywhere else ends a tween
        this.triadPress = { axis, x: e.clientX, y: e.clientY };
        this.host.setPointerCapture(e.pointerId);
        e.stopPropagation();
        e.preventDefault();
      },
      opt,
    );

    this.host.addEventListener(
      'pointerup',
      (e) => {
        const p = this.triadPress;
        this.triadPress = null;
        if (!p) return;
        this.host.releasePointerCapture(e.pointerId);
        e.stopPropagation();
        e.preventDefault();
        // The same click-versus-orbit threshold the scene pick uses, so a slip
        // of the pointer on the widget is a miss rather than a view change.
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) <= CLICK_PX) this.snapTo(p.axis);
      },
      opt,
    );

    this.host.addEventListener(
      'pointermove',
      (e) => {
        if (this.triadPress) {
          e.stopPropagation();
          return;
        }
        this.host.style.cursor = hit(e) ? 'pointer' : '';
      },
      opt,
    );

    // Scrolling is a deliberate camera move, so it ends a tween — but it is
    // still the controls' event and is left to reach them.
    this.host.addEventListener('wheel', () => this.cancelSnap(), opt);
  }

  /** Hold the widget clear of whatever is docked on the right, in CSS pixels. */
  setRightInset(px: number): void {
    this.rightInset = px;
  }

  /** z0 is the site's ground elevation: model z is absolute where the scene has a
   *  vertical datum, so orbiting about z = 0 would put the pivot as far under the
   *  ground as the site is above sea level. */
  private frameCamera(radius: number, z0: number): void {
    this.fitRadius = radius;
    this.fitZ0 = z0;
    const dist = radius * FIT_K;
    const target = new THREE.Vector3(0, 0, z0);
    if (this.firstFrame) {
      this.camera.position.set(dist * 0.55, -dist * 0.75, dist * 0.5 + z0);
      this.controls.target.copy(target);
      this.firstFrame = false;
    } else {
      // keep the user's current orbit direction, just rescale distance to the new site radius
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      this.controls.target.copy(target);
      this.camera.position.copy(dir.multiplyScalar(dist)).add(target);
    }
    if (this.camera instanceof THREE.OrthographicCamera) {
      // The framing an equivalent perspective camera would show from here, so a
      // rebuild lands on the same view whichever projection is up.
      const h = FOV_K * dist;
      this.camera.top = h / 2;
      this.camera.bottom = -h / 2;
      this.camera.zoom = 1;
    }
    this.applyFrustum();
    this.resize(); // left/right follow the new vertical extent
    this.controls.update();
  }

  /**
   * Near, far and the sky dome, for whichever camera is live.
   *
   * Split out of frameCamera because a projection swap has to redo all three
   * without touching the eye — and because the two projections want genuinely
   * different answers, not a shared one with a branch bolted on.
   */
  private applyFrustum(): void {
    const c = this.camera;
    const dist = c.position.distanceTo(this.controls.target);
    // The site's own framing distance, not the current one: a user dollied
    // right up to a wall should not drag near/far in with them.
    const span = Math.max(dist, this.fitRadius * FIT_K, 1);
    if (c instanceof THREE.OrthographicCamera) {
      // A parallel frustum is a box, not a cone. A slab starting at the eye
      // clips whatever the orbit has left behind it, and there is no depth
      // precision to buy back by keeping near positive — ortho depth is linear.
      c.near = -span * 0.5;
      c.far = span * 25;
    } else {
      c.near = Math.max(0.5, span / 2000);
      c.far = span * 25;
    }
    c.updateProjectionMatrix();
    this.syncSkyDome();
  }

  /**
   * Size the sky dome for the projection in force.
   *
   * The dome is a sphere centred on the eye, so under parallel rays the
   * gradient it shows is set purely by its radius: make it large and every
   * pixel's view ray tilts by the same negligible amount, the gradient
   * flattens to one fill and the horizon disappears. Sizing it to the distance
   * a 45° cone would need to span the current frustum reproduces the
   * perspective spread exactly, so the sky is unchanged across the toggle.
   *
   * That radius tracks zoom, which is why this runs per frame under parallel
   * rather than only when the frustum is rebuilt — hold it fixed and the
   * horizon crawls as you scroll. It leaves the dome small enough to sit inside
   * the site, which is harmless: it writes no depth and draws first (sky.ts),
   * so it is a backdrop wherever it lands. At ~1.21x the frustum height it
   * still clears the half-diagonal at any sane aspect.
   */
  private syncSkyDome(): void {
    const c = this.camera;
    this.skyDome.scale.setScalar(
      c instanceof THREE.OrthographicCamera ? (c.top - c.bottom) / c.zoom / FOV_K : c.far * 0.4,
    );
  }

  /**
   * Swap the projection, keeping the view.
   *
   * The framing that has to survive is the world height on show at the orbit
   * target: FOV_K * distance under perspective, (top - bottom) / zoom under
   * parallel. Equating the two gives both directions, so a round trip returns
   * the eye to where it started — with any orthographic zooming done in
   * between converted into distance, which is the only honest reading of it.
   */
  setProjection(ortho: boolean): void {
    if (ortho === this.ortho) return;
    const from = this.camera;
    const to: ViewerCamera = ortho ? this.orthoCam : this.perspCam;
    const target = this.controls.target;
    const dist = Math.max(1e-3, from.position.distanceTo(target));

    if (ortho) {
      const h = FOV_K * dist;
      this.orthoCam.top = h / 2;
      this.orthoCam.bottom = -h / 2;
      this.orthoCam.zoom = 1;
      this.orthoCam.position.copy(from.position); // the eye does not move
    } else {
      const h = (this.orthoCam.top - this.orthoCam.bottom) / this.orthoCam.zoom;
      const d = THREE.MathUtils.clamp(
        h / FOV_K,
        this.controls.minDistance,
        this.controls.maxDistance,
      );
      const dir = from.position.clone().sub(target).normalize();
      this.perspCam.position.copy(dir.multiplyScalar(d)).add(target);
    }
    to.quaternion.copy(from.quaternion);

    // The dome is parented to the camera, so it has to travel with the swap;
    // both cameras are already in the scene graph, so nothing else moves.
    from.remove(this.skyDome);
    to.add(this.skyDome);

    this.camera = to;
    this.ortho = ortho;
    // Reassigning the controls' camera works because update() reads
    // scope.object throughout. Its one bare `object` reference — the lookAt at
    // OrbitControls.js:362 — sits behind zoomToCursor, which is off. Turning
    // zoomToCursor on would break this.
    this.controls.object = to;
    this.gizmo.camera = to; // a defineProperty setter; TC already branches on ortho
    this.applyFrustum();
    this.resize();
    this.controls.update();
  }

  private static disposeGroup(g: THREE.Object3D): void {
    // Deduped because a ghost shell shares its parent's buffer rather than
    // cloning it (see syncShell), so the traverse reaches the same geometry
    // twice and the second dispose would fire on a buffer already freed.
    const seen = new Set<THREE.BufferGeometry | THREE.Material>();
    const drop = (r: THREE.BufferGeometry | THREE.Material): void => {
      if (seen.has(r)) return;
      seen.add(r);
      r.dispose();
    };
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) drop(m.geometry);
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(drop);
    });
    while (g.children.length) g.remove(g.children[0]);
  }

  /**
   * The highest counter already spoken for by a set of generated ids.
   *
   * Used by setScene to resume the drawn-element counters over a restored draft.
   * It reads the ids rather than counting the records because deleting the
   * middle one of three drawn buildings must not make the next one reuse an id
   * that is still on the undo stack.
   */
  private static maxSeq(items: { id: string }[], pattern: RegExp): number {
    let max = 0;
    for (const it of items) {
      const m = pattern.exec(it.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max;
  }

  /* ---- layers ---------------------------------------------------------
     A category, as one node of the scene graph. Grouping is what makes the
     model tree possible at all: before it, everything but the buildings, the
     trees and the terrain was an anonymous local const dropped into
     contentGroup, with nothing to select, recolour or move.

     Created lazily, so a group only exists for a layer the build actually
     produced — an empty group would report itself to the tree as a layer that
     is there and simply has nothing in it. disposeGroup traverses, so a
     rebuild still tears these down with contentGroup; setScene only has to
     forget the handles.
     ------------------------------------------------------------------- */

  private layerGroup(id: LayerId): THREE.Group {
    const held = this.layerGroups.get(id);
    if (held) return held;
    const g = new THREE.Group();
    g.name = id;
    g.userData.layer = id;
    // The offset is scene state, not view state, so a group built for a scene
    // that already carries one starts where that scene says — which is what an
    // undo replaying through setScene would need if it ever did.
    g.position.fromArray(this.layerState(id)?.offset ?? [0, 0, 0]);
    this.contentGroup.add(g);
    this.layerGroups.set(id, g);
    return g;
  }

  private layerState(id: LayerId): LayerXf | null {
    return this.scene?.layers[id] ?? null;
  }

  /** Redraw the selection box round whatever layer is selected. Recomputed
   *  rather than translated: a drag is the only thing that moves it, and
   *  setFromObject is cheap beside the frame it lands in. */
  private syncLayerBox(): void {
    const t = this.selected;
    if (t?.kind !== 'layer') {
      this.layerBox.visible = false;
      return;
    }
    this.layerBox.box.setFromObject(t.obj);
    this.layerBox.visible = !this.layerBox.box.isEmpty();
  }

  /**
   * Repaint one layer from the model.
   *
   * Where the colour is read from depends on where it is kept, which is the
   * same split tintedOf makes: buildings, trees and context surfaces carry
   * their own and were stamped in place, so their existing paint methods do the
   * work; terrain, roads and railways are one merged element apiece with
   * nowhere to keep one, so they read LayerXf.color.
   */
  private paintLayer(id: LayerId): void {
    const s = this.scene;
    const g = this.layerGroups.get(id);
    if (!s || !g) return;

    if (id === 'buildings') {
      for (const m of this.buildingMeshes) this.paintMesh(m, m.userData.building as Building);
      return;
    }
    if (id === 'trees') {
      for (const gr of this.treeMeshes) this.paintTreeMesh(gr, gr.userData.tree as Tree);
      return;
    }

    const fallback = defaultLayerColor(id);
    // Opacity is layer-level for everything painted here: a Surface has never
    // carried one of its own. Below 1 it must not write depth, or the layer
    // hides what it is meant to be a tint over — including its own far side,
    // which is what makes a ghosted layer readable at all. Render order is
    // deliberately left alone: the stacking ladder in lib/scene/stack still
    // decides who wins, and promoting a translucent layer to the top would
    // reorder it against the ones it is now being seen through.
    const a = layerAlpha(s, id);
    for (const o of g.children) {
      const role = o.userData.layerRole as LayerRole | undefined;
      if (!role) continue;
      const mat = (o as THREE.Mesh).material as THREE.Material & { color: THREE.Color };
      setTranslucency(mat, a);
      if (role === 'fill') {
        const own = (o.userData.surface as Surface | undefined)?.color;
        mat.color.setHex(own ?? s.layers[id].color ?? fallback);
        continue;
      }
      // The accent line on a road or a track. Left at its hand-picked constant
      // while the layer is at its default — those two pairs were tuned together
      // — and derived from the override otherwise, since a recoloured ribbon
      // with the old grey edging reads as a mistake rather than as a choice.
      const over = s.layers[id].color;
      mat.color.setHex(over === null ? (o.userData.edgeColor as number) : lighten(over, 0.18));
    }
  }

  /**
   * The model tree, derived rather than stored.
   *
   * React holds no scene — it sees derived numbers and the selected element's
   * snapshot — so the tree is pulled from here whenever the counts change,
   * which is a signal onCount already sends. That is one fewer callback than
   * pushing it, and it cannot go stale against the scene it describes.
   */
  layerTree(): LayerNode[] {
    const s = this.scene;
    if (!s) return [];
    return LAYER_IDS.map((id) => {
      const count = layerCount(s, id);
      const items =
        id === 'buildings'
          ? s.buildings.map((b) => ({ id: b.id, name: b.name }))
          : id === 'trees'
            ? s.trees.map((t) => ({ id: t.id, name: t.name }))
            : [];
      return {
        id,
        label: LAYER_LABEL[id],
        count,
        color: s.layers[id].color ?? defaultLayerColor(id),
        movable: MOVABLE_LAYERS.has(id),
        visible: this.shown(id),
        items,
      };
    }).filter((n) => n.count > 0);
  }

  /** Whether a layer is on screen right now. */
  private shown(id: LayerId): boolean {
    return !this.hidden.has(id);
  }

  /** True when the current selection lives under the given layer — a building
   *  or a tree under their fixed category, or the layer group itself. */
  private selectionIn(id: LayerId): boolean {
    const t = this.selected;
    if (!t) return false;
    if (t.kind === 'building') return id === 'buildings';
    if (t.kind === 'tree') return id === 'trees';
    return t.kind === 'layer' && t.id === id;
  }

  /** Show or hide a whole category. Purely a view toggle — kept off LayerXf so
   *  it never enters the undo stack or the exported file. A hidden layer loses
   *  its selection, the same reason setMarkerVisible drops one on the origin:
   *  a gizmo has no business on something that is not on screen. */
  setLayerVisible(id: LayerId, on: boolean): void {
    if (on) this.hidden.delete(id);
    else this.hidden.add(id);
    const g = this.layerGroups.get(id);
    if (g) g.visible = on;
    if (!on && this.selectionIn(id)) this.selectTarget(null);
    this.cb.onLayers();
  }

  /** Select a whole category. The tree's own affordance: layers are deliberately
   *  not raycast (see initPicking), or every click on the ground would take the
   *  selection off the building the user was aiming at. */
  selectLayer(id: LayerId | null): void {
    if (id === null || this.hidden.has(id)) return this.selectTarget(null);
    const g = this.layerGroups.get(id);
    this.selectTarget(g ? { kind: 'layer', obj: g, id } : null);
  }

  setScene(scene: SceneData, site: Site): void {
    this.scene = scene;
    // Measurements are world points taken against geometry that is about to be
    // replaced. Left alone they would float over the new scene reading numbers
    // about the old one, which is worse than losing them.
    this.resetMeasures();
    // A restored draft brings its hand-drawn elements back with the ids they were
    // saved under, so the counters have to resume past them: left at zero, the
    // next footprint drawn would be handed an id a building in the scene already
    // answers to, and select() would pick whichever it found first. A freshly
    // built scene contains no drawn-* id at all, so this is zero there — which is
    // what the fields were initialised to anyway.
    this.drawSeq = Viewer.maxSeq(scene.buildings, /^drawn-(\d+)$/);
    this.drawTreeSeq = Viewer.maxSeq(scene.trees, /^drawn-tree-(\d+)$/);
    this.clearHistory();
    this.setDrawMode(null);
    this.selectTarget(null);
    this.buildingMeshes = [];
    this.treeMeshes = [];
    this.groundMesh = null;
    this.layerGroups.clear();
    // A new scene starts fully visible: nothing carries over from a layer left
    // hidden in the one it replaces.
    this.hidden.clear();
    Viewer.disposeGroup(this.contentGroup);

    // Where the ground is. Everything the builder produced is in absolute model z
    // once the scene has a vertical datum, so the reference plane has to rise to
    // meet it — left at zero it reads as the ground and puts the whole site
    // apparently in mid-air. Null datum means a flat scene, and zero is right.
    const z0 = scene.datumZ ?? 0;
    // A rebuild re-derives the site, so an offset measured against the old one
    // means nothing — the origin goes back to the centre with it, resting on the
    // ground rather than floating at elevation zero.
    this.setOrigin([0, 0, z0], false);

    const { halfX, halfY } = site;

    // The rectangle drawn on the map, so the site boundary is readable in 3D too.
    const outline = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-halfX, -halfY, z0),
      new THREE.Vector3(halfX, -halfY, z0),
      new THREE.Vector3(halfX, halfY, z0),
      new THREE.Vector3(-halfX, halfY, z0),
    ]);
    this.contentGroup.add(
      new THREE.LineLoop(
        outline,
        // Dark rather than the brand yellow: on a near-white stage yellow is the
        // one hue that disappears, and a thin dark boundary suits the
        // drawing-on-paper register the scene reads in now.
        new THREE.LineBasicMaterial({ color: 0x3d4245, transparent: true, opacity: 0.55 }),
      ),
    );

    if (scene.roads.length) {
      const pos: number[] = [];
      // Triangles, since finishRoads conforms the ribbon to the terrain — the
      // fan is a no-op on them, and stays only because it is exact for any
      // convex face if that ever changes back.
      for (const f of scene.roads)
        for (let k = 2; k < f.length; k++) pos.push(...f[0], ...f[k - 1], ...f[k]);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      // The roadway is draped a few centimetres over the terrain, so it needs a
      // nudge toward the camera to win that tie. Only a nudge, though: polygon
      // offset scales with depth slope, and the -4 this used to carry pulled a
      // ribbon seen edge-on clean through the buildings beside it. One unit
      // against the ground's +1 is a two-unit gap, which is plenty now that the
      // layers are genuinely separated in z. Tier 4: above water, below hedges.
      const roadMesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          // Unlit, so this value reaches the screen as written — no light factor
          // to divide out the way the Lambert surfaces need. Which is also why it
          // is this much darker than it looks next to the buildings: they are
          // off-white base colours the light drops to ~#d8 on a wall, this is not.
          color: ROAD_COLOR,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      );
      roadMesh.renderOrder = DRAW_ORDER.ROAD;
      roadMesh.userData.layerRole = 'fill' satisfies LayerRole;
      this.layerGroup('roads').add(roadMesh);
      const roadEdges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({
          color: 0xaeaeae,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      );
      roadEdges.renderOrder = DRAW_ORDER.ROAD;
      roadEdges.userData.layerRole = 'edge' satisfies LayerRole;
      roadEdges.userData.edgeColor = 0xaeaeae;
      this.layerGroup('roads').add(roadEdges);
    }

    if (scene.roadWalls.length) {
      // The skirt that closes the road ribbon into a solid (see skirtDepth in
      // lib/scene/stack, hung by finishRoads) — same tier and material as the
      // top surface above, but its own mesh so the crisp EdgesGeometry outline
      // above stays built from the top surface alone, not the skirt's
      // vertical and floor edges too.
      const pos: number[] = [];
      for (const f of scene.roadWalls)
        for (let k = 2; k < f.length; k++) pos.push(...f[0], ...f[k - 1], ...f[k]);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const wallMesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: ROAD_COLOR,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      );
      wallMesh.renderOrder = DRAW_ORDER.ROAD;
      wallMesh.userData.layerRole = 'fill' satisfies LayerRole;
      this.layerGroup('roads').add(wallMesh);
    }

    // Railways are the road pair again, one rung up the ladder: same ribbon
    // built by the same pushRoadway, same top/skirt split, drawn with the same
    // unlit material. Tier 5 rather than the roads' 4 because LAYER_DZ puts
    // railway above road, and draw order has to march with the stacking order
    // (see the SURFACE_TIER note below) so a level crossing resolves the way
    // the z ladder says it should rather than the way the sort happens to land.
    if (scene.railways.length) {
      const pos: number[] = [];
      for (const f of scene.railways)
        for (let k = 2; k < f.length; k++) pos.push(...f[0], ...f[k - 1], ...f[k]);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const railMesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: RAILWAY_COLOR,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      );
      railMesh.renderOrder = DRAW_ORDER.RAILWAY;
      railMesh.userData.layerRole = 'fill' satisfies LayerRole;
      this.layerGroup('railways').add(railMesh);
      // Built off the top surface alone, for the same reason the road outline
      // is — the skirt below has its own mesh so its vertical and floor edges
      // stay out of this pass.
      const railEdges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({
          color: 0x8d7f6e,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      );
      railEdges.renderOrder = DRAW_ORDER.RAILWAY;
      railEdges.userData.layerRole = 'edge' satisfies LayerRole;
      railEdges.userData.edgeColor = 0x8d7f6e;
      this.layerGroup('railways').add(railEdges);
    }

    if (scene.railwayWalls.length) {
      const pos: number[] = [];
      for (const f of scene.railwayWalls)
        for (let k = 2; k < f.length; k++) pos.push(...f[0], ...f[k - 1], ...f[k]);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const railWallMesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: RAILWAY_COLOR,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      );
      railWallMesh.renderOrder = DRAW_ORDER.RAILWAY;
      railWallMesh.userData.layerRole = 'fill' satisfies LayerRole;
      this.layerGroup('railways').add(railWallMesh);
    }

    for (const b of scene.buildings) this.addBuildingMesh(b);

    if (scene.terrain) {
      // Kept as a field as well as added to the group: it is what a drawn
      // footprint's corners are raycast against, so they land on the visible
      // ground rather than on a flat plane through it.
      this.groundMesh = new THREE.Mesh(
        facesetGeometry(scene.terrain.verts, scene.terrain.faces),
        new THREE.MeshLambertMaterial({
          color: TERRAIN_COLOR,
          flatShading: true,
          side: THREE.DoubleSide,
          // The ground loses every depth tie. Everything else in the scene is
          // draped on it within centimetres, so pushing it back once here is
          // worth more than offsetting each layer that sits on it.
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        }),
      );
      this.groundMesh.userData.layerRole = 'fill' satisfies LayerRole;
      this.layerGroup('terrain').add(this.groundMesh);
    } else {
      // A flat build has no terrain mesh, and since the reference grid went away
      // it would otherwise have nothing under it at all — buildings hanging in
      // front of the sky dome. A plain plane at the datum anchors them.
      //
      // Not assigned to groundMesh: pickGround already falls back to an infinite
      // math plane at datumZ when there is no mesh, and a finite one would only
      // make a drawn corner stop landing once the pointer left its edge. This is
      // scenery, nothing raycasts it.
      const span = Math.max(halfX, halfY) * 2.2;
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(span * 2, span * 2),
        new THREE.MeshLambertMaterial({
          color: TERRAIN_COLOR,
          side: THREE.DoubleSide,
          // Same reason as the terrain mesh above: the ground loses every depth
          // tie against the layers draped centimetres over it.
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        }),
      );
      floor.position.z = z0;
      // Deliberately NOT in the terrain layer group: emitIFC writes a terrain
      // element only when scene.terrain exists, so a tree node for this would
      // offer a recolour the exported file could not carry — and preview and
      // deliverable disagreeing is the one thing this codebase does not do.
      this.contentGroup.add(floor);
    }

    // Context layers are not pushed into buildingMeshes, so the raycaster keeps
    // selecting only buildings and the gizmo never latches onto scenery.
    //
    // Baked z alone doesn't reliably win depth ties at site scale, so every
    // tier also gets its own renderOrder + polygonOffset, increasing together
    // with the stacking order (see lib/scene/stack.ts): parcel < vegetation <
    // water < hedge, with roads and trees interleaved below by their own draw
    // calls further down. Draw order and offset march in lockstep so a higher
    // tier always wins both the paint order and the depth test against a lower
    // one, regardless of how close their true world z happens to be.
    const SURFACE_TIER: Record<string, number> = {
      parcel: DRAW_ORDER.PARCEL,
      vegetation: DRAW_ORDER.VEGETATION,
      water: DRAW_ORDER.WATER,
      hedge: DRAW_ORDER.HEDGE,
    };
    for (const s of scene.surfaces) {
      const tier = SURFACE_TIER[s.layer ?? ''] ?? DRAW_ORDER.PARCEL;
      // Opacity comes from the layer, which starts at the lib/scene/stack
      // default and is the same number the IFC exports as transparency. A layer
      // drawn below 1 must not write depth, or it hides what it is meant to be
      // a tint over. The paint pass at the end of this method sets all three
      // again from the model, so this only has to be a sane starting point.
      const alpha = layerAlpha(scene, s.layer ?? 'parcel');
      const mesh = new THREE.Mesh(
        facesetGeometry(s.verts, s.faces),
        new THREE.MeshLambertMaterial({
          color: s.color,
          side: THREE.DoubleSide,
          transparent: alpha < 1,
          opacity: alpha,
          depthWrite: alpha >= 1,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      );
      mesh.renderOrder = tier;
      // Tagged with the record, not just the role: a context surface keeps its
      // own colour (Surface.color), which is what a layer recolour stamps and
      // what the IFC already exports, so the repaint reads it back from here.
      mesh.userData.layerRole = 'fill' satisfies LayerRole;
      mesh.userData.surface = s;
      this.layerGroup(s.layer ?? 'parcel').add(mesh);
    }

    // One group per tree, same as buildings — individually pickable, editable
    // and undoable, at the cost of the single shared InstancedMesh draw call
    // this used to be. BUILDING_CAP already proves individual meshes hold up
    // at thousands of objects, and TREE_CAP is smaller still.
    for (const t of scene.trees) this.addTreeMesh(t);

    // Now that every group is complete, paint them all from the model. The
    // state a fresh build draws in and the state a later edit repaints to are
    // then produced by the same code, rather than by two that have to agree —
    // which is the drift a scene rebuilt after a layer edit would expose first.
    for (const id of this.layerGroups.keys()) this.paintLayer(id);

    this.layersChanged();
    this.frameCamera(site.radius, z0);

    // A rebuild under a running presentation would have frameCamera and the
    // orbit writing the camera in the same frame, and the orbit still flying to
    // the old site's radius. Re-seed it instead of stopping it: React holds the
    // toggle, so ending the mode here would leave a button claiming a state the
    // viewer had quietly left. It picks up from the camera frameCamera just
    // composed, with the new radius and datum, and carries on.
    if (this.present) {
      this.present = null;
      this.setPresentation(true);
    }
  }

  /* ---- element editing ---------------------------------------------- */

  /** The extruded prism for one building, at its current ring and height. Split
   *  out because a height edit rebuilds it in place. */
  private static buildingGeometry(b: Building): THREE.ExtrudeGeometry {
    // Ring is local to b.center, so the geometry sits on its own origin and the
    // gizmo pivots on the building. Z-scale grows it upward from its base.
    const shape = new THREE.Shape(b.ring.map((p) => new THREE.Vector2(p[0], p[1])));
    return new THREE.ExtrudeGeometry(shape, { depth: b.h, bevelEnabled: false });
  }

  /**
   * One building's mesh, added to the scene and to the pick list.
   *
   * Lifted out of setScene because it is no longer only a build-time path: a
   * drawn footprint and the undo of a delete both put a single building back
   * into a scene that is already on screen, and all three have to produce the
   * same object or an edit made before the undo would not survive it.
   */
  private addBuildingMesh(b: Building): THREE.Mesh {
    const geo = Viewer.buildingGeometry(b);
    const mesh = new THREE.Mesh(geo, [
      new THREE.MeshLambertMaterial({ flatShading: true }),
      new THREE.MeshLambertMaterial({ flatShading: true }),
    ]);
    mesh.userData.building = b;
    // The outline is a child rather than a sibling so it inherits every edit.
    mesh.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        // Colour is set by paintMesh — it doubles as the selection marker.
        new THREE.LineBasicMaterial(),
      ),
    );
    this.applyXf(mesh, b);
    this.paintMesh(mesh, b);
    this.layerGroup('buildings').add(mesh);
    this.buildingMeshes.push(mesh);
    return mesh;
  }

  private removeBuildingMesh(b: Building): void {
    const mesh = this.meshFor(b);
    if (!mesh) return;
    this.buildingMeshes.splice(this.buildingMeshes.indexOf(mesh), 1);
    mesh.removeFromParent();
    // disposeGroup traverses, so the outline child goes with it.
    Viewer.disposeGroup(mesh);
  }

  /** The outline child, which has to be rebuilt whenever the geometry is. */
  private static outlineOf(mesh: THREE.Mesh): THREE.LineSegments | undefined {
    return mesh.children.find((c) => c instanceof THREE.LineSegments) as
      | THREE.LineSegments
      | undefined;
  }

  /* ---- the ghost shell -------------------------------------------------
     A solid drawn below 1 is a two-pass affair: its far faces as one draw
     call, then its near ones. Both halves have to exist or a ghost does not
     read as a volume.

     One double-sided mesh will not do it. three sorts per OBJECT and never per
     triangle, so a single pass blends a prism's own faces in whatever order
     the index buffer happens to hold and the whole massing collapses to
     whichever face was last. And front-side alone — what this used to do —
     culls the far walls and floor cap outright, so the ghost is a single sheet
     with nothing behind it, which is not what the transparency is for. */

  private static shellOf(mesh: THREE.Mesh): THREE.Mesh | undefined {
    return mesh.children.find((c) => c.userData.shell === true) as THREE.Mesh | undefined;
  }

  /**
   * Bring the back-face twin of a solid in line with whether it is translucent,
   * and hand it back so the caller can paint it alongside the front faces.
   *
   * A child rather than a sibling, exactly like the outline, so it inherits
   * every transform and every layer visibility toggle for free. It shares the
   * parent's geometry rather than cloning it — the same buffer read with the
   * winding reversed, so a ghost costs a draw call and no memory. It is torn
   * down again the moment the solid goes back to opaque, so a scene that is
   * never ghosted pays nothing at all.
   */
  private static syncShell(mesh: THREE.Mesh, on: boolean): THREE.Mesh | null {
    const existing = Viewer.shellOf(mesh);
    if (!on) {
      if (existing) {
        existing.removeFromParent();
        // Its geometry is the parent's — only the materials are its own.
        const mats = existing.material;
        (Array.isArray(mats) ? mats : [mats]).forEach((m) => m.dispose());
      }
      return null;
    }
    if (existing) {
      // A height edit swaps the parent's buffer under it; keep them the same one.
      existing.geometry = mesh.geometry;
      return existing;
    }

    const front = mesh.material;
    const mats = (Array.isArray(front) ? front : [front]).map((m) => {
      const c = m.clone();
      c.side = THREE.BackSide;
      return c;
    });
    const shell = new THREE.Mesh(mesh.geometry, Array.isArray(front) ? mats : mats[0]);
    shell.userData.shell = true;
    shell.renderOrder = DRAW_ORDER.GHOST_BACK;
    // Buildings are picked non-recursively so a child is already unreachable,
    // but a tree is picked through its group — without this the shell would
    // swallow the click that was meant for the trunk it is wrapped around.
    shell.raycast = () => {};
    mesh.add(shell);
    return shell;
  }

  /** Swap in a prism for the building's current height, keeping the material,
   *  the transform and the selection exactly as they were. */
  private rebuildGeometry(mesh: THREE.Mesh, b: Building): void {
    const geo = Viewer.buildingGeometry(b);
    const shell = Viewer.shellOf(mesh);
    mesh.geometry.dispose();
    mesh.geometry = geo;
    // Shares the parent's buffer, so it has to follow it to the new one or the
    // ghost keeps wrapping the height the building no longer has.
    if (shell) shell.geometry = geo;
    const outline = Viewer.outlineOf(mesh);
    if (outline) {
      outline.geometry.dispose();
      outline.geometry = new THREE.EdgesGeometry(geo);
    }
  }

  /* ---- adding and removing buildings ---------------------------------
     Both directions of a 'life' command, and the forward direction of a draw
     or a delete. The scene array and the mesh list are kept in step here and
     nowhere else, so the index an undo restores to is always meaningful. */

  private insertBuilding(b: Building, index: number): void {
    const s = this.scene;
    if (!s) return;
    s.buildings.splice(Math.min(index, s.buildings.length), 0, b);
    const mesh = this.addBuildingMesh(b);
    this.cb.onCount(s.buildings.length);
    this.layersChanged();
    // Show what just came back — a building reappearing off-screen with nothing
    // selected is an undo the user cannot see. Unless a footprint tool is armed,
    // where the gizmo would land on the ground the next corner is aimed at.
    if (!this.drawTool) this.selectTarget({ kind: 'building', obj: mesh, b });
  }

  private detachBuilding(b: Building): void {
    const s = this.scene;
    if (!s) return;
    const i = s.buildings.indexOf(b);
    if (i >= 0) s.buildings.splice(i, 1);
    if (this.selected?.kind === 'building' && this.selected.b === b) this.selectTarget(null);
    this.removeBuildingMesh(b);
    this.cb.onCount(s.buildings.length);
    this.layersChanged();
  }

  // data -> mesh
  private applyXf(mesh: THREE.Mesh, b: Building): void {
    const xf = b.xf;
    mesh.position.set(
      b.center[0] + xf.pos[0],
      b.center[1] + xf.pos[1],
      (b.baseZ || 0) + xf.pos[2],
    );
    mesh.rotation.set(xf.rot[0], xf.rot[1], xf.rot[2], 'XYZ');
    mesh.scale.set(xf.scale[0], xf.scale[1], xf.scale[2]);
  }

  // mesh -> data, after a gizmo drag
  private readMeshInto(mesh: THREE.Mesh, xf: Xf): void {
    const b = mesh.userData.building as Building;
    xf.pos = [
      mesh.position.x - b.center[0],
      mesh.position.y - b.center[1],
      mesh.position.z - (b.baseZ || 0),
    ];
    xf.rot = [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z];
    xf.scale = [
      Math.max(mesh.scale.x, MIN_SCALE),
      Math.max(mesh.scale.y, MIN_SCALE),
      Math.max(mesh.scale.z, MIN_SCALE),
    ];
    // clamp back so the gizmo can't pull through zero
    mesh.scale.fromArray(xf.scale);
  }

  private paintMesh(mesh: THREE.Mesh, b: Building): void {
    const c = buildingColors(b);
    // Selection is carried mainly by the outline, not by the emissive. Emissive
    // is additive, and against a near-white massing there is no headroom left to
    // add into — a lit roof would clip before the tint became legible. A coloured
    // silhouette reads at any brightness, so the emissive is only a faint
    // supporting wash for the faces.
    const sel = this.selected?.kind === 'building' && this.selected.obj === mesh;

    // Transparency, on the same terms as the context surfaces above: a solid
    // drawn below 1 must not write depth, or it hides what it is meant to be
    // seen through — including its own far side, which is what makes a ghosted
    // massing readable. Translucent buildings draw last, above the trees in
    // lib/scene/stack, so they blend over a finished opaque scene.
    const a = b.xf.opacity;
    const shell = Viewer.syncShell(mesh, a < 1);

    // ExtrudeGeometry group 0 is the caps (roof + floor), group 1 the side
    // walls, and the shell mirrors both — it is the same materials with the
    // winding reversed, so it has to be painted from the same numbers or the
    // far side of a ghost drifts a shade off the near one.
    const mats = mesh.material as THREE.MeshLambertMaterial[];
    for (const g of shell ? [mats, shell.material as THREE.MeshLambertMaterial[]] : [mats]) {
      g[0].color.setHex(c.cap);
      g[1].color.setHex(c.wall);
      g[0].emissive.setHex(sel ? 0x16304a : 0x000000);
      g[1].emissive.setHex(sel ? 0x16304a : 0x000000);
      for (const m of g) setTranslucency(m, a);
    }
    mesh.renderOrder = a < 1 ? DRAW_ORDER.GHOST_FRONT : DRAW_ORDER.BUILDING;

    // The outline fades with the solid, or a ghost keeps hard black edges and
    // reads as a wireframe box rather than as a faint volume.
    const outline = Viewer.outlineOf(mesh);
    if (outline) {
      const om = outline.material as THREE.LineBasicMaterial;
      om.color.setHex(sel ? 0x1f8ac0 : 0xa8adb0);
      setTranslucency(om, a);
      outline.renderOrder = mesh.renderOrder;
    }
  }

  private meshFor(b: Building): THREE.Mesh | undefined {
    return this.buildingMeshes.find((m) => m.userData.building === b);
  }

  /* ---- tree editing ----------------------------------------------------
     A tree has no footprint to extrude, so unlike a building its two parts
     (trunk, canopy) are just scaled/repositioned children of a group rather
     than a geometry rebuilt from scratch — see rebuildTreeGeometry below. */

  /** Trunk + canopy at unit size, scaled and placed for one tree's own
   *  dimensions. Each tree gets its own geometry clone (cheap — a handful of
   *  triangles) so removing one tree's group can dispose its geometry without
   *  taking a shared buffer out from under every other tree. */
  private static treeGroup(t: Tree): THREE.Group {
    const trunk = new THREE.Mesh(
      treeTrunkGeometry(),
      new THREE.MeshLambertMaterial({ color: TREE_TRUNK_COLOR, flatShading: true }),
    );
    const canopy = new THREE.Mesh(
      treeCanopyGeometry(),
      new THREE.MeshLambertMaterial({ color: TREE_CANOPY_COLOR, flatShading: true }),
    );
    // Opaque, so normal depth-testing is enough on its own; the render order
    // just keeps them drawn last, top of the stack, matching lib/scene/stack.
    trunk.renderOrder = DRAW_ORDER.TREE;
    canopy.renderOrder = DRAW_ORDER.TREE;
    const group = new THREE.Group();
    group.add(trunk, canopy);
    Viewer.sizeTreeGroup(group, t);
    return group;
  }

  /** Rescale the trunk/canopy children for the tree's current h/cr/tr —
   *  everything a height edit changes. No geometry to dispose or rebuild: the
   *  unit shapes just get re-scaled and re-placed, unlike a building's prism. */
  private static sizeTreeGroup(group: THREE.Group, t: Tree): void {
    const [trunk, canopy] = group.children as THREE.Mesh[];
    const trunkH = treeTrunkHeight(t.h);
    const canopyH = Math.max(t.h - trunkH, 0.1);
    trunk.scale.set(t.tr, t.tr, trunkH);
    canopy.scale.set(t.cr, t.cr, canopyH / 2);
    canopy.position.set(0, 0, trunkH + canopyH / 2);
  }

  private rebuildTreeGeometry(group: THREE.Group, t: Tree): void {
    Viewer.sizeTreeGroup(group, t);
  }

  /** One tree's group, added to the scene and to the pick list. Parallels
   *  addBuildingMesh — see its comment for why this is its own method rather
   *  than only living inside setScene. */
  private addTreeMesh(t: Tree): THREE.Group {
    const group = Viewer.treeGroup(t);
    group.userData.tree = t;
    // Picking hits a child mesh (trunk or canopy); this is how it finds the
    // group that is the actual pickable entity.
    for (const child of group.children) child.userData.treeRoot = group;
    this.applyTreeXf(group, t);
    this.paintTreeMesh(group, t);
    this.layerGroup('trees').add(group);
    this.treeMeshes.push(group);
    return group;
  }

  private removeTreeMesh(t: Tree): void {
    const group = this.groupFor(t);
    if (!group) return;
    this.treeMeshes.splice(this.treeMeshes.indexOf(group), 1);
    group.removeFromParent();
    Viewer.disposeGroup(group);
  }

  private groupFor(t: Tree): THREE.Group | undefined {
    return this.treeMeshes.find((g) => g.userData.tree === t);
  }

  private insertTree(t: Tree, index: number): void {
    const s = this.scene;
    if (!s) return;
    s.trees.splice(Math.min(index, s.trees.length), 0, t);
    const group = this.addTreeMesh(t);
    this.layersChanged();
    if (!this.drawTool) this.selectTarget({ kind: 'tree', obj: group, t });
  }

  private detachTree(t: Tree): void {
    const s = this.scene;
    if (!s) return;
    const i = s.trees.indexOf(t);
    if (i >= 0) s.trees.splice(i, 1);
    if (this.selected?.kind === 'tree' && this.selected.t === t) this.selectTarget(null);
    this.removeTreeMesh(t);
    this.layersChanged();
  }

  // data -> mesh
  private applyTreeXf(group: THREE.Object3D, t: Tree): void {
    const xf = t.xf;
    group.position.set(t.x + xf.pos[0], t.y + xf.pos[1], t.z + xf.pos[2]);
    group.rotation.set(xf.rot[0], xf.rot[1], xf.rot[2], 'XYZ');
    group.scale.set(xf.scale[0], xf.scale[1], xf.scale[2]);
  }

  // mesh -> data, after a gizmo drag
  private readTreeMeshInto(group: THREE.Object3D, xf: Xf): void {
    const t = group.userData.tree as Tree;
    xf.pos = [group.position.x - t.x, group.position.y - t.y, group.position.z - t.z];
    xf.rot = [group.rotation.x, group.rotation.y, group.rotation.z];
    xf.scale = [
      Math.max(group.scale.x, MIN_SCALE),
      Math.max(group.scale.y, MIN_SCALE),
      Math.max(group.scale.z, MIN_SCALE),
    ];
    group.scale.fromArray(xf.scale);
  }

  private paintTreeMesh(group: THREE.Group, t: Tree): void {
    const [trunk, canopy] = group.children as THREE.Mesh[];
    // Selection reads as a faint emissive wash, the same supporting role it
    // plays on a building — see paintMesh.
    const sel = this.selected?.kind === 'tree' && this.selected.obj === group;
    const a = t.xf.opacity;
    const order = a < 1 ? DRAW_ORDER.GHOST_FRONT : DRAW_ORDER.TREE;

    // Trunk and canopy are closed volumes of their own, so each gets its own
    // back-face pass — same two-pass ghost as a building's prism, see syncShell.
    for (const part of [trunk, canopy]) {
      const color = part === canopy ? (t.xf.color ?? TREE_CANOPY_COLOR) : TREE_TRUNK_COLOR;
      const shell = Viewer.syncShell(part, a < 1);
      const mats = [part.material as THREE.MeshLambertMaterial];
      if (shell) mats.push(shell.material as THREE.MeshLambertMaterial);
      for (const m of mats) {
        m.color.setHex(color);
        m.emissive.setHex(sel ? 0x16304a : 0x000000);
        setTranslucency(m, a);
      }
      part.renderOrder = order;
    }
  }

  private treeTarget(group: THREE.Group | null | undefined): Target | null {
    return group ? { kind: 'tree', obj: group, t: group.userData.tree as Tree } : null;
  }

  private selectTarget(t: Target | null): void {
    const prev = this.selected;
    this.selected = t;
    if (prev?.kind === 'building' && prev.obj !== t?.obj && prev.obj.parent)
      this.paintMesh(prev.obj, prev.b);
    if (prev?.kind === 'tree' && prev.obj !== t?.obj && prev.obj.parent)
      this.paintTreeMesh(prev.obj, prev.t);
    if (prev?.kind === 'origin' && t?.kind !== 'origin') setMarkerActive(this.originMarker, false);

    if (t) {
      // Terrain has no offset to drag (see MOVABLE_LAYERS), and a layer with no
      // geometry has nothing to drag it by — the tree filters those out, but an
      // undo replaying an old command could still ask for one.
      const draggable =
        t.kind !== 'layer' || (MOVABLE_LAYERS.has(t.id) && t.obj.children.length > 0);
      if (draggable) this.gizmo.attach(t.obj);
      else this.gizmo.detach();
      if (t.kind === 'building') this.paintMesh(t.obj, t.b);
      else if (t.kind === 'tree') this.paintTreeMesh(t.obj, t.t);
      else if (t.kind === 'layer') {
        // Same reasoning as the origin below — a layer translates and nothing
        // else, so the other two modes are not the user's to pick here. Turning
        // is a separate promise about the source data being mis-georeferenced,
        // and scaling a draped ribbon would tear it off the terrain outright.
        if (draggable && this.gizmo.getMode() !== 'translate') {
          this.gizmo.setMode('translate');
          this.cb.onMode('translate');
        }
      } else {
        setMarkerActive(this.originMarker, true);
        // A point has nothing to turn or stretch, so the mode is not the user's
        // to pick while it is selected — say so rather than leaving dead buttons.
        if (this.gizmo.getMode() !== 'translate') {
          this.gizmo.setMode('translate');
          this.cb.onMode('translate');
        }
      }
    } else this.gizmo.detach();

    this.syncLayerBox();
    this.cb.onSelect(this.selectionOf(t));
    this.syncHistory();
  }

  private selectionOf(t: Target | null): Selection | null {
    if (!t) return null;
    if (t.kind === 'origin')
      return {
        kind: 'origin',
        id: ORIGIN_ID,
        name: ORIGIN_NAME,
        xf: originXf(this.originOffset),
        h: 0,
        defaultColor: 0,
      };
    if (t.kind === 'layer') {
      const l = this.layerState(t.id);
      return {
        kind: 'layer',
        id: layerSelId(t.id),
        name: LAYER_LABEL[t.id],
        xf: layerXf(t.id, l ?? { color: null, opacity: null, offset: [0, 0, 0] }),
        h: 0,
        defaultColor: defaultLayerColor(t.id),
      };
    }
    if (t.kind === 'tree')
      return {
        kind: 'tree',
        id: t.t.id,
        name: t.t.name,
        xf: cloneXf(t.t.xf),
        h: t.t.h,
        defaultColor: TREE_CANOPY_COLOR,
      };
    return {
      kind: 'building',
      id: t.b.id,
      name: t.b.name,
      xf: cloneXf(t.b.xf),
      h: t.b.h,
      defaultColor: defaultColors(t.b).wall,
    };
  }

  private buildingTarget(mesh: THREE.Mesh | null | undefined): Target | null {
    return mesh ? { kind: 'building', obj: mesh, b: mesh.userData.building as Building } : null;
  }

  /** Aim the shared raycaster at a pointer event. */
  private setRay(e: PointerEvent | MouseEvent): void {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.raycaster.setFromCamera(this.ndc, this.camera);
  }

  /**
   * Where a pointer meets the surface a footprint would be laid on, in world
   * metres, and whether that surface was a building.
   *
   * Buildings and the terrain are raycast separately and the nearer wins — the
   * same arbitration the selection pick below makes between buildings and
   * trees, and for the same reason: one combined list cannot express that the
   * outline child of a building mesh is deliberately unpickable. The list is
   * buildingMeshes, which holds fetched and hand-drawn buildings alike, so a
   * massing can be stacked on something drawn a moment ago.
   *
   * A building hit reports its roof rather than the point actually struck, so
   * clicking a *wall* resolves to the top of that wall. Accepting only up-facing
   * faces instead would drop the pick through to whatever terrain stands behind
   * the building, which reads as the cursor jumping to the horizon.
   *
   * Then the terrain mesh, so a corner placed on a hillside carries that
   * hillside's elevation; then the datum plane, which is the whole ground of a
   * flat scene. Null when the ray misses everything — pointing at the sky.
   */
  private pickSupport(e: PointerEvent | MouseEvent): { p: THREE.Vector3; roof: boolean } | null {
    this.setRay(e);
    const bHit = this.shown('buildings')
      ? this.raycaster.intersectObjects(this.buildingMeshes, false)[0]
      : undefined;
    const gHit =
      this.groundMesh && this.shown('terrain')
        ? this.raycaster.intersectObject(this.groundMesh, false)[0]
        : undefined;

    if (bHit && (!gHit || bHit.distance < gHit.distance)) {
      const b = (bHit.object as THREE.Mesh).userData.building as Building;
      return { p: new THREE.Vector3(bHit.point.x, bHit.point.y, roofZ(b)), roof: true };
    }
    if (gHit) return { p: gHit.point.clone(), roof: false };

    this.groundPlane.constant = -(this.scene?.datumZ ?? 0);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, p) ? { p, roof: false } : null;
  }

  /**
   * Where a pointer meets the model, for measuring — the point actually struck,
   * pulled onto the nearest feature of the triangle it struck.
   *
   * Cast against the layer groups rather than against buildingMeshes, which is
   * what picks up the terrain, the roads, the railways and the water in one go
   * and puts every layer's own offset into the answer through matrixWorld. The
   * shown() guard is the same one the selection pick uses, and for the same
   * reason: three ignores .visible when raycasting, so a hidden layer would go
   * on catching clicks meant for what is now behind it.
   *
   * Trees are left out. A canopy is a decorative blob whose vertices mean
   * nothing, and it is the one recursive cast in the scene expensive enough to
   * be worth not doing sixty times a second.
   *
   * The result is filtered to meshes carrying a face, which drops the
   * LineSegments outline that hangs off every building — the selection pick
   * avoids it by being non-recursive, and this one cannot be.
   */
  private pickMeasure(e: PointerEvent | MouseEvent): Snap | null {
    this.setRay(e);
    const groups: THREE.Object3D[] = [];
    for (const [id, g] of this.layerGroups) if (id !== 'trees' && this.shown(id)) groups.push(g);

    const hit = this.raycaster
      .intersectObjects(groups, true)
      .find((h) => h.face && h.object instanceof THREE.Mesh);

    if (hit) {
      // The terrain is a regular grid, so its vertices are the sampling, not
      // features of anything. Snapping to them would fight the pointer on every
      // slope for a corner that is not there.
      if (hit.object === this.groundMesh) return { p: hit.point.clone(), kind: 'free' };
      const r = this.renderer.domElement.getBoundingClientRect();
      return resolveSnap(hit, this.camera, r, { x: e.clientX - r.left, y: e.clientY - r.top });
    }

    // Nothing under the pointer but sky: fall back to the datum, the same way a
    // drawn corner does, so a distance can still be taken across bare ground.
    this.groundPlane.constant = -(this.scene?.datumZ ?? 0);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, p) ? { p, kind: 'free' } : null;
  }

  /**
   * Where a pointer meets the ground for every corner after the one that opened
   * the gesture.
   *
   * Buildings are deliberately not hit-tested here — only the opening corner
   * consults them, through pickSupport. A rectangle dragged from the terrain
   * across a roof would otherwise have its live corner climb onto that roof and
   * back off again, and the shape on screen would jump with it.
   *
   * So: the roof plane when the gesture was opened on one, which keeps the
   * footprint flat and lets it run past the edge; the terrain otherwise, so a
   * corner on a hillside still carries that hillside's elevation; the datum
   * plane when the scene has no terrain. Null when the ray misses — sky.
   */
  private pickGround(e: PointerEvent | MouseEvent): THREE.Vector3 | null {
    this.setRay(e);
    if (this.drawPlaneZ === null && this.groundMesh && this.shown('terrain')) {
      const hit = this.raycaster.intersectObject(this.groundMesh, false)[0];
      if (hit) return hit.point.clone();
    }
    this.groundPlane.constant = -(this.drawPlaneZ ?? this.scene?.datumZ ?? 0);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, p) ? p : null;
  }

  private initPicking(): void {
    const dom = this.renderer.domElement;
    let downX = 0;
    let downY = 0;
    let onGizmo = false;

    // The presentation orbit hides the chrome the element editor lives in, so a
    // selection made under one would open a panel nobody can see and leave an
    // outline round a building for no stated reason. Both ends of the gesture
    // are guarded rather than just the release, so a press cannot arm anything
    // that outlives the mode.
    dom.addEventListener('pointerdown', (e) => {
      if (this.present) return;
      downX = e.clientX;
      downY = e.clientY;
      onGizmo = !!this.gizmo.axis; // the gizmo sets .axis while hovered

      // A rectangle is one drag, so it takes the camera off the left button for
      // the duration — the same arbitration the gizmo makes in dragging-changed.
      if (this.drawTool === 'rect' && e.button === 0) {
        // The anchor is the corner that decides the surface: pickSupport rather
        // than pickGround, and the work plane it locks holds for the whole drag.
        const s = this.pickSupport(e);
        if (!s) return;
        this.rectAnchor = s.p;
        this.drawPlaneZ = s.roof ? s.p.z : null;
        this.controls.enabled = false;
      }
    });

    dom.addEventListener('pointermove', (e) => {
      // Measuring is the exception to the note below: its snap has to answer
      // while the pointer is only hovering, before any point is placed. So it
      // parks the event and updateMeasure resolves it once on the next frame,
      // which is the same guard by another route — one cast per frame rather
      // than one per event.
      if (measureKindOf(this.drawTool)) {
        this.hoverEvent = e;
        return;
      }

      // Nothing to rubber-band from until a gesture is under way. Checked before
      // the pick, because that pick raycasts the terrain mesh and this fires on
      // every move the pointer makes while a tool is armed. (On a roof it is
      // only a plane intersection, so the guard matters least there.)
      const live = this.drawTool === 'rect' ? !!this.rectAnchor : this.drawPts.length > 0;
      if (!this.drawTool || !live) return;
      const p = this.pickGround(e);
      if (!p) return;
      if (this.drawTool === 'rect')
        this.showDraft(Viewer.rectCorners(this.rectAnchor!, p), true);
      // The cursor is the provisional next corner: draw through it so the leg
      // being aimed is visible before it is committed.
      else this.showDraft([...this.drawPts, p], this.drawPts.length >= 2);
    });

    dom.addEventListener('pointerup', (e) => {
      if (this.present) return;
      if (this.drawTool === 'rect') {
        const anchor = this.rectAnchor;
        this.rectAnchor = null;
        this.controls.enabled = true;
        if (!anchor || e.button !== 0) return this.clearDrawPlane();
        const p = this.pickGround(e);
        // A click rather than a drag: no rectangle was described, so this is a
        // miss, not an empty building.
        if (p && Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_PX)
          this.commitFootprint(Viewer.rectCorners(anchor, p));
        else {
          this.showDraft([], false);
          this.clearDrawPlane();
        }
        return;
      }

      if (onGizmo || this.gizmo.dragging) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_PX) return; // that was an orbit

      if (this.drawTool === 'polygon') {
        if (e.button !== 0) return this.cancelDraw();
        // Same rule as the rectangle's anchor: the opening click chooses the
        // surface, the rest of the ring is drawn on it.
        const first = this.drawPts.length === 0;
        const s = first ? this.pickSupport(e) : null;
        const p = first ? (s?.p ?? null) : this.pickGround(e);
        if (!p) return;
        if (s) this.drawPlaneZ = s.roof ? s.p.z : null;
        // Clicking the first corner closes the ring, which is the gesture every
        // map editor uses. Tested in screen space, so the target stays the same
        // size to aim at however far the camera is pulled back.
        if (this.drawPts.length >= 3 && this.screenDist(this.drawPts[0], e) < 12)
          return this.finishDraw();
        this.drawPts.push(p);
        this.showDraft(this.drawPts, this.drawPts.length >= 3);
        this.cb.onDraw(this.drawTool, this.drawPts.length);
        return;
      }

      const kind = measureKindOf(this.drawTool);
      if (kind) {
        if (e.button !== 0) return this.cancelDraw();
        const s = this.pickMeasure(e);
        if (!s) return;

        // A ring closes on its own first corner, the same twelve-pixel target
        // the polygon tool uses — the gesture every map editor has.
        if (
          kind === 'area' &&
          this.measurePts.length >= 3 &&
          this.screenDist(this.measurePts[0], e) < 12
        )
          return this.finishDraw();

        this.measurePts.push(s.p);
        // A distance is two points and no more. Committing re-arms with the
        // point just placed, so a route can be walked leg by leg without
        // clicking the same corner twice; Esc breaks the chain.
        if (kind === 'dist' && this.measurePts.length === 2) {
          this.commitMeasure('dist', this.measurePts);
          this.measurePts = [s.p];
        }
        this.measure.setLive(kind, this.measurePts, s.kind);
        this.cb.onDraw(this.drawTool, this.measurePts.length);
        return;
      }

      if (this.drawTool === 'tree') {
        if (e.button !== 0) return this.cancelDraw();
        // One click is the whole gesture, so there is no plane to lock: the
        // support pick is the answer, roof included — a tree can stand on a
        // terrace as well as on the ground.
        const p = this.pickSupport(e)?.p;
        if (p) this.commitTreePlacement(p);
        return;
      }

      this.setRay(e);
      // The marker draws over everything, so it picks over everything too —
      // otherwise it would be unreachable wherever it sits inside a building.
      if (this.originMarker.visible && this.raycaster.intersectObject(this.originPick).length)
        return this.selectTarget({ kind: 'origin', obj: this.originMarker });
      // Two separate raycasts, not one combined list: buildingMeshes are picked
      // non-recursively (their outline child is deliberately unpickable), while
      // a tree is a Group whose trunk/canopy children are the actual geometry,
      // so it needs a recursive one. Comparing distances keeps the nearer
      // object winning regardless of which kind it is.
      // A hidden layer is not pickable: three does not consult .visible when
      // raycasting (see the module note on setLayerVisible), so a hidden
      // building or tree would otherwise still catch a click meant for
      // whatever is now visible behind it.
      const bHit = this.shown('buildings')
        ? this.raycaster.intersectObjects(this.buildingMeshes, false)[0]
        : undefined;
      const tHit = this.shown('trees')
        ? this.raycaster.intersectObjects(this.treeMeshes, true)[0]
        : undefined;
      if (tHit && (!bHit || tHit.distance < bHit.distance))
        this.selectTarget(this.treeTarget(tHit.object.userData.treeRoot as THREE.Group));
      else this.selectTarget(this.buildingTarget(bHit?.object as THREE.Mesh | undefined));
    });

    // Closing on a double-click means the second click has already been taken
    // as a corner, so it is dropped before the ring is committed.
    dom.addEventListener('dblclick', () => {
      if (this.drawTool === 'measureArea' && this.measurePts.length >= 4) {
        this.measurePts.pop();
        return this.finishDraw();
      }
      if (this.drawTool !== 'polygon' || this.drawPts.length < 4) return;
      this.drawPts.pop();
      this.finishDraw();
    });

    // Right-drag pans, so a right-click only cancels when nothing was dragged.
    dom.addEventListener('contextmenu', (e) => {
      if (!this.drawTool) return;
      e.preventDefault();
      if (Math.hypot(e.clientX - downX, e.clientY - downY) <= CLICK_PX) this.cancelDraw();
    });
  }

  /** Screen-space distance from a world point to a pointer, in CSS pixels. */
  private screenDist(world: THREE.Vector3, e: PointerEvent | MouseEvent): number {
    const r = this.renderer.domElement.getBoundingClientRect();
    // Shared with the measure snap, which compares nine candidates per hover
    // against the same tolerance — two copies of this projection would drift.
    const p = toScreen(world, this.camera, r);
    return Math.hypot(p.x + r.left - e.clientX, p.y + r.top - e.clientY);
  }

  /** The four corners of an axis-aligned rectangle through two opposite ones,
   *  wound counter-clockwise and held at the lower of the two elevations. */
  private static rectCorners(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3[] {
    const z = Math.min(a.z, b.z);
    return [
      new THREE.Vector3(a.x, a.y, z),
      new THREE.Vector3(b.x, a.y, z),
      new THREE.Vector3(b.x, b.y, z),
      new THREE.Vector3(a.x, b.y, z),
    ];
  }

  /** Release the roof work plane. Called wherever rectAnchor or drawPts are
   *  cleared, never on its own: a plane that outlives its gesture pins the next
   *  one to a roof the user has already left. */
  private clearDrawPlane(): void {
    this.drawPlaneZ = null;
  }

  /** Draw the in-progress footprint, lifted clear of the ground so it is not
   *  swallowed by the surface it is being drawn on. */
  private showDraft(pts: THREE.Vector3[], closed: boolean): void {
    this.draft.setPoints(
      pts.map((p) => new THREE.Vector3(p.x, p.y, p.z + 0.4)),
      closed,
    );
  }

  /** False when the mode was refused, so the UI does not show one that is not
   *  in effect — the origin and any layer are translate-only; see selectTarget. */
  setMode(mode: GizmoMode): boolean {
    const k = this.selected?.kind;
    if (k === 'origin' || k === 'layer') return false;
    this.gizmo.setMode(mode);
    return true;
  }

  select(id: string | null): void {
    if (id === null) return this.selectTarget(null);
    const layer = layerIdOf(id);
    if (layer) return this.selectLayer(layer);
    if (id === ORIGIN_ID)
      return this.selectTarget(
        this.originMarker.visible ? { kind: 'origin', obj: this.originMarker } : null,
      );
    const mesh = this.shown('buildings')
      ? this.buildingMeshes.find((m) => (m.userData.building as Building).id === id)
      : undefined;
    if (mesh) return this.selectTarget(this.buildingTarget(mesh));
    const group = this.shown('trees')
      ? this.treeMeshes.find((g) => (g.userData.tree as Tree).id === id)
      : undefined;
    this.selectTarget(this.treeTarget(group));
  }

  /* ---- the model origin ----------------------------------------------
     The marker's position is the point the export writes as model zero. It is
     a view-side choice the writer reads, not something the build produced, so
     it rides on the viewer and reaches the file through SiteMeta.exportOffset.
     ------------------------------------------------------------------- */

  private setOrigin(v: Vec3, dirty = true): void {
    this.originOffset.fromArray(v);
    this.originMarker.position.copy(this.originOffset);
    this.cb.onOrigin(this.originOffset.toArray() as Vec3);
    if (this.selected?.kind === 'origin') this.cb.onTransform(originXf(this.originOffset), 0);
    if (dirty) this.cb.onDirty();
  }

  /**
   * Put the export origin back where a restored draft had it.
   *
   * Not undoable and not dirtying, which is what separates it from resetOrigin
   * below: this is the state the file was saved in rather than an edit made to
   * it, and setScene has just cleared the history it would otherwise join. The
   * onOrigin callback still fires, which is how the readout catches up.
   */
  restoreOrigin(off: Vec3): void {
    this.setOrigin(off, false);
  }

  /** Put the model origin back at the site centre, resting on the ground, as
   *  one undoable step. */
  resetOrigin(): void {
    const z0 = this.scene?.datumZ ?? 0;
    if (this.originOffset.x === 0 && this.originOffset.y === 0 && this.originOffset.z === z0)
      return;
    this.beginEdit();
    this.setOrigin([0, 0, z0]);
    this.commitEdit('edit.originReset');
  }

  /** Hide the marker. A hidden datum cannot stay selected with a gizmo on it. */
  setMarkerVisible(on: boolean): void {
    this.originMarker.visible = on;
    if (!on && this.selected?.kind === 'origin') this.selectTarget(null);
  }

  /* ---- undo / redo ---------------------------------------------------
     Each command is a before/after snapshot of one xf record. The data is
     small and plain, so inverse-command machinery buys nothing; what matters
     is that one gesture produces exactly one command.
     ------------------------------------------------------------------- */

  /** See ViewerCallbacks.onLayers. Called from the handful of places that
   *  change what the tree lists, rather than from onDirty, which also fires
   *  through every frame of a drag. */
  private layersChanged(): void {
    this.cb.onLayers();
  }

  private clearHistory(): void {
    this.edits.stack.length = 0;
    this.edits.index = -1;
    this.pending = null;
    this.syncHistory();
  }

  private syncHistory(): void {
    this.cb.onHistory(this.edits.index >= 0, this.edits.index < this.edits.stack.length - 1);
  }

  beginEdit(): void {
    const t = this.selected;
    if (this.pending || !t) return;
    if (t.kind === 'layer') {
      const l = this.layerState(t.id);
      if (!l) return;
      // The per-record colours are snapshotted here rather than at the moment a
      // stamp writes them, because a colour drag arrives as a stream of live
      // previews and only the first of them still sees the originals. One pass
      // over the layer per gesture, not per keystroke — the guard above is what
      // makes that true.
      this.pending = {
        kind: 'layer',
        id: t.id,
        before: cloneLayerXf(l),
        styles: styledOf(this.scene!, t.id).map((rec) => ({ rec, before: readStyle(rec) })),
      };
      return;
    }
    this.pending =
      t.kind === 'origin'
        ? { kind: 'origin', before: this.originOffset.toArray() as Vec3 }
        : t.kind === 'building'
          ? { kind: 'building', b: t.b, before: cloneXf(t.b.xf), beforeH: t.b.h }
          : { kind: 'tree', t: t.t, before: cloneXf(t.t.xf), beforeH: t.t.h };
  }

  /**
   * Land a finished command on the stack.
   *
   * Split from commitEdit because not every gesture has a before/after pair to
   * pend: drawing and deleting produce their command outright, and the
   * bookkeeping around it — truncating the redo branch, the limit, the status
   * line — is the same either way.
   */
  private pushCmd(cmd: Cmd, name: string): void {
    this.edits.stack.length = this.edits.index + 1; // a new edit truncates the redo branch
    this.edits.stack.push(cmd);
    if (this.edits.stack.length > this.edits.limit) this.edits.stack.shift();
    this.edits.index = this.edits.stack.length - 1;
    this.syncHistory();
    this.layersChanged();
    this.cb.onDirty();
    this.cb.onStatus('status.editCommitted', { label: cmd.label, name });
  }

  commitEdit(label: EditLabelKey): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;

    if (p.kind === 'origin') {
      const after = this.originOffset.toArray() as Vec3;
      if (p.before.every((v, i) => v === after[i])) return;
      this.pushCmd({ label, kind: 'origin', before: p.before, after }, ORIGIN_NAME);
      return;
    }

    if (p.kind === 'layer') {
      const l = this.layerState(p.id);
      if (!l) return;
      const after = cloneLayerXf(l);
      const styles = p.styles
        .map((x) => ({ rec: x.rec, before: x.before, after: readStyle(x.rec) }))
        .filter((x) => !sameStyle(x.before, x.after));
      if (sameLayerXf(p.before, after) && !styles.length) return;
      this.pushCmd(
        { label, kind: 'layer', id: p.id, before: p.before, after, styles },
        LAYER_LABEL[p.id],
      );
      return;
    }

    if (p.kind === 'tree') {
      const after = cloneXf(p.t.xf);
      if (sameXf(p.before, after) && p.beforeH === p.t.h) return;
      this.pushCmd(
        { label, kind: 'tree', t: p.t, before: p.before, after, beforeH: p.beforeH, afterH: p.t.h },
        p.t.name,
      );
      return;
    }

    const after = cloneXf(p.b.xf);
    if (sameXf(p.before, after) && p.beforeH === p.b.h) return;
    this.pushCmd(
      {
        label,
        kind: 'building',
        b: p.b,
        before: p.before,
        after,
        beforeH: p.beforeH,
        afterH: p.b.h,
      },
      p.b.name,
    );
  }

  private applyXfCmd(b: Building, xf: Xf, h: number): void {
    b.xf = cloneXf(xf);
    const heightChanged = b.h !== h;
    b.h = h;
    // A building whose 'life' command has already been shifted off the bottom of
    // the stack is no longer in the scene; writing its record is harmless and
    // there is simply no mesh to follow.
    const mesh = this.meshFor(b);
    if (mesh) {
      // show what just changed
      if (this.selected?.kind !== 'building' || this.selected.obj !== mesh)
        this.selectTarget(this.buildingTarget(mesh));
      if (heightChanged) this.rebuildGeometry(mesh, b);
      this.applyXf(mesh, b);
      this.paintMesh(mesh, b);
    }
    this.cb.onTransform(cloneXf(b.xf), b.h);
    this.cb.onDirty();
  }

  private applyXfCmdTree(t: Tree, xf: Xf, h: number): void {
    t.xf = cloneXf(xf);
    const heightChanged = t.h !== h;
    t.h = h;
    const group = this.groupFor(t);
    if (group) {
      if (this.selected?.kind !== 'tree' || this.selected.obj !== group)
        this.selectTarget(this.treeTarget(group));
      if (heightChanged) this.rebuildTreeGeometry(group, t);
      this.applyTreeXf(group, t);
      this.paintTreeMesh(group, t);
    }
    this.cb.onTransform(cloneXf(t.xf), t.h);
    this.cb.onDirty();
  }

  /** Replay one command in either direction; `to` is its before or its after. */
  private applyCmd(c: Cmd, to: 'before' | 'after'): void {
    if (c.kind === 'origin') {
      // Show what just changed, as the building path does — an origin that jumps
      // with nothing selected is an undo the user cannot see.
      if (this.originMarker.visible && this.selected?.kind !== 'origin')
        this.selectTarget({ kind: 'origin', obj: this.originMarker });
      this.setOrigin(c[to]);
    } else if (c.kind === 'life') {
      // An add is present at its 'after' and absent at its 'before'; a delete is
      // the other way round.
      const present = to === 'after' ? c.added : !c.added;
      if (present) this.insertBuilding(c.b, c.index);
      else this.detachBuilding(c.b);
      this.cb.onDirty();
    } else if (c.kind === 'treeLife') {
      const present = to === 'after' ? c.added : !c.added;
      if (present) this.insertTree(c.t, c.index);
      else this.detachTree(c.t);
      this.cb.onDirty();
    } else if (c.kind === 'layer') {
      this.applyLayerCmd(c, to);
    } else if (c.kind === 'tree') {
      this.applyXfCmdTree(c.t, c[to], to === 'after' ? c.afterH : c.beforeH);
    } else this.applyXfCmd(c.b, c[to], to === 'after' ? c.afterH : c.beforeH);
  }

  private applyLayerCmd(c: Cmd & { kind: 'layer' }, to: 'before' | 'after'): void {
    const s = this.scene;
    if (!s) return;
    s.layers[c.id] = cloneLayerXf(c[to]);
    this.layerGroups.get(c.id)?.position.fromArray(s.layers[c.id].offset);
    for (const st of c.styles) writeStyle(st.rec, st[to]);
    // Show what just changed, the same courtesy the building and origin paths
    // extend — a layer repainting off-screen with nothing selected is an undo
    // the user cannot see.
    if (this.selected?.kind !== 'layer' || this.selected.id !== c.id) this.selectLayer(c.id);
    this.paintLayer(c.id);
    this.syncLayerBox();
    this.cb.onTransform(layerXf(c.id, s.layers[c.id]), 0);
    this.cb.onDirty();
  }

  private cmdName(c: Cmd): string {
    if (c.kind === 'origin') return ORIGIN_NAME;
    if (c.kind === 'layer') return LAYER_LABEL[c.id];
    return c.kind === 'tree' || c.kind === 'treeLife' ? c.t.name : c.b.name;
  }

  undo(): void {
    if (this.edits.index < 0) return;
    const c = this.edits.stack[this.edits.index--];
    this.applyCmd(c, 'before');
    // After the replay, not before it: the tree is derived from the scene, and
    // re-deriving it from the state the undo is about to leave behind would
    // hand the panel the very values it just took back.
    this.layersChanged();
    this.syncHistory();
    this.cb.onStatus('status.undone', { label: c.label, name: this.cmdName(c) });
  }

  redo(): void {
    if (this.edits.index >= this.edits.stack.length - 1) return;
    const c = this.edits.stack[++this.edits.index];
    this.applyCmd(c, 'after');
    this.layersChanged();
    this.syncHistory();
    this.cb.onStatus('status.redone', { label: c.label, name: this.cmdName(c) });
  }

  /* ---- editor panel writes ------------------------------------------
     Building and tree selections are edited through the same handful of
     methods below — both are just "an id with an xf and a height", so
     `editable()` gives each method one body instead of a building/tree branch
     apiece. The origin is different in kind (no xf, no height) and keeps its
     own explicit handling where it applies at all. ------------------------- */

  /** A uniform view onto whatever is selected that has an xf and a height —
   *  building or tree. Null for no selection and for the origin, which has
   *  neither, so every method below reduces to a no-op for it automatically. */
  private editable(): {
    xf: Xf;
    getH: () => number;
    setH: (h: number) => void;
    apply: () => void;
    paint: () => void;
    rebuild: () => void;
  } | null {
    const t = this.selected;
    if (!t) return null;
    if (t.kind === 'building')
      return {
        xf: t.b.xf,
        getH: () => t.b.h,
        setH: (h) => {
          t.b.h = h;
        },
        apply: () => this.applyXf(t.obj, t.b),
        paint: () => this.paintMesh(t.obj, t.b),
        rebuild: () => this.rebuildGeometry(t.obj, t.b),
      };
    if (t.kind === 'tree')
      return {
        xf: t.t.xf,
        getH: () => t.t.h,
        setH: (h) => {
          t.t.h = h;
        },
        apply: () => this.applyTreeXf(t.obj, t.t),
        paint: () => this.paintTreeMesh(t.obj, t.t),
        rebuild: () => this.rebuildTreeGeometry(t.obj, t.t),
      };
    return null;
  }

  /**
   * `commit` is false while the user is still typing (live preview) and true on
   * change/blur, which is the undo boundary. This is the split the original made
   * between the oninput and onchange handlers.
   */
  setAxis(key: 'pos' | 'rot' | 'scale', i: number, raw: number, uniform: boolean, commit: boolean): void {
    const t = this.selected;
    if (!t || !Number.isFinite(raw)) return;

    // The origin is a point: only its position is writable, and the editor only
    // offers that row. Anything else arriving here is a no-op rather than an error.
    if (t.kind === 'origin') {
      if (key !== 'pos') return;
      this.beginEdit();
      const v = this.originOffset.toArray() as Vec3;
      v[i] = raw;
      this.setOrigin(v);
      if (commit) this.commitEdit('edit.origin');
      return;
    }

    // A layer translates and nothing else, for the reasons in selectTarget.
    if (t.kind === 'layer') {
      const l = this.layerState(t.id);
      if (key !== 'pos' || !l || !MOVABLE_LAYERS.has(t.id)) return;
      this.beginEdit();
      l.offset[i] = raw;
      t.obj.position.fromArray(l.offset);
      this.syncLayerBox();
      this.cb.onTransform(layerXf(t.id, l), 0);
      this.cb.onDirty();
      if (commit) this.commitEdit('edit.move');
      return;
    }

    const e = this.editable();
    if (!e) return;
    this.beginEdit();

    if (key === 'scale') {
      const v = Math.max(MIN_SCALE, raw); // no mirroring: it would flip ring winding
      if (uniform) e.xf.scale = [v, v, v];
      else e.xf.scale[i] = v;
    } else if (key === 'rot') e.xf.rot[i] = (raw * Math.PI) / 180;
    else e.xf.pos[i] = raw;

    e.apply();
    this.cb.onTransform(cloneXf(e.xf), e.getH());
    this.cb.onDirty();
    if (commit) this.commitEdit(key === 'pos' ? 'edit.move' : key === 'rot' ? 'edit.rotate' : 'edit.scale');
  }

  /**
   * Restyle a layer, by writing the values through to every element in it.
   *
   * Stamping rather than shadowing: buildings, trees and context surfaces
   * already have somewhere to keep what they can keep, and the IFC writer
   * already reads it back out of exactly those fields, so a stamp is what makes
   * the export need no per-layer fallback of its own. What a record cannot hold
   * — a Surface's opacity, and both values on the merged layers — stays on
   * LayerXf, which emitIFC reads instead.
   *
   * The patch is applied to LayerXf first and the record style is then derived
   * from it wholesale, so a reset to null lands as "back to whatever the tier
   * says" rather than as a null written into an Xf that has no room for one.
   */
  private stampLayer(
    id: LayerId,
    patch: Partial<Pick<LayerXf, 'color' | 'opacity'>>,
    commit: boolean,
    label: EditLabelKey,
  ): void {
    const s = this.scene;
    const l = this.layerState(id);
    if (!s || !l) return;
    this.beginEdit();
    Object.assign(l, patch);
    const style: Style = { color: l.color, opacity: layerAlpha(s, id) };
    for (const rec of styledOf(s, id)) writeStyle(rec, style);
    this.paintLayer(id);
    this.cb.onTransform(layerXf(id, l), 0);
    this.cb.onDirty();
    if (commit) this.commitEdit(label);
  }

  setColor(hex: number, commit: boolean): void {
    const t = this.selected;
    if (t?.kind === 'layer') return this.stampLayer(t.id, { color: hex }, commit, 'edit.colour');
    const e = this.editable();
    if (!e) return;
    this.beginEdit();
    e.xf.color = hex;
    e.paint();
    this.cb.onTransform(cloneXf(e.xf), e.getH());
    this.cb.onDirty();
    if (commit) this.commitEdit('edit.colour');
  }

  resetColor(): void {
    const t = this.selected;
    if (t?.kind === 'layer')
      return this.stampLayer(t.id, { color: null }, true, 'edit.colourReset');
    const e = this.editable();
    if (!e) return;
    this.beginEdit();
    e.xf.color = null;
    e.paint();
    this.cb.onTransform(cloneXf(e.xf), e.getH());
    this.commitEdit('edit.colourReset');
    this.cb.onDirty();
  }

  /** `a` is opacity, 0..1. Same live/commit split as the colour swatch: the
   *  slider previews continuously and the undo boundary is the drag ending. */
  setOpacity(a: number, commit: boolean): void {
    if (!Number.isFinite(a)) return;
    const t = this.selected;
    if (t?.kind === 'layer')
      return this.stampLayer(
        t.id,
        { opacity: Math.min(1, Math.max(0, a)) },
        commit,
        'edit.opacity',
      );
    const e = this.editable();
    if (!e) return;
    this.beginEdit();
    e.xf.opacity = Math.min(1, Math.max(0, a));
    e.paint();
    this.cb.onTransform(cloneXf(e.xf), e.getH());
    this.cb.onDirty();
    if (commit) this.commitEdit('edit.opacity');
  }

  /**
   * Set the extrusion height in metres — a building's own dimension, not
   * something layered on the transform, so this rebuilds/rescales the shape
   * instead of writing a matrix. Rides the same begin/commit pair as
   * everything else on the panel: a typed height and a gizmo drag in one
   * gesture must still be one undo step.
   */
  setHeight(h: number, commit: boolean): void {
    const e = this.editable();
    if (!e || !Number.isFinite(h)) return;
    this.beginEdit();
    e.setH(Math.max(MIN_HEIGHT, h));
    e.rebuild();
    this.cb.onTransform(cloneXf(e.xf), e.getH());
    this.cb.onDirty();
    if (commit) this.commitEdit('edit.height');
  }

  /** Remove the selected building or tree from the scene. Undoable: the
   *  record itself rides on the command, so an undo restores it exactly
   *  where it was. */
  deleteSelected(): void {
    const t = this.selected;
    const s = this.scene;
    if (!t || !s) return;
    if (t.kind === 'building') {
      const index = s.buildings.indexOf(t.b);
      if (index < 0) return;
      this.detachBuilding(t.b);
      this.pushCmd({ label: 'edit.delete', kind: 'life', b: t.b, index, added: false }, t.b.name);
    } else if (t.kind === 'tree') {
      const index = s.trees.indexOf(t.t);
      if (index < 0) return;
      this.detachTree(t.t);
      this.pushCmd(
        { label: 'edit.delete', kind: 'treeLife', t: t.t, index, added: false },
        t.t.name,
      );
    }
  }

  /* ---- drawing a footprint --------------------------------------------
     A tool takes over the left button: clicks stop selecting and start placing
     corners on the ground. The gizmo comes off first, or it would keep
     swallowing the clicks meant for the ground beneath it.
     ------------------------------------------------------------------- */

  /**
   * Swap the backdrop the model is seen against.
   *
   * Three things move: the dome's uniforms, the clear colour behind it, and the
   * lighting ratio. The scene's own colours deliberately do not — TERRAIN_COLOR
   * and the rest of lib/scene/stack are the *export* palette, read by lib/ifc's
   * writer as well as by this viewer, and re-tinting them here would make the
   * downloaded file's colours depend on which theme happened to be on screen.
   *
   * The edge lines are left alone for a plainer reason: they are drawn over
   * those same near-white surfaces in both themes, so a dark edge is still the
   * readable one. Lightening them for the dark theme would erase them.
   */
  setTheme(theme: ViewerTheme): void {
    if (theme === this.theme) return;
    this.theme = theme;

    const sky = SKY_THEMES[theme];
    applySky(this.skyDome, sky);
    (this.sceneGL.background as THREE.Color).setHex(sky.horizon);

    const l = LIGHTS[theme];
    this.hemi.color.setHex(l.sky);
    this.hemi.groundColor.setHex(l.ground);
    this.hemi.intensity = l.fill * Math.PI;
    this.sun.color.setHex(l.sun);
    this.sun.intensity = l.key * Math.PI;
  }

  setDrawMode(tool: DrawTool | null): void {
    if (tool === this.drawTool) return;
    this.drawTool = tool;
    this.drawPts = [];
    this.rectAnchor = null;
    this.clearDrawPlane();
    this.controls.enabled = true;
    this.draft.clear();
    // The gesture goes, the results stay — including when switching between the
    // two measure tools. Clearing them is clearMeasures, and nothing else.
    this.dropMeasureGesture();
    if (tool) this.selectTarget(null);
    this.cb.onDraw(tool, 0);
  }

  /** Height and name for the next footprint or tree. Both come from React:
   *  the height is the dock's default, and a name has to be translated,
   *  which nothing under lib/viewer is allowed to do. */
  setDrawOptions(opts: { height: number; name: string; treeName: string }): void {
    if (Number.isFinite(opts.height)) this.drawHeight = Math.max(MIN_HEIGHT, opts.height);
    if (opts.name) this.drawName = opts.name;
    if (opts.treeName) this.drawTreeName = opts.treeName;
  }

  isDrawing(): boolean {
    return this.drawTool !== null;
  }

  /** Abandon the gesture but stay in the tool — one stray click should not cost
   *  the mode. Leaving the tool entirely is setDrawMode(null). */
  cancelDraw(): void {
    if (!this.drawTool) return;
    this.drawPts = [];
    this.rectAnchor = null;
    this.clearDrawPlane();
    this.controls.enabled = true;
    this.draft.clear();
    // For a measure tool this is what breaks a chain of distances or abandons a
    // half-drawn ring; the measurements already taken are untouched.
    this.dropMeasureGesture();
    this.cb.onDraw(this.drawTool, 0);
  }

  /** Close the ring being drawn: extrude it into a building, or commit it as an
   *  area measurement. */
  finishDraw(): void {
    if (this.drawTool === 'measureArea') {
      // Under three corners there is no region, so there is nothing to record —
      // and a degenerate one would sit on screen reading 0 m².
      if (this.measurePts.length >= 3) this.commitMeasure('area', this.measurePts);
      this.measurePts = [];
      this.measure.setLive('area', [], 'free');
      this.cb.onDraw(this.drawTool, 0);
      return;
    }
    if (this.drawTool !== 'polygon') return;
    this.commitFootprint(this.drawPts);
  }

  /* ---- measurements ---- */

  /** Record the points as a measurement and put it on screen. The caller owns
   *  what happens to the gesture afterwards — a distance chains, a ring does
   *  not — so this deliberately does not touch measurePts. */
  private commitMeasure(kind: MeasureKind, pts: THREE.Vector3[]): void {
    const m: Measure = { id: ++this.measureSeq, kind, pts: pts.map((p) => p.clone()) };
    this.measures.push(m);
    this.measure.add(m);
    this.cb.onMeasure(this.measures.length);
  }

  /** Forget the measurement in progress, keeping the ones already taken. */
  private dropMeasureGesture(): void {
    this.measurePts = [];
    this.hoverEvent = null;
    this.measure.setLive('dist', [], 'free');
  }

  /** Drop everything measured, silently. Called on a rebuild, where the points
   *  are world coordinates against geometry that is being replaced — and where
   *  the build's own closing summary is the message that belongs on screen. */
  private resetMeasures(): void {
    if (!this.measures.length && !this.measurePts.length) return;
    this.measures = [];
    this.measurePts = [];
    this.measure.clear();
    this.cb.onMeasure(0);
  }

  clearMeasures(): void {
    if (!this.measures.length) return;
    this.resetMeasures();
    this.cb.onStatus('status.measureCleared');
  }

  /** Drop the newest measurement — what Delete does while a measure tool is
   *  armed. Deliberately outside the undo stack: measurements are not part of
   *  the model, and mixing them in would make Ctrl-Z alternate between undoing
   *  an edit and undoing a reading. */
  undoMeasure(): void {
    const m = this.measures.pop();
    if (!m) return;
    this.measure.remove(m.id);
    this.cb.onMeasure(this.measures.length);
  }

  /** How a measurement's numbers are written. Comes from React, for the same
   *  reason a drawn building's name does: nothing here may compose text. */
  setMeasureOptions(fmt: MeasureFormat): void {
    this.measureFmt = fmt;
  }

  /** How many hand-drawn buildings and trees the scene holds — what a
   *  rebuild is about to discard. */
  drawnCount(): number {
    if (!this.scene) return 0;
    return (
      this.scene.buildings.filter((b) => b.src === 'user').length +
      this.scene.trees.filter((t) => t.src === 'user').length
    );
  }

  /**
   * Turn the corners just drawn into a real building.
   *
   * pushBuilding does the ring work — dedupe, winding, re-basing on the
   * centroid — so a drawn footprint arrives under exactly the invariants the
   * gizmo, the undo stack and the IFC writer already assume of a fetched one.
   * The base sits at the lowest corner so that no part of the building floats
   * over a slope. On a roof that is the identity — drawPlaneZ has already held
   * every corner at the same height — so this one rule covers both surfaces.
   */
  private commitFootprint(pts: THREE.Vector3[]): void {
    const s = this.scene;
    const tool = this.drawTool;
    this.drawPts = [];
    this.rectAnchor = null;
    this.clearDrawPlane();
    this.draft.clear();
    if (tool) this.cb.onDraw(tool, 0);
    if (!s || pts.length < 3) return;

    if (s.buildings.length >= BUILDING_CAP)
      return this.cb.onStatus('status.drawFull', { cap: BUILDING_CAP });

    const ring = pts.map((p): Vec2 => [p.x, p.y]);
    if (Math.abs(ringArea2(ring)) < MIN_FOOTPRINT_M2 * 2)
      return this.cb.onStatus('status.drawTooSmall');

    const baseZ = Math.min(...pts.map((p) => p.z));
    const n = ++this.drawSeq;
    const ok = pushBuilding(
      s,
      ring,
      this.drawHeight,
      'user',
      baseZ,
      `drawn-${n}`,
      `${this.drawName} ${n}`,
      // Height is deliberately not copied in: it is editable afterwards, and a
      // property bag repeating it would go stale the first time it changed.
      { Source: 'drawn' },
    );
    if (!ok) return this.cb.onStatus('status.drawTooSmall');

    const index = s.buildings.length - 1;
    const b = s.buildings[index];
    this.addBuildingMesh(b);
    this.cb.onCount(s.buildings.length);
    // Deliberately not selected: the tool stays armed so several can be drawn in
    // a row, and a gizmo attached to the last one would sit over the ground the
    // next corner is aimed at. The status line pushCmd emits is the confirmation.
    this.pushCmd({ label: 'edit.add', kind: 'life', b, index, added: true }, b.name);
  }

  /** Turn a single ground click into a planted tree — no ring, so this is
   *  the whole gesture rather than something a drag or a corner count feeds
   *  into. The tool stays armed, same reasoning as commitFootprint: planting
   *  several trees in a row shouldn't mean re-arming each time. */
  private commitTreePlacement(p: THREE.Vector3): void {
    const s = this.scene;
    if (!s) return;
    if (s.trees.length >= TREE_DRAW_CAP)
      return this.cb.onStatus('status.drawFull', { cap: TREE_DRAW_CAP });

    const n = ++this.drawTreeSeq;
    const { cr, tr } = defaultTreeDims(this.drawHeight);
    pushTree(
      s,
      p.x,
      p.y,
      p.z,
      this.drawHeight,
      cr,
      tr,
      `drawn-tree-${n}`,
      `${this.drawTreeName} ${n}`,
      { Source: 'drawn' },
      'user',
    );

    const index = s.trees.length - 1;
    const t = s.trees[index];
    this.addTreeMesh(t);
    // Deliberately not selected, same reasoning as commitFootprint: the tool
    // stays armed, and a gizmo on the last tree would sit over the ground the
    // next click is aimed at.
    this.pushCmd({ label: 'edit.add', kind: 'treeLife', t, index, added: true }, t.name);
  }

  resetElement(): void {
    const e = this.editable();
    if (!e) return;
    this.beginEdit();
    const fresh = newXf();
    e.xf.pos = fresh.pos;
    e.xf.rot = fresh.rot;
    e.xf.scale = fresh.scale;
    e.xf.color = fresh.color;
    e.xf.opacity = fresh.opacity;
    e.apply();
    e.paint();
    this.cb.onTransform(cloneXf(e.xf), e.getH());
    this.commitEdit('edit.reset');
    this.cb.onDirty();
  }

  /** The default wall colour for the current selection, for the colour input. */
  defaultColourOf(): number | null {
    return this.selected?.kind === 'building' ? defaultColors(this.selected.b).wall : null;
  }

  hasScene(): boolean {
    return !!this.scene && this.scene.buildings.length > 0;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    // These sit on the host, which is React's div and outlives the viewer —
    // unlike initPicking's, which go with the canvas when it is removed below.
    // Left behind, a disposed viewer would keep hit-testing on every pointer
    // move, and StrictMode mounts twice.
    this.listeners.abort();
    this.triad.dispose();
    this.gizmo.detach();
    this.gizmo.dispose();
    this.controls.dispose();
    Viewer.disposeGroup(this.contentGroup);
    this.layerBox.geometry.dispose();
    (this.layerBox.material as THREE.Material).dispose();
    // The markers sit on the scene rather than under contentGroup, for the same
    // reason the gizmo does — which means nothing else will free them.
    Viewer.disposeGroup(this.originMarker);
    Viewer.disposeGroup(this.pivotGhost);
    this.draft.dispose();
    // Frees its geometry and takes its label layer off the host, which is
    // React's div and outlives the viewer — see listeners.abort above.
    this.measure.dispose();
    // The dome is parented to the camera, so disposeGroup never sees it.
    this.skyDome.geometry.dispose();
    (this.skyDome.material as THREE.Material).dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
