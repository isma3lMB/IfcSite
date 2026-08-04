import * as THREE from 'three';

/**
 * Axis colours for the origin marker.
 *
 * Data is E/N/height, so these read X=east, Y=north, Z=up — not three.js's Y-up
 * convention. They sit a little off pure R/G/B so the marker stays quieter than
 * the TransformControls gizmo it shares the scene with.
 */
export const AXIS = { x: 0xe0564a, y: 0x55ad57, z: 0x5786e0 } as const;

/** The site-boundary yellow, reused for the centre dot. */
const DOT = 0xf0fb29;

/** Unit geometry: arms run from -STUB to ARM, so the triad reads as a crosshair
 *  rather than as three arms hanging off a corner. */
const ARM = 1;
const STUB = 0.22;
/** Arm thickness. The caller scales the whole group to a pixel size, so this is
 *  a fraction of the arm length — thin enough to stay quiet, thick enough that
 *  a raster line does not disappear against the ground. */
const RADIUS = 0.045;

const DIRS: [keyof typeof AXIS, THREE.Euler][] = [
  // A cylinder is built along +Y, so each arm is turned onto its own axis.
  ['x', new THREE.Euler(0, 0, -Math.PI / 2)],
  ['y', new THREE.Euler(0, 0, 0)],
  ['z', new THREE.Euler(Math.PI / 2, 0, 0)],
];

type Painted = THREE.Mesh<THREE.BufferGeometry, THREE.Material & { opacity: number }>;

const isPainted = (o: THREE.Object3D): o is Painted =>
  o instanceof THREE.Mesh && !Array.isArray(o.material);

/**
 * A unit-sized XYZ triad marking a point.
 *
 * Built at unit size: the caller rescales it every frame so it holds a constant
 * pixel size, the way TransformControls does. Everything draws with depthTest
 * off — a datum you cannot find behind a building is useless — and the arms are
 * thin solids rather than lines, because a one-pixel line at this palette's
 * contrast vanishes against the reference grid.
 *
 * `ghost` dims it and strips raycasting, for the read-only copy drawn at a
 * selected element's pivot: it must never intercept a click meant for the gizmo
 * or the building under it.
 */
export function createOriginMarker(ghost: boolean): THREE.Group {
  const g = new THREE.Group();
  const dim = ghost ? 0.42 : 1;

  const paint = (o: Painted, base: number): void => {
    o.material.transparent = true;
    o.material.depthTest = false;
    o.material.opacity = base * dim;
    o.userData.baseOpacity = base;
    o.renderOrder = 4;
    g.add(o);
  };

  const geo = new THREE.CylinderGeometry(RADIUS, RADIUS, ARM + STUB, 8);
  // Shift so the arm spans -STUB..ARM instead of straddling the centre.
  geo.translate(0, (ARM - STUB) / 2, 0);
  for (const [key, rot] of DIRS) {
    const arm = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: AXIS[key] }));
    arm.rotation.copy(rot);
    paint(arm, 0.78);
  }

  const dot = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.13),
    new THREE.MeshBasicMaterial({ color: DOT }),
  );
  paint(dot, 0.95);
  dot.renderOrder = 5;

  if (ghost) {
    g.traverse((o) => {
      o.raycast = () => {};
    });
  } else {
    // The arms are too thin to hit reliably, so the click target is an invisible
    // sphere around the centre rather than the geometry on screen.
    const pick = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 12, 8),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    pick.name = 'pick';
    g.add(pick);
  }

  g.userData.baseDim = dim;
  return g;
}

/** The pick target of a non-ghost marker — what initPicking raycasts against. */
export function markerPick(g: THREE.Group): THREE.Mesh {
  return g.getObjectByName('pick') as THREE.Mesh;
}

/** Brighten while selected, so the marker reads as picked without growing. */
export function setMarkerActive(g: THREE.Group, on: boolean): void {
  const dim = (g.userData.baseDim as number) * (on ? 1.3 : 1);
  g.traverse((o) => {
    if (!isPainted(o)) return;
    const base = o.userData.baseOpacity as number | undefined;
    if (base === undefined) return; // the invisible pick sphere
    o.material.opacity = Math.min(1, base * dim);
  });
}
