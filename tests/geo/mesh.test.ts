import { describe, expect, it } from 'vitest';
import { conformToTerrain } from '@/lib/geo/conform';
import { gridFrom } from '@/lib/geo/grid';
import { skirtInto } from '@/lib/geo/mesh';
import type { Vec2, Vec3 } from '@/lib/types';

/* -------------------------------------------------------------------------
   skirtInto under a draped skin on uneven ground. The identity projection
   (lon is x, lat is y) keeps the lattice in metres.
   ------------------------------------------------------------------------- */

const CELL = 4;
const N = 40;
const DEPTH = 0.35;

/** A valley running across the site, on a slope: the shape that put a road's
 *  skirt floor up through the road. */
function valley() {
  const h = (N * CELL) / 2;
  const box = { minLat: -h, maxLat: h, minLon: -h, maxLon: h };
  const zn: number[] = [];
  for (let j = 0; j <= N; j++)
    for (let i = 0; i <= N; i++) {
      const y = -h + j * CELL;
      zn.push(0.0008 * y * y + 0.03 * i * CELL + 0.4 * Math.sin(0.35 * i));
    }
  return gridFrom(box, N, zn, (lo, la) => [lo, la]);
}

/** A road that bends down into the valley and back out. */
function road(): Vec2[] {
  const centre: Vec2[] = [];
  for (let k = 0; k <= 24; k++) {
    const t = k / 24;
    centre.push([-60 + 120 * t, -60 + 120 * t + 25 * Math.sin(t * Math.PI)]);
  }
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  centre.forEach((p, k) => {
    const q = centre[Math.min(k + 1, centre.length - 1)];
    const r = centre[Math.max(k - 1, 0)];
    const dx = q[0] - r[0];
    const dy = q[1] - r[1];
    const l = Math.hypot(dx, dy);
    left.push([p[0] - (dy / l) * 3, p[1] + (dx / l) * 3]);
    right.push([p[0] + (dy / l) * 3, p[1] - (dx / l) * 3]);
  });
  return [...left, ...right.reverse()];
}

/** z of the top skin at an xy, off whichever top face contains it. */
function topZ(verts: Vec3[], top: number[][], p: Vec2): number | null {
  for (const f of top) {
    const [A, B, C] = f.map((k) => verts[k]);
    const d = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
    if (Math.abs(d) < 1e-14) continue;
    const l1 = ((B[1] - C[1]) * (p[0] - C[0]) + (C[0] - B[0]) * (p[1] - C[1])) / d;
    const l2 = ((C[1] - A[1]) * (p[0] - C[0]) + (A[0] - C[0]) * (p[1] - C[1])) / d;
    const l3 = 1 - l1 - l2;
    if (Math.min(l1, l2, l3) > -1e-9) return l1 * A[2] + l2 * B[2] + l3 * C[2];
  }
  return null;
}

describe('skirtInto', () => {
  for (const step of [CELL, 3 * CELL]) {
    describe(`under a road through a valley, drape step ${step} m`, () => {
      const terrain = valley();
      const s = conformToTerrain(road(), terrain, (x, y) => [x, y], terrain.sample, 0.3, [], step);
      const top = s.faces.length;
      skirtInto(s.verts, s.faces, DEPTH);
      const tops = s.faces.slice(0, top);
      const skirt = s.faces.slice(top);

      /* The regression. An ear-clipped floor spans the rim with flat chords
         tens of metres long, and where the road sags below one it comes up
         through the carriageway, drawn dark because it faces down. */
      it('never rises above the road surface', () => {
        let checked = 0;
        for (const f of skirt) {
          const P = f.map((k) => s.verts[k]);
          for (let i = 1; i < 8; i++)
            for (let j = 1; j < 8 - i; j++) {
              const l1 = i / 8;
              const l2 = j / 8;
              const l3 = 1 - l1 - l2;
              const p = [0, 1, 2].map((a) => l1 * P[0][a] + l2 * P[1][a] + l3 * P[2][a]);
              const z = topZ(s.verts, tops, [p[0], p[1]]);
              if (z === null) continue;
              checked++;
              expect(p[2]).toBeLessThanOrEqual(z + 1e-6);
            }
        }
        expect(checked).toBeGreaterThan(100);
      });

      it('floors the solid exactly its depth under the skin', () => {
        // The floor is the last `top` faces, one per top face, reversed.
        const floor = s.faces.slice(s.faces.length - top);
        expect(floor.length).toBe(top);
        floor.forEach((f, i) => {
          // f is tops[i] reversed: [low(t2), low(t1), low(t0)].
          const below = [f[2], f[1], f[0]].map((k) => s.verts[k]);
          tops[i].forEach((k, j) => {
            expect(below[j][0]).toBe(s.verts[k][0]);
            expect(below[j][1]).toBe(s.verts[k][1]);
            expect(below[j][2]).toBeCloseTo(s.verts[k][2] - DEPTH, 9);
          });
        });
      });

      it('closes into a solid', () => {
        const uses = new Map<string, number>();
        for (const f of s.faces)
          f.forEach((a, i) => {
            const b = f[(i + 1) % f.length];
            const k = a < b ? `${a},${b}` : `${b},${a}`;
            uses.set(k, (uses.get(k) ?? 0) + 1);
          });
        expect([...uses.values()].every((u) => u === 2)).toBe(true);
      });
    });
  }
});
