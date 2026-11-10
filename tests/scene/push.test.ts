import { describe, expect, it } from 'vitest';
import { pointInRing } from '@/lib/geo/rings';
import { pushRoadway, sharedEnds, type Ribbon } from '@/lib/scene/push';
import type { Site, Vec2 } from '@/lib/types';

/* -------------------------------------------------------------------------
   Ways buffered into carriageways. Two ways meeting end to end at an angle
   used to leave a wedge open on the outside of the turn, down to the
   centreline: each stopped square, and `join` only fills bends inside one way.
   ------------------------------------------------------------------------- */

const site: Site = {
  minLat: 0,
  maxLat: 0,
  minLon: 0,
  maxLon: 0,
  lat: 0,
  lon: 0,
  halfX: 200,
  halfY: 200,
  radius: 200,
};

const W = 6;
const m = W / 2;
const a: Vec2[] = [
  [-40, 0],
  [0, 0],
];
const b: Vec2[] = [
  [0, 0],
  [30, 30],
];

const covered = (ribbons: Ribbon[], p: Vec2): boolean =>
  ribbons.some((r) => pointInRing(p, r.outer) && !r.holes.some((h) => pointInRing(p, h)));

const build = (withCaps: boolean): Ribbon[] => {
  const ribbons: Ribbon[] = [];
  const shared = withCaps ? sharedEnds([a, b]) : undefined;
  pushRoadway(ribbons, a, W, site, null, shared);
  pushRoadway(ribbons, b, W, site, null, shared);
  return ribbons;
};

/** Halfway out across the wedge between the two square ends, on the outside of
 *  the left turn — inside neither quad, inside the true buffer. */
const wedge: Vec2 = [0.8 * m * Math.cos((-67.5 * Math.PI) / 180), 0.8 * m * Math.sin((-67.5 * Math.PI) / 180)];

describe('pushRoadway', () => {
  it('leaves the wedge open without knowing the ends are shared', () => {
    expect(covered(build(false), wedge)).toBe(false);
  });

  it('fills the wedge where two ways share an end', () => {
    expect(covered(build(true), wedge)).toBe(true);
  });

  it('keeps a dead end square', () => {
    const r = build(true);
    expect(covered(r, [-40 - 0.5 * m, 0])).toBe(false);
    expect(covered(r, [30 + 0.4 * m, 30 + 0.4 * m])).toBe(false);
  });

  it('never reaches past half a carriageway from the centreline', () => {
    const dist = (p: Vec2, s: Vec2[]): number => {
      const [[x1, y1], [x2, y2]] = s;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const t = Math.max(0, Math.min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(p[0] - x1 - t * dx, p[1] - y1 - t * dy);
    };
    for (const r of build(true))
      // Micrometres of slack for the union library's own float output.
      for (const p of r.outer) expect(Math.min(dist(p, a), dist(p, b))).toBeLessThanOrEqual(m + 1e-5);
  });

  it('treats a closed way as one bend at its seam, not two shared ends', () => {
    const ring: Vec2[] = [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
      [0, 0],
    ];
    expect(sharedEnds([ring])(ring[0])).toBe(false);
  });
});
