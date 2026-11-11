import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNABLES } from '@/lib/build/tunables';
import { pointInRing } from '@/lib/geo/rings';
import { drawnSurface } from '@/lib/scene/drawn';
import { finishRoads, pushRoadway, sharedEnds, type Ribbon } from '@/lib/scene/push';
import { LAYER_BITE, LAYER_DZ, ladderFor } from '@/lib/scene/stack';
import { emptyScene, type Site, type Vec2, type Vec3 } from '@/lib/types';

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

describe('road and vegetation heights', () => {
  it('reproduces the old fixed ladder at the default heights', () => {
    expect(LAYER_DZ.parcel).toBe(0.05);
    expect(LAYER_DZ.vegetation).toBe(0.1);
    expect(LAYER_DZ.water).toBeCloseTo(0.2, 12);
    expect(LAYER_DZ.road).toBe(0.3);
    expect(LAYER_DZ.railway).toBeCloseTo(0.32, 12);
  });

  it('keeps parcel < vegetation < water < road < railway for any pair', () => {
    for (const [road, vegetation] of [
      [0.1, 0.06],
      [2, 1],
      [0.2, 0.9],
      [1.5, 0.3],
    ]) {
      const l = ladderFor({ road, vegetation });
      expect(l.parcel).toBeLessThan(l.vegetation);
      expect(l.vegetation).toBeLessThan(l.water);
      expect(l.water).toBeLessThan(l.road);
      expect(l.road).toBeLessThan(l.railway);
    }
  });

  /* The road rung the panel sets is where the road's skin lands: its top a
     road height above the ground, its skirt the usual bite below it. */
  it('puts a fetched road its height above the ground', () => {
    const scene = emptyScene();
    scene.layerHeights = { road: 1.2, vegetation: 0.1 };
    const ribbons: Ribbon[] = [];
    pushRoadway(ribbons, a, W, site);
    finishRoads(scene, ribbons, (x, y) => [x, y], () => 5, { ...DEFAULT_TUNABLES });
    const tops = scene.roads.flat().map((p) => p[2]);
    expect(tops.length).toBeGreaterThan(0);
    for (const z of tops) expect(z).toBeCloseTo(6.2, 9);
    const lowest = Math.min(...scene.roadWalls.flat().map((p) => p[2]));
    expect(lowest).toBeCloseTo(5 - LAYER_BITE.road, 9);
  });

  it('puts a drawn surface on the ladder it is handed', () => {
    const corners: Vec3[] = [
      [0, 0, 5],
      [10, 0, 5],
      [10, 10, 5],
      [0, 10, 5],
    ];
    const ladder = ladderFor({ road: 0.3, vegetation: 0.7 });
    const s = drawnSurface(corners, 'vegetation', {
      drape: true,
      roofZ: null,
      terrain: null,
      toGeo: (x, y) => [x, y],
      sampleZ: () => 5,
      ladder,
    })!;
    expect(Math.max(...s.verts.map((v) => v[2]))).toBeCloseTo(5.7, 9);
  });
});
