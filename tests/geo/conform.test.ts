import { describe, expect, it } from 'vitest';
import { conformToTerrain } from '@/lib/geo/conform';
import { gridFrom } from '@/lib/geo/grid';
import { skirtInto } from '@/lib/geo/mesh';
import type { Grid, SiteRect, Vec2, Vec3 } from '@/lib/types';

/* -------------------------------------------------------------------------
   conformToTerrain over a real lattice. The projection is the identity — lon
   is x and lat is y — so a lattice index maps straight onto metres and the
   expected surface can be computed here independently of the module.
   ------------------------------------------------------------------------- */

const CELL = 5;
const DZ = 0.05;

function lattice(n: number): { terrain: Grid; zn: number[]; box: SiteRect } {
  const half = (n * CELL) / 2;
  const box: SiteRect = { minLat: -half, maxLat: half, minLon: -half, maxLon: half };
  // Deliberately non-planar inside every cell and every block: a ridge-and-
  // hollow pattern on a slope, which is what turned the old block cut's clip
  // crossings into creases.
  const zn: number[] = [];
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) zn.push(3 * Math.sin(0.7 * i) * Math.cos(0.9 * j) + 0.2 * i);
  const terrain = gridFrom(box, n, zn, (lo, la) => [lo, la]);
  return { terrain, zn, box };
}

const toGeo = (x: number, y: number): Vec2 => [x, y];

/** A road-like ribbon: two offset polylines with many stations, which is what
 *  makes ear clipping lay long diagonals lengthwise down it. */
function ribbon(from: Vec2, to: Vec2, width: number, stations: number, wiggle = 0): Vec2[] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const L = Math.hypot(dx, dy);
  const nx = (-dy / L) * (width / 2);
  const ny = (dx / L) * (width / 2);
  const centre: Vec2[] = [];
  for (let k = 0; k <= stations; k++) {
    const t = k / stations;
    const w = wiggle * Math.sin(t * Math.PI * 3);
    centre.push([from[0] + dx * t + (-dy / L) * w, from[1] + dy * t + (dx / L) * w]);
  }
  const left = centre.map((p): Vec2 => [p[0] + nx, p[1] + ny]);
  const right = centre.map((p): Vec2 => [p[0] - nx, p[1] - ny]).reverse();
  return [...left, ...right];
}

const centroid = (v: Vec3[], f: number[]): Vec3 => {
  const s: Vec3 = [0, 0, 0];
  for (const k of f) for (let a = 0; a < 3; a++) s[a] += v[k][a] / f.length;
  return s;
};

/** z of a triangulated surface at an xy, off whichever face contains it. */
function surfaceZ(s: { verts: Vec3[]; faces: number[][] }, p: Vec2): number | null {
  for (const f of s.faces) {
    const [A, B, C] = f.map((k) => s.verts[k]);
    const det = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
    if (Math.abs(det) < 1e-12) continue;
    const l1 = ((B[1] - C[1]) * (p[0] - C[0]) + (C[0] - B[0]) * (p[1] - C[1])) / det;
    const l2 = ((C[1] - A[1]) * (p[0] - C[0]) + (A[0] - C[0]) * (p[1] - C[1])) / det;
    const l3 = 1 - l1 - l2;
    if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return l1 * A[2] + l2 * B[2] + l3 * C[2];
  }
  return null;
}

