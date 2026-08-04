import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { BUILDING_CAP, pushBuilding } from '@/lib/scene/push';
import { TERRAIN_COLOR, layerOpacity } from '@/lib/scene/stack';
import { MIN_SCALE, cloneXf, defaultColors, newXf, sameXf } from '@/lib/scene/xf';
import { type FootprintDraft, createFootprintDraft } from '@/lib/viewer/footprintDraft';
import { createOriginMarker, markerPick, setMarkerActive } from '@/lib/viewer/originMarker';
import { SKY, createSkyDome } from '@/lib/viewer/sky';
import type { EditLabelKey, Params, StatusKey } from '@/lib/i18n/keys';
import type { Building, GizmoMode, SceneData, Site, Vec2, Vec3, Xf } from '@/lib/types';

const lighten = (hex: number, t: number): number =>
  new THREE.Color(hex).lerp(new THREE.Color(0xffffff), t).getHex();

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
   */
  kind: 'building' | 'origin';
  id: string;
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

/** Which footprint tool the ground clicks are feeding, if any. */
export type DrawTool = 'rect' | 'polygon';

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
   * The draw tool or the corner count changed. The viewer cancels a gesture on
   * its own (Esc, a completed shape), so the toolbar has to be told rather than
   * assuming the mode it last asked for is still live.
   */
  onDraw: (tool: DrawTool | null, points: number) => void;
};

/**
 * What the gizmo is attached to. A point has no ring, no colour and no source,
 * so it cannot be squeezed into a Building — the two ride a union instead, and
 * every site that only makes sense for one of them says so.
 */
type Target =
  | { kind: 'building'; obj: THREE.Mesh; b: Building }
  | { kind: 'origin'; obj: THREE.Object3D };

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
  | { label: EditLabelKey; kind: 'origin'; before: Vec3; after: Vec3 }
  | { label: EditLabelKey; kind: 'life'; b: Building; index: number; added: boolean };

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

const originXf = (off: THREE.Vector3): Xf => ({
  pos: [off.x, off.y, off.z],
  rot: [0, 0, 0],
  scale: [1, 1, 1],
  color: null,
  opacity: 1,
});

