import * as THREE from 'three';
import { dedupe, ensureCCW } from '@/lib/geo/rings';
import type { SampleZ, ToGeo, Tree, Vec2, Vec3 } from '@/lib/types';

/** three.js already ships an earcut implementation; no reason to carry a second. */
export function triangulate(ring: Vec2[]): number[][] {
  if (ring.length < 3) return [];
  try {
    return THREE.ShapeUtils.triangulateShape(
      ring.map((p) => new THREE.Vector2(p[0], p[1])),
      [],
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
 * A 6-sided trunk and a 6-sided canopy cone, appended into shared arrays.
 * ~24 triangles a tree: enough to read as planting, cheap enough to merge.
 */
export const TREE_SIDES = 6;

export function treeProxy(t: Tree, verts: Vec3[], faces: number[][]): void {
  const base = verts.length;
  const trunkH = Math.max(t.h * 0.35, 0.6);
  for (let i = 0; i < TREE_SIDES; i++) {
    const a = (i / TREE_SIDES) * Math.PI * 2;
    const cx = Math.cos(a);
    const sy = Math.sin(a);
    verts.push([t.x + cx * t.tr, t.y + sy * t.tr, t.z]); // trunk foot
    verts.push([t.x + cx * t.tr, t.y + sy * t.tr, t.z + trunkH]); // trunk top
    verts.push([t.x + cx * t.cr, t.y + sy * t.cr, t.z + trunkH]); // canopy skirt
  }
  const apex = verts.length;
  verts.push([t.x, t.y, t.z + t.h]);
  for (let i = 0; i < TREE_SIDES; i++) {
    const p = base + i * 3;
    const q = base + ((i + 1) % TREE_SIDES) * 3;
    faces.push([p, q, q + 1], [p, q + 1, p + 1]); // trunk wall
    faces.push([p + 2, q + 2, apex]); // canopy cone
    faces.push([p + 1, q + 1, q + 2], [p + 1, q + 2, p + 2]); // skirt underside
  }
}
