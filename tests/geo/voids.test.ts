import { describe, expect, it } from 'vitest';
import { gridFaces } from '@/lib/geo/grid';
import { cutTerrain, groundAt, minGroundUnder } from '@/lib/geo/voids';
import type { Vec2, Vec3 } from '@/lib/types';

/* -------------------------------------------------------------------------
   A terrain the size of a small site: 10 × 10 cells of 10 m, centred on the
   origin, on an inclined plane so that "the rim sits on the ground" is a claim
   about z and not only about xy. Faces come from the real gridFaces, so the
   fixture is triangulated the way the DEM providers triangulate.
   ------------------------------------------------------------------------- */

const N = 10;
const CELL = 10;
const zAt = (x: number, y: number): number => 100 + 0.2 * x - 0.1 * y;

const terrain = (() => {
  const verts: Vec3[] = [];
  for (let j = 0; j <= N; j++)
    for (let i = 0; i <= N; i++) {
      const x = -50 + i * CELL;
      const y = -50 + j * CELL;
      verts.push([x, y, zAt(x, y)]);
    }
  return { verts, faces: gridFaces(N) };
})();

const square = (cx: number, cy: number, half: number): Vec2[] => [
  [cx - half, cy - half],
  [cx + half, cy - half],
  [cx + half, cy + half],
  [cx - half, cy + half],
];

/** Plan area of a faceset, each triangle counted by its absolute area. */
const planArea = (m: { verts: Vec3[]; faces: number[][] }): number =>
  m.faces.reduce((sum, [a, b, c]) => {
    const [p, q, r] = [m.verts[a], m.verts[b], m.verts[c]];
    return sum + Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) / 2;
  }, 0);

/** Whether any triangle of a faceset covers a point in plan. */
const covers = (m: { verts: Vec3[]; faces: number[][] }, x: number, y: number): boolean =>
  m.faces.some(([a, b, c]) => {
    const [p, q, r] = [m.verts[a], m.verts[b], m.verts[c]];
    const s = (u: Vec3, v: Vec3) => (v[0] - u[0]) * (y - u[1]) - (v[1] - u[1]) * (x - u[0]);
    const d1 = s(p, q);
    const d2 = s(q, r);
    const d3 = s(r, p);
    return (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
  });

const TOTAL = (N * CELL) ** 2;

describe('cutTerrain', () => {
  /* The contract the viewer and the emitter both lean on: a scene with no voids
     builds and exports exactly what it did before voids existed. */
  it('hands the lattice back untouched when there is nothing to cut', () => {
    const out = cutTerrain(terrain, []);
    expect(out.verts).toBe(terrain.verts);
    expect(out.faces).toBe(terrain.faces);
  });

  it('ignores a void too small to be one', () => {
    const out = cutTerrain(terrain, [square(0, 0, 0.001)]);
    expect(out.faces).toBe(terrain.faces);
  });

  it('takes exactly the void’s area out of the ground', () => {
    const out = cutTerrain(terrain, [square(3, -7, 17)]);
    expect(planArea(out)).toBeCloseTo(TOTAL - 34 * 34, 6);
  });

  it('leaves no ground inside the void and all of it outside', () => {
    const out = cutTerrain(terrain, [square(3, -7, 17)]);
    expect(covers(out, 3, -7)).toBe(false);
    expect(covers(out, 3 + 16, -7 + 16)).toBe(false);
    expect(covers(out, 3 + 18, -7)).toBe(true);
    expect(covers(out, -45, 45)).toBe(true);
  });

  /* The rim is cut on each terrain triangle's own plane, so it lies on the
     ground the user sees rather than on a re-sampled approximation of it. On an
     inclined plane every vertex, old or new, must satisfy the plane. */
  it('puts every vertex of the cut on the terrain', () => {
    const out = cutTerrain(terrain, [square(3, -7, 17), [[20, 20], [38, 24], [26, 41]]]);
    for (const v of out.verts) expect(v[2]).toBeCloseTo(zAt(v[0], v[1]), 9);
  });

  /* The case with no edge crossing anything: a void inside one cell. Only the
     corner-inside test can find it. */
  it('cuts a void that sits wholly inside a single triangle', () => {
    const tiny = square(-46, -46, 1);
    const out = cutTerrain(terrain, [tiny]);
    expect(covers(out, -46, -46)).toBe(false);
    expect(planArea(out)).toBeCloseTo(TOTAL - 4, 6);
  });

  it('takes the union of overlapping voids, not their sum', () => {
    const out = cutTerrain(terrain, [square(-5, 0, 10), square(5, 0, 10)]);
    // Two 20 m squares overlapping by 10 m make a 30 × 20 region.
    expect(planArea(out)).toBeCloseTo(TOTAL - 30 * 20, 6);
  });

  it('keeps every face index inside the vertex array', () => {
    const out = cutTerrain(terrain, [square(0, 0, 23)]);
    for (const f of out.faces)
      for (const i of f) expect(i >= 0 && i < out.verts.length).toBe(true);
  });

  /* Lattice vertices are copied in on first use, so the corners a void removed
     outright do not ride into the IFC as orphaned points. */
  it('carries no vertex that no face uses', () => {
    const out = cutTerrain(terrain, [square(0, 0, 23)]);
    const used = new Set(out.faces.flat());
    expect(used.size).toBe(out.verts.length);
  });

  /* The rest of the scene reads the ring in either winding: the viewer draws
     what the pointer clicked, in whatever order it was clicked. */
  it('does not care which way the void is wound', () => {
    const ccw = cutTerrain(terrain, [square(3, -7, 17)]);
    const cw = cutTerrain(terrain, [square(3, -7, 17).slice().reverse()]);
    expect(planArea(cw)).toBeCloseTo(planArea(ccw), 9);
  });
});

describe('groundAt', () => {
  it('reads the terrain plane at any point on the lattice', () => {
    for (const [x, y] of [[0, 0], [12.3, -40.7], [-49.9, 49.9], [33, 7]])
      expect(groundAt(terrain, x, y)).toBeCloseTo(zAt(x, y), 9);
  });

  it('has no answer past the lattice edge', () => {
    expect(groundAt(terrain, 80, 0)).toBeNull();
  });
});

/* The ground a building set to cut drops its base to. On an inclined plane the
   lowest point of any polygon is one of its corners, so the answer is known. */
describe('minGroundUnder', () => {
  it('finds the lowest ground under a footprint', () => {
    const ring = square(10, 5, 8);
    const want = Math.min(...ring.map(([x, y]) => zAt(x, y)));
    expect(minGroundUnder(terrain, ring)).toBeCloseTo(want, 9);
  });

  /* A lattice vertex inside the ring can be the lowest point on a terrain that
     is not a plane — the case corner sampling alone would miss. */
  it('finds a dip that no corner of the footprint stands on', () => {
    const dipped = {
      verts: terrain.verts.map((v): Vec3 => (v[0] === 0 && v[1] === 0 ? [0, 0, 50] : v)),
      faces: terrain.faces,
    };
    expect(minGroundUnder(dipped, square(0, 0, 15))).toBeCloseTo(50, 9);
  });

  it('has no answer for a footprint wholly off the lattice', () => {
    expect(minGroundUnder(terrain, square(500, 500, 5))).toBeNull();
  });
});