describe('conformToTerrain', () => {
  const N = 48;
  const { terrain, zn, box } = lattice(N);
  const road = ribbon([-90, -70], [80, 60], 6, 30, 8);

  it('lands every face exactly on the drawn terrain when cut on its own triangles', () => {
    const s = conformToTerrain(road, terrain, toGeo, terrain.sample, DZ, [], CELL);
    expect(s.faces.length).toBeGreaterThan(0);
    for (const f of s.faces) {
      const [x, y, z] = centroid(s.verts, f);
      expect(z).toBeCloseTo(terrain.sample(y, x) + DZ, 6);
    }
  });

  /* The regression. A block coarser than a cell used to sample the true ground
     at every point an ear-clip diagonal crossed a block edge, so the surface
     folded along those diagonals — lengthwise creases down a road, spikes on an
     area. Every face inside one half of one block must now share a plane. */
  it('folds only on block edges when the step is coarser than a cell', () => {
    const stride = 3;
    const s = conformToTerrain(road, terrain, toGeo, terrain.sample, DZ, [], stride * CELL);
    expect(s.faces.length).toBeGreaterThan(0);
    const halves = new Map<string, Vec3[]>();
    for (const f of s.faces) {
      const [A, B, C] = f.map((k) => s.verts[k]);
      const [cx, cy] = centroid(s.verts, f);
      const fi = (cx - box.minLon) / CELL;
      const fj = (cy - box.minLat) / CELL;
      const I = Math.floor(fi / stride);
      const J = Math.floor(fj / stride);
      const upper = fi - I * stride + (fj - J * stride) > stride;
      const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
      const v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      const nz = u[0] * v[1] - u[1] * v[0];
      // Unit-z normal: (-dz/dx, -dz/dy, 1), comparable across faces of any size.
      const nrm: Vec3 = [(u[1] * v[2] - u[2] * v[1]) / nz, (u[2] * v[0] - u[0] * v[2]) / nz, 1];
      const key = `${I},${J},${upper}`;
      const seen = halves.get(key);
      if (seen) seen.push(nrm);
      else halves.set(key, [nrm]);
    }
    expect([...halves.values()].some((g) => g.length > 1)).toBe(true);
    for (const g of halves.values())
      for (const nrm of g) {
        expect(nrm[0]).toBeCloseTo(g[0][0], 5);
        expect(nrm[1]).toBeCloseTo(g[0][1], 5);
      }
  });

  /* Coarse blocks are lifted clear of the bumps between their corners, or the
     terrain stands up through the middle of a road. */
  it('never dips below the drawn terrain when the step is coarser than a cell', () => {
    const s = conformToTerrain(road, terrain, toGeo, terrain.sample, DZ, [], 3 * CELL);
    let checked = 0;
    for (const v of terrain.verts) {
      const z = surfaceZ(s, [v[0], v[1]]);
      if (z === null) continue;
      checked++;
      expect(z).toBeGreaterThanOrEqual(v[2] + DZ - 1e-6);
    }
    expect(checked).toBeGreaterThan(10);
  });

  /* Blocks are aligned on the lattice, not on each ring's own bounding box, so
     two layers stacked at the same point approximate the ground identically and
     the centimetre offsets between them still decide which is on top. */
  it('gives overlapping rings the same ground whatever their extents', () => {
    const step = 3 * CELL;
    const a = conformToTerrain(
      [
        [-61, -47],
        [33, -47],
        [33, 29],
        [-61, 29],
      ],
      terrain,
      toGeo,
      terrain.sample,
      DZ,
      [],
      step,
    );
    const b = conformToTerrain(
      [
        [-8, -13],
        [71, -13],
        [71, 64],
        [-8, 64],
      ],
      terrain,
      toGeo,
      terrain.sample,
      DZ,
      [],
      step,
    );
    for (const p of [
      [1.3, 2.7],
      [17.9, -4.4],
      [-3.1, 21.6],
    ] as Vec2[]) {
      const za = surfaceZ(a, p);
      const zb = surfaceZ(b, p);
      expect(za).not.toBeNull();
      expect(zb).not.toBeNull();
      expect(za!).toBeCloseTo(zb!, 6);
    }
  });

  /* A ring filling the whole densest lattice — the merged road network, a
     forest across the site — used to overrun the block budget by its own
     padding and be silently coarsened to stride 2. */
  it('does not coarsen a ring that spans the densest lattice', () => {
    const big = lattice(211);
    const h = (211 * CELL) / 2;
    const s = conformToTerrain(
      [
        [-h, -h],
        [h, -h],
        [h, h],
        [-h, h],
      ],
      big.terrain,
      toGeo,
      big.terrain.sample,
      DZ,
      [],
      CELL,
    );
    for (let k = 0; k < s.faces.length; k += 97) {
      const [x, y, z] = centroid(s.verts, s.faces[k]);
      // Looser than the tests above only by the millimetre weld, which on a
      // kilometre-wide lattice moves a corner by float noise; coarsening to
      // stride 2 is off by decimetres to metres.
      expect(z).toBeCloseTo(big.terrain.sample(y, x) + DZ, 4);
    }
  });

  /* A skirted drape is a closed solid: every edge of skin, walls and floor
     shared by exactly two faces. Thin pieces used to be dropped on area alone
     (under a square centimetre), which left notches in the skin that the skirt
     walked through twice — before that changed, nearly half of these rings came
     back open at the exact cut, and a few at the coarse one. Seeded, so the
     rings are the same every run. */
  for (const stride of [1, 3]) {
    it(`closes every skirted ring at ${stride === 1 ? 'the exact cut' : 'a coarse step'}`, () => {
      let seed = 7;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let trial = 0; trial < 60; trial++) {
        const cx = -60 + 120 * rnd();
        const cy = -60 + 120 * rnd();
        const rot = rnd() * 2 * Math.PI;
        const R = 10 + 25 * rnd();
        const m = 8 + Math.floor(rnd() * 30);
        const ring: Vec2[] = [];
        for (let k = 0; k < m; k++) {
          const a = (k / m) * 2 * Math.PI + rot;
          const r = R * (0.7 + 0.3 * rnd());
          ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
        const holes: Vec2[][] =
          rnd() < 0.5
            ? [
                [0, 1, 2, 3]
                  .map((k): Vec2 => {
                    const a = rot + (k * Math.PI) / 2;
                    return [cx + 3 * Math.cos(a), cy + 3 * Math.sin(a)];
                  })
                  .reverse(),
              ]
            : [];
        const s = conformToTerrain(ring, terrain, toGeo, terrain.sample, DZ, holes, stride * CELL);
        skirtInto(s.verts, s.faces, 0.3);
        const uses = new Map<string, number>();
        for (const f of s.faces)
          f.forEach((a, i) => {
            const b = f[(i + 1) % f.length];
            const k = a < b ? `${a},${b}` : `${b},${a}`;
            uses.set(k, (uses.get(k) ?? 0) + 1);
          });
        expect([...uses.values()].every((u) => u === 2)).toBe(true);
      }
    });
  }
});
