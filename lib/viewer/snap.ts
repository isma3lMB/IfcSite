import * as THREE from 'three';

/**
 * What a measured point latched onto.
 *
 * 'free' is the raw ray hit — the surface under the cursor and nothing more.
 * The other three are features of the struck triangle, and they exist because a
 * distance between two eyeballed points on a wall is not a measurement: the
 * number it gives is right to within however many pixels the pointer was off,
 * which at fifty metres out is metres.
 */
export type SnapKind = 'vertex' | 'midpoint' | 'edge' | 'free';

export type Snap = { p: THREE.Vector3; kind: SnapKind };

/** How near, in CSS pixels, a feature has to be to take the point. The same
 *  order as the polygon tool's 12 px close target — small enough that a snap is
 *  something you aim for rather than something that happens to you. */
const SNAP_PX = 10;

/**
 * Priority, expressed as pixels of forgiveness rather than as a sort order.
 *
 * A corner and the edge that ends at it are within a pixel of each other near
 * that corner, so a strict nearest-wins would flicker between them. The bonus
 * makes the corner win the whole neighbourhood around itself, and the midpoint
 * win a smaller one, while still letting a genuinely nearer feature take the
 * point further along the edge.
 */
const BONUS: Record<SnapKind, number> = { vertex: 6, midpoint: 3, edge: 0, free: 0 };

/**
 * A world point in CSS pixels relative to the canvas, plus how far in front of
 * the camera it is.
 *
 * `behind` is separate from the coordinates because a point behind the camera
 * still projects to a finite pair of them — mirrored through the centre of the
 * screen. Anything that positions a label or measures a screen distance has to
 * drop those rather than trust them.
 */
export function toScreen(
  world: THREE.Vector3,
  camera: THREE.Camera,
  rect: { width: number; height: number },
): { x: number; y: number; behind: boolean } {
  const p = world.clone().project(camera);
  return {
    x: ((p.x + 1) / 2) * rect.width,
    y: ((1 - p.y) / 2) * rect.height,
    behind: p.z > 1,
  };
}

const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const vC = new THREE.Vector3();
const seg = new THREE.Line3();

/** The three world-space corners of the triangle a raycast struck, or null when
 *  the hit carries no face — a line, a sprite, a points cloud. */
function faceCorners(hit: THREE.Intersection): [THREE.Vector3, THREE.Vector3, THREE.Vector3] | null {
  const mesh = hit.object;
  if (!hit.face || !(mesh instanceof THREE.Mesh)) return null;
  const pos = mesh.geometry.getAttribute('position');
  if (!pos) return null;
  // Works for indexed geometry and for the raw triangle soup the roads and
  // railways are built as alike: three resolves the index buffer itself and
  // reports a/b/c as positions into the attribute either way.
  vA.fromBufferAttribute(pos as THREE.BufferAttribute, hit.face.a).applyMatrix4(mesh.matrixWorld);
  vB.fromBufferAttribute(pos as THREE.BufferAttribute, hit.face.b).applyMatrix4(mesh.matrixWorld);
  vC.fromBufferAttribute(pos as THREE.BufferAttribute, hit.face.c).applyMatrix4(mesh.matrixWorld);
  return [vA.clone(), vB.clone(), vC.clone()];
}

/**
 * Pull a ray hit onto the nearest feature of the triangle it struck.
 *
 * Nine candidates: three corners, three edge midpoints, and the foot of the
 * perpendicular from the hit onto each edge. All of them are compared in screen
 * space rather than in metres, so the tolerance means the same thing at every
 * camera distance — the same reason the polygon tool tests its close target
 * there.
 *
 * Only the struck triangle is consulted. A corner of a building is shared by
 * several, but whichever one the ray went through carries it, so there is
 * nothing to gain from widening the search and a great deal of geometry to walk.
 */
export function resolveSnap(
  hit: THREE.Intersection,
  camera: THREE.Camera,
  rect: { width: number; height: number },
  cursor: { x: number; y: number },
): Snap {
  const free: Snap = { p: hit.point.clone(), kind: 'free' };
  const tri = faceCorners(hit);
  if (!tri) return free;

  const candidates: Snap[] = [];
  for (let i = 0; i < 3; i++) {
    const a = tri[i];
    const b = tri[(i + 1) % 3];
    candidates.push({ p: a, kind: 'vertex' });
    candidates.push({ p: seg.set(a, b).at(0.5, new THREE.Vector3()), kind: 'midpoint' });
    candidates.push({
      p: seg.set(a, b).closestPointToPoint(hit.point, true, new THREE.Vector3()),
      kind: 'edge',
    });
  }

  let best = free;
  let bestScore = SNAP_PX;
  for (const c of candidates) {
    const s = toScreen(c.p, camera, rect);
    if (s.behind) continue;
    const score = Math.hypot(s.x - cursor.x, s.y - cursor.y) - BONUS[c.kind];
    if (score >= bestScore) continue;
    bestScore = score;
    best = c;
  }
  return best;
}
