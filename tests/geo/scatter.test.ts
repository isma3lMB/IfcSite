import { describe, expect, it } from 'vitest';
import { pointInRing } from '@/lib/geo/rings';
import { ringDist, scatterInRing } from '@/lib/geo/scatter';
import type { Vec2 } from '@/lib/types';

const square = (side: number): Vec2[] => [
  [0, 0],
  [side, 0],
  [side, side],
  [0, side],
];

const minPairDist = (pts: Vec2[]): number => {
  let d = Infinity;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++)
      d = Math.min(d, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
  return d;
};

describe('scatterInRing', () => {
  it('keeps every point inside the ring and clear of its edge', () => {
    const ring = square(40);
    const pts = scatterInRing(ring, { spacing: 5, margin: 2 })!;
    expect(pts.length).toBeGreaterThan(20);
    for (const p of pts) {
      expect(pointInRing(p, ring)).toBe(true);
      expect(ringDist(p, ring)).toBeGreaterThanOrEqual(2 - 1e-9);
    }
  });

  it('spaces a strict grid exactly', () => {
    const pts = scatterInRing(square(50), { spacing: 6 })!;
    expect(minPairDist(pts)).toBeCloseTo(6, 6);
  });

  it('packs roughly one tree per lattice cell', () => {
    const s = 4;
    const pts = scatterInRing(square(100), { spacing: s, margin: 0 })!;
    const cell = (s * s * Math.sqrt(3)) / 2;
    expect(pts.length / ((100 * 100) / cell)).toBeGreaterThan(0.9);
    expect(pts.length / ((100 * 100) / cell)).toBeLessThan(1.1);
  });

  it('jitters without letting neighbours collapse onto each other', () => {
    const pts = scatterInRing(square(50), { spacing: 6, jitter: 0.25, seed: 7 })!;
    expect(minPairDist(pts)).toBeGreaterThan(6 * (1 - 2 * 0.25) - 1e-9);
  });

  it('is deterministic for a given seed', () => {
    const a = scatterInRing(square(30), { spacing: 4, jitter: 0.3, seed: 3 });
    const b = scatterInRing(square(30), { spacing: 4, jitter: 0.3, seed: 3 });
    expect(a).toEqual(b);
  });

  it('lays rows along the longest edge of a rotated strip', () => {
    // A 60 x 4 strip turned 30 degrees: only one row fits, so every point must
    // lie on the strip's centreline.
    const th = Math.PI / 6;
    const rot = ([x, y]: Vec2): Vec2 => [x * Math.cos(th) - y * Math.sin(th), x * Math.sin(th) + y * Math.cos(th)];
    const ring = ([[0, 0], [60, 0], [60, 4], [0, 4]] as Vec2[]).map(rot);
    const pts = scatterInRing(ring, { spacing: 5, margin: 1 })!;
    expect(pts.length).toBeGreaterThanOrEqual(10);
    for (const p of pts) {
      const v = -p[0] * Math.sin(th) + p[1] * Math.cos(th);
      expect(v).toBeCloseTo(2, 6);
    }
  });

  it('still plants one tree in an area narrower than the spacing', () => {
    const pts = scatterInRing(square(3), { spacing: 8, margin: 1 })!;
    expect(pts).toHaveLength(1);
    expect(pts[0][0]).toBeCloseTo(1.5, 1);
    expect(pts[0][1]).toBeCloseTo(1.5, 1);
  });

  it('plants nothing where the margin cannot be met', () => {
    expect(scatterInRing(square(1), { spacing: 8, margin: 2 })).toEqual([]);
  });

  it('respects concave rings', () => {
    // An L: the notch at the top right must stay empty.
    const L: Vec2[] = [
      [0, 0],
      [40, 0],
      [40, 20],
      [20, 20],
      [20, 40],
      [0, 40],
    ];
    const pts = scatterInRing(L, { spacing: 4, margin: 1 })!;
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) expect(p[0] > 20 && p[1] > 20).toBe(false);
  });

  it('refuses rather than truncates past the cap', () => {
    expect(scatterInRing(square(1000), { spacing: 2, max: 500 })).toBeNull();
    expect(scatterInRing(square(30), { spacing: 5, max: 1000 })).not.toBeNull();
  });

  it('returns nothing for a degenerate ring', () => {
    expect(scatterInRing([[0, 0], [1, 1]], { spacing: 5 })).toEqual([]);
  });
});
