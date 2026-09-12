import { differencePolygons } from '@/lib/geo/boolean';
import { triangulate } from '@/lib/geo/mesh';
import { dedupe, ensureCCW, pointInRing, signedArea } from '@/lib/geo/rings';
import type { Vec2, Vec3 } from '@/lib/types';

/* =====================================================================
   Holes through the terrain, and the ground under a footprint.

   A hole — a drawn void, or the footprint of a building set to cut the
   ground — is kept as a ring and cut into the ground only where the ground is
   drawn and written: the viewer's mesh and the IFC faceset. The lattice
   itself stays whole, because it is also what every drape and every elevation
   lookup reads (lib/geo/conform, Grid.sample), and a grid with holes in it
   would leave those with nothing to sample.

   The cut is per terrain triangle, and nearly every triangle takes a fast
   path. One whose box misses every hole is kept by index; one no hole's rim
   crosses lies wholly inside or wholly outside each hole, so a single point
   test settles it. Only the triangles a rim runs through go to the boolean
   layer, which is what keeps a void hundreds of metres across from costing a
   polygon-clipping call on every cell it covers.
   ===================================================================== */

/** Below this a hole is a slip of the pointer, not a hole — and polygon-clipping
 *  given one would be doing a sweep line over nothing. One square centimetre. */
const MIN_VOID = 1e-4;

type Box = [number, number, number, number];
type Mesh = { verts: Vec3[]; faces: number[][] };

const boxOf = (pts: readonly (Vec2 | Vec3)[]): Box => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return [x0, y0, x1, y1];
};

const overlaps = (a: Box, b: Box): boolean =>
  a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/**
 * Boxes bucketed on a uniform grid, so a query touches only what is near it.
 *
 * Both directions of the work here need one. Cutting walks every terrain
 * triangle and asks which holes are near it — a few dozen buildings set to
 * cut, against ninety thousand triangles at the densest lattice, is millions of
 * box tests done flat. The ground-under-a-footprint lookup walks the other way,
 * one footprint against every triangle, once per building.
 */
class BoxGrid {
  private readonly cells = new Map<number, number[]>();

  constructor(
    private readonly boxes: Box[],
    private readonly size: number,
  ) {
    boxes.forEach((b, i) => this.cover(b, (k) => {
      const at = this.cells.get(k);
      if (at) at.push(i);
      else this.cells.set(k, [i]);
    }));
  }

  /** Every cell a box touches, as one integer key. Cell coordinates are well
   *  inside ±2^20 for any site here, so the pair packs without collision. */
  private cover(b: Box, visit: (key: number) => void): void {
    const i0 = Math.floor(b[0] / this.size);
    const i1 = Math.floor(b[2] / this.size);
    const j0 = Math.floor(b[1] / this.size);
    const j1 = Math.floor(b[3] / this.size);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) visit((j + 0x100000) * 0x200000 + (i + 0x100000));
  }

  /** The boxes that actually overlap `b`, each once. */
  query(b: Box): number[] {
    const seen = new Set<number>();
    this.cover(b, (k) => {
      for (const i of this.cells.get(k) ?? []) seen.add(i);
    });
    return [...seen].filter((i) => overlaps(this.boxes[i], b));
  }
}

/** One face index per terrain, built on first use and dropped with the terrain.
 *  Keyed on the faces array, which is what identifies a lattice's triangulation
 *  whether it arrived as a Grid or as a bare vertex/face pair. */
const faceGrids = new WeakMap<number[][], BoxGrid>();

function faceGrid(t: Mesh): BoxGrid {
  let g = faceGrids.get(t.faces);
  if (!g) {
    const boxes = t.faces.map((f) => boxOf(f.map((i) => t.verts[i])));
    // Two triangles to a cell is about right: a query box then covers a handful
    // of cells, and no cell holds more than a few triangles.
    const b0 = boxes[0];
    const size = b0 ? Math.max(b0[2] - b0[0], b0[3] - b0[1], 1) * 2 : 10;
    g = new BoxGrid(boxes, size);
    faceGrids.set(t.faces, g);
  }
  return g;
}

const orient = (a: Vec2, b: Vec2, c: Vec2): number =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/** Whether two segments meet at all — touching counts. Erring toward "they
 *  cross" only sends a triangle down the exact path instead of the fast one. */
const segmentsMeet = (a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean => {
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  return ((d1 >= 0 && d2 <= 0) || (d1 <= 0 && d2 >= 0)) && ((d3 >= 0 && d4 <= 0) || (d3 <= 0 && d4 >= 0));
};

/** Where two segments cross, or null when they do not (parallel included). */
function crossing(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den;
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a[0] + t * rx, a[1] + t * ry];
}

/** Whether any part of the hole's outline touches the triangle's — an edge
 *  crossing one of its sides, or a corner of the hole inside it (a hole small
 *  enough to sit within one cell crosses nothing). */
const rimTouches = (tri: Vec2[], v: Vec2[]): boolean => {
  for (let i = 0; i < v.length; i++) {
    const a = v[i];
    const b = v[(i + 1) % v.length];
    for (let k = 0; k < 3; k++) if (segmentsMeet(a, b, tri[k], tri[(k + 1) % 3])) return true;
  }
  return pointInRing(v[0], tri);
};

/**
 * The terrain with every hole taken out of it, as the vertex/face pair a
 * faceset wants.
 *
 * With nothing to cut, the terrain's own arrays come straight back, so a scene
 * with no holes builds and exports exactly what it did before holes existed.
 *
 * A cut triangle's new corners take their height off that triangle's own
 * plane, which is what puts the rim of the hole exactly on the ground the user
 * sees rather than on a re-sampled approximation of it. A triangle the boolean
 * layer cannot cut is kept whole: a hole that stops a cell short is a smaller
 * failure than a tear in the ground.
 */