/** Below this a drawn footprint is a slip of the pointer, not a building. */
const MIN_FOOTPRINT_M2 = 1;
/** Shortest extrusion the editor will accept, in metres. */
const MIN_HEIGHT = 0.5;
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
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly contentGroup: THREE.Group;
  private readonly skyDome: THREE.Mesh;
  private readonly gizmo: TransformControls;
  private readonly resizeObserver: ResizeObserver;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();

  /** The scene's centre point: where the exported model's zero sits. */
  private readonly originMarker: THREE.Group;
  private readonly originPick: THREE.Mesh;
  /** A read-only copy drawn at the selected element's own pivot. */
  private readonly pivotGhost: THREE.Group;
  private readonly originOffset = new THREE.Vector3();

  /* ---- footprint authoring ----
     The ground is whatever a new corner lands on: the terrain mesh when the
     scene has one, so a drawn building follows a slope instead of floating over
     it, and a flat plane at the datum otherwise. The plane's normal is +Z
     because this scene is Z-up (see camera.up in the constructor). */
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
  /** Where a rectangle drag started; null unless one is in progress. */
  private rectAnchor: THREE.Vector3 | null = null;

  private firstFrame = true;
  private buildingMeshes: THREE.Mesh[] = [];
  private selected: Target | null = null;
  /** false while the 2D map covers the viewport — nothing to draw behind it. */
  private active = false;
  private raf = 0;
  private disposed = false;

  private scene: SceneData | null = null;
  private compass: HTMLElement | null = null;

  private readonly edits: { stack: Cmd[]; index: number; limit: number } = {
    stack: [],
    index: -1,
    limit: 100,
  };
  private pending:
    | { kind: 'building'; b: Building; before: Xf; beforeH: number }
    | { kind: 'origin'; before: Vec3 }
    | null = null;

  constructor(host: HTMLElement, cb: ViewerCallbacks) {
    this.host = host;
    this.cb = cb;

    this.sceneGL = new THREE.Scene();
    // Fallback for the frame before frameCamera() sizes the dome; the dome covers it after.
    this.sceneGL.background = new THREE.Color(SKY.horizon);

    this.camera = new THREE.PerspectiveCamera(
      45,
      host.clientWidth / Math.max(1, host.clientHeight),
      1,
      200000,
    );
    // data is E/N/height (Z-up) — must be set before OrbitControls is built
    this.camera.up.set(0, 0, 1);

    // The dome rides on the camera so orbit distance can never escape it, and the
    // camera goes into the scene graph or its children are never traversed.
    this.skyDome = createSkyDome();
    this.camera.add(this.skyDome);
    this.sceneGL.add(this.camera);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 100000;

    this.sceneGL.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(180, -260, 420);
    this.sceneGL.add(sun);

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
      } else {
        this.readMeshInto(t.obj, t.b.xf);
        this.cb.onTransform(cloneXf(t.b.xf), t.b.h);
      }
      this.cb.onDirty();
    });
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
    this.sceneGL.add(this.originMarker, this.pivotGhost, this.draft.group);

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
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private updateCompass(): void {
    if (!this.compass) return;
    const dir = this.camera.position.clone().sub(this.controls.target);
    const az = (Math.atan2(dir.x, dir.y) * 180) / Math.PI; // Y=north in local E/N coords
    this.compass.style.transform = `rotate(${-az}deg)`;
  }

  /**
   * Hold an object at a constant pixel size, the way TransformControls holds the
   * gizmo — a marker sized in metres is either invisible across a 1 km site or
   * fills the screen at a doorway. Rendering is continuous, so this is free.
   */
  private scaleToScreen(o: THREE.Object3D, px: number): void {
    const d = this.camera.position.distanceTo(o.position);
    const h = Math.max(1, this.host.clientHeight);
    const worldPerPx = (2 * Math.tan((this.camera.fov * Math.PI) / 360) * d) / h;
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

  private animate = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.animate);
    if (!this.active) return; // the map is up; nothing to draw behind it
    this.controls.update();
    this.updateCompass();
    this.updateMarkers();
    this.renderer.render(this.sceneGL, this.camera);
  };

  setActive(on: boolean): void {
    this.active = on;
    if (on) this.resize();
  }

  /** z0 is the site's ground elevation: model z is absolute where the scene has a
   *  vertical datum, so orbiting about z = 0 would put the pivot as far under the
   *  ground as the site is above sea level. */
  private frameCamera(radius: number, z0: number): void {
    const dist = radius * 1.05 * 2.4;
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
    this.camera.near = Math.max(0.5, dist / 2000);
    this.camera.far = dist * 25;
    this.camera.updateProjectionMatrix();
    this.controls.update();

    // Sit the dome well inside [near, far] so it is never clipped at either end.
    this.skyDome.scale.setScalar(this.camera.far * 0.4);
  }

  private static disposeGroup(g: THREE.Object3D): void {
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material)
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((mm) => mm.dispose());
    });
    while (g.children.length) g.remove(g.children[0]);
  }

  setScene(scene: SceneData, site: Site): void {
    this.scene = scene;
    this.clearHistory();
    this.setDrawMode(null);
    this.selectTarget(null);
    this.buildingMeshes = [];
    this.groundMesh = null;
    Viewer.disposeGroup(this.contentGroup);
    // A rebuild re-derives the site, so an offset measured against the old one
    // means nothing — the origin goes back to the centre with it.
    this.setOrigin([0, 0, 0], false);

    const { halfX, halfY } = site;
    // Where the ground is. Everything the builder produced is in absolute model z
    // once the scene has a vertical datum, so the reference plane has to rise to
    // meet it — left at zero it reads as the ground and puts the whole site
    // apparently in mid-air. Null datum means a flat scene, and zero is right.
    const z0 = scene.datumZ ?? 0;
    const ext = Math.max(halfX, halfY) * 1.05;
    const gridSize = Math.ceil(ext / 50) * 50 * 2;
    const divisions = Math.round(gridSize / 50);
    const grid = new THREE.GridHelper(gridSize, divisions, 0x2a2e30, 0x2a2e30);
    // GridHelper lies in XZ by default; data is Z-up, so tilt into XY
    grid.rotation.x = Math.PI / 2;
    grid.position.z = z0;
    this.contentGroup.add(grid);

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
        new THREE.LineBasicMaterial({ color: 0xf0fb29, transparent: true, opacity: 0.5 }),
      ),
    );

    if (scene.roads.length) {
      const pos: number[] = [];
      for (const [p0, p1, p2, p3] of scene.roads)
        pos.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
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
          color: 0xf0fb29,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      );
      roadMesh.renderOrder = 4;
      this.contentGroup.add(roadMesh);
      const roadEdges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({
          color: 0xf0fb29,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      );
      roadEdges.renderOrder = 4;
      this.contentGroup.add(roadEdges);
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
      this.contentGroup.add(this.groundMesh);
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
    const SURFACE_TIER: Record<string, number> = { parcel: 1, vegetation: 2, water: 3, hedge: 5 };
    for (const s of scene.surfaces) {
      const tier = SURFACE_TIER[s.layer ?? ''] ?? 1;
      // Opacity comes from lib/scene/stack, the same number the IFC exports as
      // transparency. A layer drawn below 1 must not write depth, or it hides
      // what it is meant to be a tint over.
      const alpha = layerOpacity(s.layer);
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
      this.contentGroup.add(mesh);
    }

    if (scene.trees.length) {
      // Shared geometry, one draw call each — a dense quarter runs to 1200 trees.
      const trunkGeo = new THREE.CylinderGeometry(1, 1, 1, 6);
      const canopyGeo = new THREE.ConeGeometry(1, 1, 7);
      // three.js is Y-up, data is Z-up
      trunkGeo.rotateX(Math.PI / 2);
      canopyGeo.rotateX(Math.PI / 2);
      trunkGeo.translate(0, 0, 0.5);
      canopyGeo.translate(0, 0, 0.5);
      const trunks = new THREE.InstancedMesh(
        trunkGeo,
        new THREE.MeshLambertMaterial({ color: 0x4a3b2a, flatShading: true }),
        scene.trees.length,
      );
      const canopies = new THREE.InstancedMesh(
        canopyGeo,
        new THREE.MeshLambertMaterial({ color: 0x2e5e33, flatShading: true }),
        scene.trees.length,
      );
      const m = new THREE.Matrix4();
      scene.trees.forEach((t, i) => {
        const trunkH = Math.max(t.h * 0.35, 0.6);
        trunks.setMatrixAt(i, m.makeScale(t.tr, t.tr, trunkH).setPosition(t.x, t.y, t.z));
        canopies.setMatrixAt(
          i,
          m.makeScale(t.cr, t.cr, t.h - trunkH).setPosition(t.x, t.y, t.z + trunkH),
        );
      });
      trunks.instanceMatrix.needsUpdate = true;
      canopies.instanceMatrix.needsUpdate = true;
      // Opaque, so normal depth-testing is enough on its own; the render order
      // just keeps them drawn last, top of the stack, matching lib/scene/stack.
      trunks.renderOrder = 6;
      canopies.renderOrder = 6;
      this.contentGroup.add(trunks, canopies);
    }

    this.frameCamera(site.radius, z0);
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
        new THREE.LineBasicMaterial({ color: 0x15181a }),
      ),
    );
    this.applyXf(mesh, b);
    this.paintMesh(mesh, b);
    this.contentGroup.add(mesh);
    this.buildingMeshes.push(mesh);
    return mesh;
  }

  private removeBuildingMesh(b: Building): void {
    const mesh = this.meshFor(b);
    if (!mesh) return;
    this.buildingMeshes.splice(this.buildingMeshes.indexOf(mesh), 1);
    this.contentGroup.remove(mesh);
    // disposeGroup traverses, so the outline child goes with it.
    Viewer.disposeGroup(mesh);
  }

  /** The outline child, which has to be rebuilt whenever the geometry is. */
  private static outlineOf(mesh: THREE.Mesh): THREE.LineSegments | undefined {
    return mesh.children.find((c) => c instanceof THREE.LineSegments) as
      | THREE.LineSegments
      | undefined;
  }

  /** Swap in a prism for the building's current height, keeping the material,
   *  the transform and the selection exactly as they were. */
  private rebuildGeometry(mesh: THREE.Mesh, b: Building): void {
    const geo = Viewer.buildingGeometry(b);
    mesh.geometry.dispose();
    mesh.geometry = geo;
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
    const c =
      b.xf.color === null
        ? defaultColors(b)
        : { wall: b.xf.color, cap: lighten(b.xf.color, 0.35) };
    // ExtrudeGeometry group 0 is the caps (roof + floor), group 1 the side walls.
    const mats = mesh.material as THREE.MeshLambertMaterial[];
    mats[0].color.setHex(c.cap);
    mats[1].color.setHex(c.wall);
    const em = this.selected?.kind === 'building' && this.selected.obj === mesh ? 0x2e4a5c : 0x000000;
    mats[0].emissive.setHex(em);
    mats[1].emissive.setHex(em);

    // Transparency, on the same terms as the context surfaces above: a solid
    // drawn below 1 must not write depth, or it hides what it is meant to be
    // seen through — including its own far side, which is what makes a ghosted
    // massing readable. Translucent buildings draw last, above the trees at 6
    // in lib/scene/stack, so they blend over a finished opaque scene.
    const a = b.xf.opacity;
    for (const m of mats) {
      m.transparent = a < 1;
      m.opacity = a;
      m.depthWrite = a >= 1;
    }
    mesh.renderOrder = a < 1 ? 7 : 0;

    // The outline fades with the solid, or a ghost keeps hard black edges and
    // reads as a wireframe box rather than as a faint volume.
    const outline = Viewer.outlineOf(mesh);
    if (outline) {
      const om = outline.material as THREE.LineBasicMaterial;
      om.transparent = a < 1;
      om.opacity = a;
      om.depthWrite = a >= 1;
      outline.renderOrder = mesh.renderOrder;
    }
  }

  private meshFor(b: Building): THREE.Mesh | undefined {
    return this.buildingMeshes.find((m) => m.userData.building === b);
  }

  private selectTarget(t: Target | null): void {
    const prev = this.selected;
    this.selected = t;
    if (prev?.kind === 'building' && prev.obj !== t?.obj && prev.obj.parent)
      this.paintMesh(prev.obj, prev.b);
    if (prev?.kind === 'origin' && t?.kind !== 'origin') setMarkerActive(this.originMarker, false);

    if (t) {
      this.gizmo.attach(t.obj);
      if (t.kind === 'building') this.paintMesh(t.obj, t.b);
      else {
        setMarkerActive(this.originMarker, true);
        // A point has nothing to turn or stretch, so the mode is not the user's
        // to pick while it is selected — say so rather than leaving dead buttons.
        if (this.gizmo.getMode() !== 'translate') {
          this.gizmo.setMode('translate');
          this.cb.onMode('translate');
        }
      }
    } else this.gizmo.detach();

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
   * Where a pointer meets the ground, in world metres.
   *
   * The terrain mesh first, so a corner placed on a hillside carries that
   * hillside's elevation and the drawn building sits on it; the datum plane
   * otherwise, which is the whole ground of a flat scene. Null when the ray
   * misses both — pointing at the sky.
   */
  private pickGround(e: PointerEvent | MouseEvent): THREE.Vector3 | null {
    this.setRay(e);
    if (this.groundMesh) {
      const hit = this.raycaster.intersectObject(this.groundMesh, false)[0];
      if (hit) return hit.point.clone();
    }
    this.groundPlane.constant = -(this.scene?.datumZ ?? 0);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, p) ? p : null;
  }

  private initPicking(): void {
    const dom = this.renderer.domElement;
    let downX = 0;
    let downY = 0;
    let onGizmo = false;

    dom.addEventListener('pointerdown', (e) => {
      downX = e.clientX;
      downY = e.clientY;
      onGizmo = !!this.gizmo.axis; // the gizmo sets .axis while hovered

      // A rectangle is one drag, so it takes the camera off the left button for
      // the duration — the same arbitration the gizmo makes in dragging-changed.
      if (this.drawTool === 'rect' && e.button === 0) {
        const p = this.pickGround(e);
        if (!p) return;
        this.rectAnchor = p;
        this.controls.enabled = false;
      }
    });

    dom.addEventListener('pointermove', (e) => {
      // Nothing to rubber-band from until a gesture is under way. Checked before
      // the pick, because that pick raycasts the terrain mesh and this fires on
      // every move the pointer makes while a tool is armed.
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
      if (this.drawTool === 'rect') {
        const anchor = this.rectAnchor;
        this.rectAnchor = null;
        this.controls.enabled = true;
        if (!anchor || e.button !== 0) return;
        const p = this.pickGround(e);
        // A click rather than a drag: no rectangle was described, so this is a
        // miss, not an empty building.
        if (p && Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_PX)
          this.commitFootprint(Viewer.rectCorners(anchor, p));
        else this.showDraft([], false);
        return;
      }

      if (onGizmo || this.gizmo.dragging) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_PX) return; // that was an orbit

      if (this.drawTool === 'polygon') {
        if (e.button !== 0) return this.cancelDraw();
        const p = this.pickGround(e);
        if (!p) return;
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

      this.setRay(e);
      // The marker draws over everything, so it picks over everything too —
      // otherwise it would be unreachable wherever it sits inside a building.
      if (this.originMarker.visible && this.raycaster.intersectObject(this.originPick).length)
        return this.selectTarget({ kind: 'origin', obj: this.originMarker });
      const hit = this.raycaster.intersectObjects(this.buildingMeshes, false)[0];
      this.selectTarget(this.buildingTarget(hit?.object as THREE.Mesh | undefined));
    });

    // Closing on a double-click means the second click has already been taken
    // as a corner, so it is dropped before the ring is committed.
    dom.addEventListener('dblclick', () => {
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
    const p = world.clone().project(this.camera);
    return Math.hypot(
      ((p.x + 1) / 2) * r.width + r.left - e.clientX,
      ((1 - p.y) / 2) * r.height + r.top - e.clientY,
    );
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

  /** Draw the in-progress footprint, lifted clear of the ground so it is not
   *  swallowed by the surface it is being drawn on. */
  private showDraft(pts: THREE.Vector3[], closed: boolean): void {
    this.draft.setPoints(
      pts.map((p) => new THREE.Vector3(p.x, p.y, p.z + 0.4)),
      closed,
    );
  }

  /** False when the mode was refused, so the UI does not show one that is not
   *  in effect — the origin is translate-only; see selectTarget. */
  setMode(mode: GizmoMode): boolean {
    if (this.selected?.kind === 'origin') return false;
    this.gizmo.setMode(mode);
    return true;
  }

  select(id: string | null): void {
    if (id === null) return this.selectTarget(null);
    if (id === ORIGIN_ID)
      return this.selectTarget(
        this.originMarker.visible ? { kind: 'origin', obj: this.originMarker } : null,
      );
    const mesh = this.buildingMeshes.find((m) => (m.userData.building as Building).id === id);
    this.selectTarget(this.buildingTarget(mesh));
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

  /** Put the model origin back at the site centre, as one undoable step. */
  resetOrigin(): void {
    if (this.originOffset.lengthSq() === 0) return;
    this.beginEdit();
    this.setOrigin([0, 0, 0]);
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
    this.pending =
      t.kind === 'origin'
        ? { kind: 'origin', before: this.originOffset.toArray() as Vec3 }
        : { kind: 'building', b: t.b, before: cloneXf(t.b.xf), beforeH: t.b.h };
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
    } else this.applyXfCmd(c.b, c[to], to === 'after' ? c.afterH : c.beforeH);
  }

  private cmdName(c: Cmd): string {
    return c.kind === 'origin' ? ORIGIN_NAME : c.b.name;
  }

  undo(): void {
    if (this.edits.index < 0) return;
    const c = this.edits.stack[this.edits.index--];
    this.applyCmd(c, 'before');
    this.syncHistory();
    this.cb.onStatus('status.undone', { label: c.label, name: this.cmdName(c) });
  }

  redo(): void {
    if (this.edits.index >= this.edits.stack.length - 1) return;
    const c = this.edits.stack[++this.edits.index];
    this.applyCmd(c, 'after');
    this.syncHistory();
    this.cb.onStatus('status.redone', { label: c.label, name: this.cmdName(c) });
  }

  /* ---- editor panel writes ------------------------------------------ */

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

    const b = t.b;
    const xf = b.xf;
    this.beginEdit();

    if (key === 'scale') {
      const v = Math.max(MIN_SCALE, raw); // no mirroring: it would flip ring winding
      if (uniform) xf.scale = [v, v, v];
      else xf.scale[i] = v;
    } else if (key === 'rot') xf.rot[i] = (raw * Math.PI) / 180;
    else xf.pos[i] = raw;

    this.applyXf(t.obj, b);
    this.cb.onTransform(cloneXf(xf), b.h);
    this.cb.onDirty();
    if (commit) this.commitEdit(key === 'pos' ? 'edit.move' : key === 'rot' ? 'edit.rotate' : 'edit.scale');
  }

  setColor(hex: number, commit: boolean): void {
    const t = this.selected;
    if (t?.kind !== 'building') return;
    this.beginEdit();
    t.b.xf.color = hex;
    this.paintMesh(t.obj, t.b);
    this.cb.onTransform(cloneXf(t.b.xf), t.b.h);
    this.cb.onDirty();
    if (commit) this.commitEdit('edit.colour');
  }

  resetColor(): void {
    const t = this.selected;
    if (t?.kind !== 'building') return;
    this.beginEdit();
    t.b.xf.color = null;
    this.paintMesh(t.obj, t.b);
    this.cb.onTransform(cloneXf(t.b.xf), t.b.h);
    this.commitEdit('edit.colourReset');
    this.cb.onDirty();
  }

  /** `a` is opacity, 0..1. Same live/commit split as the colour swatch: the
   *  slider previews continuously and the undo boundary is the drag ending. */
  setOpacity(a: number, commit: boolean): void {
    const t = this.selected;
    if (t?.kind !== 'building' || !Number.isFinite(a)) return;
    this.beginEdit();
    t.b.xf.opacity = Math.min(1, Math.max(0, a));
    this.paintMesh(t.obj, t.b);
    this.cb.onTransform(cloneXf(t.b.xf), t.b.h);
    this.cb.onDirty();
    if (commit) this.commitEdit('edit.opacity');
  }

  /**
   * Set the extrusion height in metres.
   *
   * Height is baked into the geometry rather than carried on the transform, so
   * this rebuilds the prism instead of writing a matrix — which is also why it
   * rides the same begin/commit pair as everything else on the panel: a typed
   * height and a gizmo drag in one gesture must still be one undo step.
   */
  setHeight(h: number, commit: boolean): void {
    const t = this.selected;
    if (t?.kind !== 'building' || !Number.isFinite(h)) return;
    this.beginEdit();
    t.b.h = Math.max(MIN_HEIGHT, h);
    this.rebuildGeometry(t.obj, t.b);
    this.cb.onTransform(cloneXf(t.b.xf), t.b.h);
    this.cb.onDirty();
    if (commit) this.commitEdit('edit.height');
  }

  /** Remove the selected building from the scene. Undoable: the record itself
   *  rides on the command, so an undo restores it exactly where it was. */
  deleteSelected(): void {
    const t = this.selected;
    const s = this.scene;
    if (t?.kind !== 'building' || !s) return;
    const b = t.b;
    const index = s.buildings.indexOf(b);
    if (index < 0) return;
    this.detachBuilding(b);
    this.pushCmd({ label: 'edit.delete', kind: 'life', b, index, added: false }, b.name);
  }

  /* ---- drawing a footprint --------------------------------------------
     A tool takes over the left button: clicks stop selecting and start placing
     corners on the ground. The gizmo comes off first, or it would keep
     swallowing the clicks meant for the ground beneath it.
     ------------------------------------------------------------------- */

  setDrawMode(tool: DrawTool | null): void {
    if (tool === this.drawTool) return;
    this.drawTool = tool;
    this.drawPts = [];
    this.rectAnchor = null;
    this.controls.enabled = true;
    this.draft.clear();
    if (tool) this.selectTarget(null);
    this.cb.onDraw(tool, 0);
  }

  /** Height and name for the next footprint. Both come from React: the height
   *  is the dock's default, and a name has to be translated, which nothing
   *  under lib/viewer is allowed to do. */
  setDrawOptions(opts: { height: number; name: string }): void {
    if (Number.isFinite(opts.height)) this.drawHeight = Math.max(MIN_HEIGHT, opts.height);
    if (opts.name) this.drawName = opts.name;
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
    this.controls.enabled = true;
    this.draft.clear();
    this.cb.onDraw(this.drawTool, 0);
  }

  /** Close the polygon being drawn and extrude it. */
  finishDraw(): void {
    if (this.drawTool !== 'polygon') return;
    this.commitFootprint(this.drawPts);
  }

  /** How many hand-drawn buildings the scene holds — what a rebuild is about
   *  to discard. */
  drawnCount(): number {
    return this.scene?.buildings.filter((b) => b.src === 'user').length ?? 0;
  }

  /**
   * Turn the corners just drawn into a real building.
   *
   * pushBuilding does the ring work — dedupe, winding, re-basing on the
   * centroid — so a drawn footprint arrives under exactly the invariants the
   * gizmo, the undo stack and the IFC writer already assume of a fetched one.
   * The base sits at the lowest corner so that no part of the building floats
   * over a slope.
   */
  private commitFootprint(pts: THREE.Vector3[]): void {
    const s = this.scene;
    const tool = this.drawTool;
    this.drawPts = [];
    this.rectAnchor = null;
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

  resetElement(): void {
    const t = this.selected;
    if (t?.kind !== 'building') return;
    this.beginEdit();
    t.b.xf = newXf();
    this.applyXf(t.obj, t.b);
    this.paintMesh(t.obj, t.b);
    this.cb.onTransform(cloneXf(t.b.xf), t.b.h);
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
    this.gizmo.detach();
    this.gizmo.dispose();
    this.controls.dispose();
    Viewer.disposeGroup(this.contentGroup);
    // The markers sit on the scene rather than under contentGroup, for the same
    // reason the gizmo does — which means nothing else will free them.
    Viewer.disposeGroup(this.originMarker);
    Viewer.disposeGroup(this.pivotGhost);
    this.draft.dispose();
    // The dome is parented to the camera, so disposeGroup never sees it.
    this.skyDome.geometry.dispose();
    (this.skyDome.material as THREE.Material).dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
