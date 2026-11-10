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
 *
 * `zAt` short-circuits that round trip for a layer whose elevation comes from
 * its own source geometry rather than from the DEM — see lib/geo/sourcez. It
 * already speaks local metres, so reprojecting out to lat/lon only to hand back
 * a local-space answer would be pure proj4 cost. `dz` still applies either way.
 */
export function drape(
  ring: Vec2[],
  toGeo: ToGeo,
  sampleZ: SampleZ,
  dz: number,
  zAt?: (x: number, y: number) => number,
): Vec3[] {
  if (zAt) return ring.map((p): Vec3 => [p[0], p[1], zAt(p[0], p[1]) + dz]);
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
 *
 * For a free-standing mass built from its own ring — a hedge — this is the
 * right tool. To hang a skirt under a surface that has ALREADY been conformed
 * to the terrain, use skirtInto below instead: driving this from the same raw
 * ring the conform started from produces a wall whose top edge is a straight
 * chord where the conformed skin follows the ground, and the two come apart.
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
 * Hang a watertight skirt under an already-conformed top surface, turning a
 * draped skin into a closed solid, in place.
 *
 * `verts`/`faces` must hold that top surface and NOTHING ELSE: the outline is
 * read back out of `faces` itself, so anything already appended would be walled
 * too. Returns the index in `faces` where the skirt starts, for callers that
 * keep the top and the skirt in separate scene arrays.
 *
 * Why read the outline back rather than re-extrude the ring the surface was
 * built from — which is what this replaced. conformToTerrain cuts a ring on the
 * terrain's own triangles, so the skin it returns carries a vertex everywhere
 * the ring crosses a lattice line, each one sampled at the real ground height.
 * The original ring has none of those. Walling the original therefore spans
 * each of its edges with ONE straight chord where the skin bends to follow the
 * hillside, and the two disagree by the terrain's rise across that edge —
 * metres, on a BD TOPO forest boundary, against the decimetre rungs in
 * lib/scene/stack that are supposed to decide what covers what. The seam tears
 * open on a ridge and the wall stands proud through its own skin in a hollow.
 * Densifying the ring first only shrinks that error: the stations still land
 * somewhere other than the lattice crossings, so every one is a T-junction.
 *
 * Taking the outline off the triangulation removes the disagreement rather
 * than shrinking it — the skirt's top rim IS the skin's own boundary, the same
 * vertex indices, not a second copy at nearly the same place. It also costs
 * nothing to elevate: these vertices already carry their height, where
 * extruding a ring pays an inverse projection and a terrain sample for every
 * corner.
 */
export function skirtInto(verts: Vec3[], faces: number[][], depth: number, cap = true): number {
  const start = faces.length;
  if (depth <= 0) return start;

  // An edge used by one triangle is on the outline; used by two, it is interior.
  // A zero-width seam left by clipping a concave ring shows up as both (u,v)
  // and (v,u), counts two, and is correctly left unwalled.
  const count = new Map<string, number>();
  const dir = new Map<string, [number, number]>();
  for (let f = 0; f < start; f++) {
    const face = faces[f];
    for (let i = 0; i < face.length; i++) {
      const a = face[i];
      const b = face[(i + 1) % face.length];
      if (a === b) continue;
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      const c = (count.get(k) ?? 0) + 1;
      count.set(k, c);
      if (c === 1) dir.set(k, [a, b]);
    }
  }
  const rim: [number, number][] = [];
  for (const [k, c] of count) if (c === 1) rim.push(dir.get(k)!);
  if (!rim.length) return start;

  // One bottom vertex per rim vertex, made on demand so a vertex shared by two
  // rim edges is dropped once rather than twice.
  const under = new Map<number, number>();
  const low = (i: number): number => {
    const hit = under.get(i);
    if (hit !== undefined) return hit;
    const [x, y, z] = verts[i];
    verts.push([x, y, z - depth]);
    under.set(i, verts.length - 1);
    return verts.length - 1;
  };

  // triangulate() returns its triangles counter-clockwise in world XY whatever
  // the winding of what it was handed (checked against THREE.ShapeUtils, which
  // re-winds internally), and conformToTerrain builds every face through it. So
  // a rim edge walked in its own triangle's direction always has the surface on
  // its left, and the wall raised on its right faces outward — no side test.
  for (const [u, v] of rim) {
    const bu = low(u);
    const bv = low(v);
    faces.push([u, bu, bv], [u, bv, v]);
  }
  if (!cap) return start;

  /* The floor is the top's own triangulation dropped by `depth`, wound the
     other way so its normal points down into the ground.

     It used to be the rim chained into loops and ear-clipped, which is a few
     faces where the top has hundreds — but ear clipping only has the rim to
     work with, so every floor triangle was a flat chord between outline points
     tens of metres apart while the top above it follows the ground. Wherever
     the top sagged below such a chord (a road through a valley, the inside of
     a bend on a slope) the floor came up through it: in a real export, floor
     triangles 37 to 112 m long standing up to 0.8 m proud of the carriageway,
     drawn dark because they face down. Dropping the top instead puts every
     floor point exactly `depth` under the top point above it, so it cannot
     cross the top anywhere.

     It is also closed by construction. The floor's outline is low(u)-low(v)
     for every rim edge — the walls' bottom edges, exactly — holes and pinched
     rims included, with no loops to chain and no outer to tell from a hole. */
  for (let f = 0; f < start; f++) faces.push(faces[f].map(low).reverse());
  return start;
}

/** One buildable piece of geometry: its own vertices, and faces indexing them. */
export type MeshPart = { verts: Vec3[]; faces: number[][] };

/**
 * A tree's trunk and canopy at the LOCAL origin — not at the tree's x/y/z. The
 * IFC writer places each tree individually (see addTree in lib/ifc/writer), the
 * same way a building's profile is local to its own centre; the live viewer
 * builds the identical shapes from the same lib/geo/treeShape helpers, so the
 * exported tree always matches the one on screen.
 *
 * The two parts come back separately rather than appended into one pair of
 * arrays because they are two colours — the viewer draws a brown trunk under a
 * green canopy, and an IfcStyledItem attaches to a whole geometric item, so the
 * file can only say the same thing if it has two items to say it about. Each is
 * a sealed volume on its own, which is what lets the writer state both as
 * solids.
 */
export function treeProxy(t: Pick<Tree, 'h' | 'cr' | 'tr'>): { trunk: MeshPart; canopy: MeshPart } {
  const trunkH = treeTrunkHeight(t.h);
  const canopyH = Math.max(t.h - trunkH, 0.1);
  const m = new THREE.Matrix4();
  const trunk: MeshPart = { verts: [], faces: [] };
  const canopy: MeshPart = { verts: [], faces: [] };
  appendGeometry(treeTrunkGeometry(), m.makeScale(t.tr, t.tr, trunkH), trunk.verts, trunk.faces);
  appendGeometry(
    treeCanopyGeometry(),
    m.makeScale(t.cr, t.cr, canopyH / 2).setPosition(0, 0, trunkH + canopyH / 2),
    canopy.verts,
    canopy.faces,
  );
  return { trunk, canopy };
}