export function cutTerrain(terrain: Mesh, rings: Vec2[][]): Mesh {
  const voids = rings
    .map((r) => dedupe(r))
    .filter((r) => r.length >= 3 && Math.abs(signedArea(r)) >= MIN_VOID)
    .map(ensureCCW);
  if (!voids.length) return { verts: terrain.verts, faces: terrain.faces };

  const boxes = voids.map(boxOf);
  const first = terrain.faces[0];
  const cell = first ? boxOf(first.map((i) => terrain.verts[i])) : null;
  const holes = new BoxGrid(boxes, cell ? Math.max(cell[2] - cell[0], cell[3] - cell[1], 1) * 4 : 20);
  const V = terrain.verts;
  const verts: Vec3[] = [];
  const faces: number[][] = [];
  // Lattice vertices are copied in on first use, so a vertex every face around
  // it dropped does not ride into the file as an orphaned IfcCartesianPoint.
  const remap = new Map<number, number>();
  const keep = (i: number): number => {
    let j = remap.get(i);
    if (j === undefined) {
      j = verts.push(V[i]) - 1;
      remap.set(i, j);
    }
    return j;
  };

  for (const f of terrain.faces) {
    const tri3 = f.map((i) => V[i]);
    const tri = tri3.map((p): Vec2 => [p[0], p[1]]);
    const near = holes.query(boxOf(tri)).map((k) => voids[k]);
    if (!near.length) {
      faces.push(f.map(keep));
      continue;
    }

    const cut = near.filter((v) => rimTouches(tri, v));
    if (!cut.length) {
      // No rim runs through it, so it is wholly inside a hole or wholly outside
      // all of them, and its centroid says which.
      const c: Vec2 = [(tri[0][0] + tri[1][0] + tri[2][0]) / 3, (tri[0][1] + tri[1][1] + tri[2][1]) / 3];
      if (!near.some((v) => pointInRing(c, v))) faces.push(f.map(keep));
      continue;
    }

    const pieces = differencePolygons(
      { outer: ensureCCW(tri), holes: [] },
      cut.map((outer) => ({ outer, holes: [] })),
    );
    if (pieces === null) {
      faces.push(f.map(keep));
      continue;
    }

    const zOn = planeOf(tri3);
    for (const pc of pieces) {
      const base = verts.length;
      // triangulate indexes the outer ring followed by each hole in turn — the
      // convention its doc comment in ./mesh sets and conform already relies on.
      for (const p of [pc.outer, ...pc.holes].flat()) verts.push([p[0], p[1], zOn(p)]);
      for (const t of triangulate(pc.outer, pc.holes)) faces.push([base + t[0], base + t[1], base + t[2]]);
    }
  }

  return { verts, faces };
}

/**
 * The lowest the terrain gets anywhere under a ring, or null when the ring is
 * off the lattice altogether.
 *
 * Exact over the surface the viewer draws: the terrain is flat on each
 * triangle, so over a triangle's share of the ring its lowest point is a
 * corner of that share — a ring corner inside the triangle, a triangle corner
 * inside the ring, or a place where their edges cross. Those three are what is
 * sampled, and nothing else can be lower.
 *
 * It is the ground a building set to cut the terrain has its base dropped to,
 * so that none of its underside is left hanging over the hole it makes.
 */
export function minGroundUnder(terrain: Mesh, ring: Vec2[]): number | null {
  const r = dedupe(ring);
  if (r.length < 3) return null;
  const V = terrain.verts;
  let min = Infinity;
  for (const fi of faceGrid(terrain).query(boxOf(r))) {
    const tri3 = terrain.faces[fi].map((i) => V[i]);
    const tri = tri3.map((p): Vec2 => [p[0], p[1]]);
    const zOn = planeOf(tri3);
    for (const p of r) if (pointInRing(p, tri)) min = Math.min(min, zOn(p));
    for (const q of tri3) if (pointInRing([q[0], q[1]], r)) min = Math.min(min, q[2]);
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      for (let k = 0; k < 3; k++) {
        const x = crossing(a, b, tri[k], tri[(k + 1) % 3]);
        if (x) min = Math.min(min, zOn(x));
      }
    }
  }
  return Number.isFinite(min) ? min : null;
}

/** The terrain's height at one local point, off the triangle that holds it, or
 *  null past the lattice's edge. */
export function groundAt(terrain: Mesh, x: number, y: number): number | null {
  const V = terrain.verts;
  for (const fi of faceGrid(terrain).query([x, y, x, y])) {
    const tri3 = terrain.faces[fi].map((i) => V[i]);
    const [a, b, c] = tri3.map((p): Vec2 => [p[0], p[1]]);
    const p: Vec2 = [x, y];
    const d1 = orient(a, b, p);
    const d2 = orient(b, c, p);
    const d3 = orient(c, a, p);
    const inside = (d1 >= -1e-9 && d2 >= -1e-9 && d3 >= -1e-9) || (d1 <= 1e-9 && d2 <= 1e-9 && d3 <= 1e-9);
    if (inside) return planeOf(tri3)(p);
  }
  return null;
}

/** z as a function of x, y over the plane through three points. A triangle
 *  with no area has no plane; its first corner's height is the best answer
 *  there is, and nothing visible depends on it. */
function planeOf([a, b, c]: Vec3[]): (p: Vec2) => number {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  // The plane's normal is u × v; its z component is the triangle's doubled
  // signed area in plan.
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  if (Math.abs(nz) < 1e-12) return () => a[2];
  return (p) => a[2] - (nx * (p[0] - a[0]) + ny * (p[1] - a[1])) / nz;
}
