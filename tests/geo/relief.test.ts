import { describe, expect, it } from 'vitest';
import {
  contourSegments,
  elevationRange,
  heatColor,
  HEAT_STOPS,
  MAJOR_EVERY,
  niceInterval,
} from '@/lib/geo/relief';
import type { Vec3 } from '@/lib/types';

/* One right triangle rising along x: z = x. */
const ramp = {
  verts: [
    [0, 0, 0],
    [10, 0, 10],
    [0, 10, 0],
  ] as Vec3[],
  faces: [[0, 1, 2]],
};

describe('elevationRange', () => {
  it('finds the extremes and is null for nothing', () => {
    expect(elevationRange(ramp.verts)).toEqual({ min: 0, max: 10 });
    expect(elevationRange([])).toBeNull();
  });
});

describe('niceInterval', () => {
  it('is a round number giving about the target count', () => {
    expect(niceInterval(25)).toBe(1);
    expect(niceInterval(100)).toBe(5);
    expect(niceInterval(10)).toBe(0.5);
    expect(niceInterval(1000)).toBe(50);
  });
  it('survives a flat site', () => {
    expect(niceInterval(0)).toBe(1);
    expect(niceInterval(NaN)).toBe(1);
  });
});

describe('contourSegments', () => {
  it('cuts a ramp at each whole level, at the right place', () => {
    const c = contourSegments(ramp, 2);
    // levels 2,4,6,8 cross the triangle; 0 and 10 only touch it at corners/edge.
    const all = [...c.minor, ...c.major];
    expect(all.length / 6).toBe(4);
    for (let i = 0; i < all.length; i += 3) expect(all[i]).toBeCloseTo(all[i + 2], 9); // z = x
  });

  it('puts every MAJOR_EVERYth level in the heavy set', () => {
    const c = contourSegments(ramp, 1);
    const levels = (a: number[]) => new Set(a.filter((_, i) => i % 3 === 2));
    expect([...levels(c.major)]).toEqual([MAJOR_EVERY]);
    expect(levels(c.minor).has(MAJOR_EVERY)).toBe(false);
  });

  it('leaves a flat triangle and a non-positive interval alone', () => {
    const flat = { verts: [[0, 0, 3], [1, 0, 3], [0, 1, 3]] as Vec3[], faces: [[0, 1, 2]] };
    expect(contourSegments(flat, 1).minor).toHaveLength(0);
    expect(contourSegments(ramp, 0).minor).toHaveLength(0);
  });

  it('does not double a level that runs through a shared vertex', () => {
    // Two triangles meeting along the edge through z = 5.
    const m = {
      verts: [
        [0, 0, 0],
        [10, 0, 5],
        [0, 10, 5],
        [10, 10, 10],
      ] as Vec3[],
      faces: [
        [0, 1, 2],
        [1, 3, 2],
      ],
    };
    const c = contourSegments(m, 5);
    // The level lies along the shared edge: exactly one of the two triangles
    // sees it as a crossing.
    expect((c.major.length + c.minor.length) / 6).toBe(1);
  });
});

describe('heatColor', () => {
  const hex = (c: [number, number, number]) =>
    (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255);
  it('hits the end stops and clamps outside', () => {
    expect(hex(heatColor(0))).toBe(HEAT_STOPS[0]);
    expect(hex(heatColor(1))).toBe(HEAT_STOPS[HEAT_STOPS.length - 1]);
    expect(hex(heatColor(-5))).toBe(HEAT_STOPS[0]);
    expect(hex(heatColor(9))).toBe(HEAT_STOPS[HEAT_STOPS.length - 1]);
    expect(hex(heatColor(NaN))).toBe(HEAT_STOPS[0]);
  });
});
