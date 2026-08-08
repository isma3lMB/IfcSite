import * as THREE from 'three';
import { dedupe, ensureCCW } from '@/lib/geo/rings';
import {
  appendGeometry,
  treeCanopyGeometry,
  treeTrunkGeometry,
  treeTrunkHeight,
} from '@/lib/geo/treeShape';
import type { SampleZ, ToGeo, Tree, Vec2, Vec3 } from '@/lib/types';

/**
 * three.js already ships an earcut implementation; no reason to carry a
 * second. `holes`, when given, follows earcut/ShapeUtils convention: the
 * returned index triples index into the CONCATENATION of `ring`'s points
 * followed by each hole's points in order, so a caller must push `ring`'s
 * verts then each hole's verts, in that same order, before mapping faces.
 */
export function triangulate(ring: Vec2[], holes: Vec2[][] = []): number[][] {
  if (ring.length < 3) return [];
  try {
    return THREE.ShapeUtils.triangulateShape(
      ring.map((p) => new THREE.Vector2(p[0], p[1])),
      holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1]))),
    );
  } catch {
    return [];
  }
}

/**
 * A clipped local ring onto the terrain, lifted by dz so coplanar context
 * layers do not z-fight with each other or with the ground. Clipping happens in
 * local metres, so the z lookup has to go back through the inverse projection.
 */
export function drape(ring: Vec2[], toGeo: ToGeo, sampleZ: SampleZ, dz: number): Vec3[] {
  return ring.map((p): Vec3 => {
    const [lo, la] = toGeo(p[0], p[1]);
    return [p[0], p[1], sampleZ(la, lo) + dz];
  });
}

/**
 * Extrude a ring into a box of constant thickness and append it to shared
 * arrays. The base comes from a callback rather than a number so the bottom can
 * follow the terrain: a BD TOPO forest polygon is hundreds of metres across and
 * a single base elevation leaves it floating over, or buried in, every slope.
 *
 * The callback takes the point, not its index, on purpose — the ring is
 * reordered and deduplicated below, so an index-parallel array of elevations
 * would silently desync. Pass `() => z` for the old flat behaviour.
 */
export function prismInto(
  ring: Vec2[],
  baseAt: (p: Vec2) => number,
  h: number,
  verts: Vec3[],
  faces: number[][],
): void {
  const r = ensureCCW(dedupe(ring));
  const N = r.length;
  if (N < 3) return;
  const b = verts.length;
  const zs = r.map(baseAt);
  r.forEach((p, i) => verts.push([p[0], p[1], zs[i]]));
  r.forEach((p, i) => verts.push([p[0], p[1], zs[i] + h]));
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    faces.push([b + i, b + j, b + N + j], [b + i, b + N + j, b + N + i]); // wall
  }
  // Both caps: this mesh is the exported geometry, not only what the viewer
  // draws, and an open shell is not a solid. The base is wound the other way so
  // its normal points down into the ground rather than up through the mass.
  for (const t of triangulate(r)) {
    faces.push([b + N + t[0], b + N + t[1], b + N + t[2]]);
    faces.push([b + t[0], b + t[2], b + t[1]]);
  }
}

/**
 * A tree's trunk and canopy, appended into shared arrays at the LOCAL
 * origin — not at the tree's x/y/z. The IFC writer places each tree
 * individually (see addTree in lib/ifc/writer), the same way a building's
 * profile is local to its own centre; the live viewer builds the identical
 * shapes from the same lib/geo/treeShape helpers, so the exported tree always
 * matches the one on screen.
 */
export function treeProxy(
  t: Pick<Tree, 'h' | 'cr' | 'tr'>,
  verts: Vec3[],
  faces: number[][],
): void {
  const trunkH = treeTrunkHeight(t.h);
  const canopyH = Math.max(t.h - trunkH, 0.1);
  const m = new THREE.Matrix4();
  appendGeometry(treeTrunkGeometry(), m.makeScale(t.tr, t.tr, trunkH), verts, faces);
  appendGeometry(
    treeCanopyGeometry(),
    m.makeScale(t.cr, t.cr, canopyH / 2).setPosition(0, 0, trunkH + canopyH / 2),
    verts,
    faces,
  );
}
