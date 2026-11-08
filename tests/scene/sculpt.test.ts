import { describe, expect, it } from 'vitest';
import { gridFrom } from '@/lib/geo/grid';
import { groundAt } from '@/lib/geo/voids';
import {
  DEFAULT_BRUSH,
  FOLLOW_TOL,
  type SculptBrush,
  applyShift,
  brushWeights,
  cellSize,
  dab,
  editedCount,
  falloffWeight,
  followGround,
  keepOriginal,
  nearestVertex,
  sanitizeBrush,
  setHeights,
} from '@/lib/scene/sculpt';
import { newXf } from '@/lib/scene/xf';
import { type Grid, type SceneData, type Surface, type Vec3, emptyScene } from '@/lib/types';

/* -------------------------------------------------------------------------
   A 100 m site on a 10 m lattice, flat at 50 m. The projection is a plain
   scale (a thousandth of a degree is a metre), so lattice point (i, j) is at
   (10 i, 10 j) and every number below can be worked out by hand.
   ------------------------------------------------------------------------- */

const N = 10;
const box = { minLat: 0, maxLat: 0.1, minLon: 0, maxLon: 0.1 };
const flat = (): Grid =>
  gridFrom(box, N, new Array((N + 1) ** 2).fill(50), (lo, la) => [lo * 1000, la * 1000]);
const at = (i: number, j: number) => j * (N + 1) + i;
const brush = (b: Partial<SculptBrush>): SculptBrush => ({ ...DEFAULT_BRUSH, ...b });

const sceneOn = (g: Grid): SceneData => {
  const s = emptyScene();
  s.terrain = g;
  s.datumZ = 50;
  return s;
};

describe('the brush', () => {
  it('fades from full at the centre to nothing at the rim', () => {
    expect(falloffWeight(0, 10, 'smooth')).toBe(1);
    expect(falloffWeight(5, 10, 'smooth')).toBeCloseTo(0.5);
    expect(falloffWeight(5, 10, 'linear')).toBeCloseTo(0.5);
    expect(falloffWeight(9.9, 10, 'flat')).toBe(1);
    expect(falloffWeight(10, 10, 'flat')).toBe(0);
    expect(falloffWeight(1, 0, 'flat')).toBe(0);
  });

  it('measures the lattice it is painting on', () => {
    expect(cellSize(flat())).toBeCloseTo(10);
    expect(nearestVertex(flat(), 31, 68)).toBe(at(3, 7));
  });

  it('is the one nearest vertex when narrower than half a cell', () => {
    expect(brushWeights(flat(), 31, 68, 0, 'smooth')).toEqual([{ k: at(3, 7), w: 1 }]);
    expect(brushWeights(flat(), 31, 68, 4.9, 'flat')).toEqual([{ k: at(3, 7), w: 1 }]);
  });

  it('reaches every vertex inside its radius, and none outside', () => {
    const ks = brushWeights(flat(), 50, 50, 10.5, 'flat').map((h) => h.k).sort((a, b) => a - b);
    expect(ks).toEqual([at(5, 4), at(4, 5), at(5, 5), at(6, 5), at(5, 6)].sort((a, b) => a - b));
  });

  it('cleans a brush that came back from somewhere untrusted', () => {
    const b = sanitizeBrush({ mode: 'dig' as never, radius: NaN, strength: 1e9, falloff: 'x' as never, target: Infinity });
    expect(b).toEqual({ ...DEFAULT_BRUSH, strength: 50 });
  });
});

describe('a dab', () => {
  it('raises and lowers the centre by the strength', () => {
    const g = flat();
    const moved = dab(g, 50, 50, brush({ mode: 'raise', radius: 25, strength: 2 }), 0);
    expect(g.verts[at(5, 5)][2]).toBeCloseTo(52);
    // Smooth falloff: half way out is half the lift.
    expect(g.verts[at(5, 4)][2]).toBeGreaterThan(50);
    expect(g.verts[at(5, 4)][2]).toBeLessThan(52);
    expect(moved.every((m) => m.was === 50)).toBe(true);
    dab(g, 50, 50, brush({ mode: 'lower', radius: 25, strength: 2 }), 0);
    expect(g.verts[at(5, 5)][2]).toBeCloseTo(50);
  });

  it('sets a single vertex to a typed elevation exactly', () => {
    const g = flat();
    const moved = dab(g, 31, 68, brush({ mode: 'set', radius: 0, target: 61.25 }), 0);
    expect(moved).toEqual([{ k: at(3, 7), was: 50 }]);
    expect(g.verts[at(3, 7)][2]).toBe(61.25);
    expect(editedCount(g)).toBe(0); // nothing kept the original yet
  });

  it('flattens to the level it is given under a flat falloff', () => {
    const g = flat();
    setHeights(g, [at(5, 5), at(6, 5)], [58, 41]);
    dab(g, 55, 50, brush({ mode: 'flatten', radius: 12, falloff: 'flat' }), 47);
    expect(g.verts[at(5, 5)][2]).toBe(47);
    expect(g.verts[at(6, 5)][2]).toBe(47);
  });

  it('smooths a spike towards its neighbours', () => {
    const g = flat();
    setHeights(g, [at(5, 5)], [60]);
    dab(g, 50, 50, brush({ mode: 'smooth', radius: 0 }), 0);
    expect(g.verts[at(5, 5)][2]).toBe(50);
  });

  it('moves the sampler with the mesh, so drapes see the new ground', () => {
    const g = flat();
    setHeights(g, [at(5, 5)], [60]);
    // Lattice point (5, 5) is at lat = lon = 0.05.
    expect(g.sample(0.05, 0.05)).toBeCloseTo(60);
  });
});

describe('the delivered heights', () => {
  it('are kept once, and edits are counted against them', () => {
    const g = flat();
    keepOriginal(g);
    setHeights(g, [at(1, 1), at(2, 2)], [51, 52]);
    keepOriginal(g); // a second call must not overwrite the originals
    expect(g.z0?.[at(1, 1)]).toBe(50);
    expect(editedCount(g)).toBe(2);
    expect(editedCount(null)).toBe(0);
  });
});

describe('what rests on the ground', () => {
  /** Raise the ground round (50, 50) and hand back what the stroke moved. */
  const stroke = (s: SceneData) => {
    const g = s.terrain!;
    const before = new Map<number, number>();
    for (const m of dab(g, 50, 50, brush({ mode: 'raise', radius: 25, strength: 4 }), 0))
      if (!before.has(m.k)) before.set(m.k, m.was);
    return followGround(s, before);
  };

  const draped = (pts: [number, number][], dz: number): Surface => ({
    verts: pts.map(([x, y]): Vec3 => [x, y, 50 + dz]),
    faces: [[0, 1, 2]],
    name: 'veg',
    type: 'VEGETATION',
    layer: 'vegetation',
  });

  it('carries a draped surface onto the new ground at the same clearance', () => {
    const s = sceneOn(flat());
    const surf = draped([[45, 45], [53, 47], [48, 56]], 0.1);
    const far = draped([[1, 1], [8, 1], [1, 8]], 0.1);
    s.surfaces.push(surf, far);
    const shift = stroke(s);
    applyShift(shift, 1);
    for (const v of surf.verts) expect(v[2]).toBeCloseTo(groundAt(s.terrain!, v[0], v[1])! + 0.1, 9);
    expect(far.verts.every((v) => v[2] === 50.1)).toBe(true);
    expect(shift.surfaces).toEqual([surf]);
  });

  it('leaves a deck standing clear of the ground where it is', () => {
    const s = sceneOn(flat());
    const road: Vec3[] = [[48, 48, 50.3], [52, 48, 50.3], [50, 52, 50.3]];
    const bridge: Vec3[] = [[46, 50, 50 + FOLLOW_TOL + 6], [54, 50, 56 + FOLLOW_TOL], [50, 54, 57]];
    s.roads.push(road, bridge);
    const shift = stroke(s);
    applyShift(shift, 1);
    expect(shift.roads).toBe(true);
    expect(road[0][2]).toBeGreaterThan(50.3);
    expect(bridge.map((v) => v[2])).toEqual([50 + FOLLOW_TOL + 6, 56 + FOLLOW_TOL, 57]);
  });

  it('moves a shared ribbon corner once, not once per face', () => {
    const s = sceneOn(flat());
    const a: Vec3 = [50, 50, 50.3];
    s.roads.push([a, [55, 50, 50.3], [50, 55, 50.3]], [a, [45, 50, 50.3], [50, 45, 50.3]]);
    applyShift(stroke(s), 1);
    expect(a[2]).toBeCloseTo(54.3);
  });

  it('replants trees on the ground and leaves one on a roof', () => {
    const s = sceneOn(flat());
    const tree = (z: number) => ({
      id: `t${z}`, x: 50, y: 50, z, h: 8, cr: 2, tr: 0.2, name: 'T', props: {}, xf: newXf(), src: 'osm' as const,
    });
    const onGround = tree(49.95);
    const onRoof = tree(62);
    s.trees.push(onGround, onRoof);
    applyShift(stroke(s), 1);
    expect(onGround.z).toBeCloseTo(53.95);
    expect(onRoof.z).toBe(62);
  });

  it('comes back exactly when the shift is undone', () => {
    const s = sceneOn(flat());
    const surf = draped([[45, 45], [53, 47], [48, 56]], 0.1);
    s.surfaces.push(surf);
    const was = surf.verts.map((v) => v[2]);
    const shift = stroke(s);
    applyShift(shift, 1);
    applyShift(shift, -1);
    expect(surf.verts.map((v) => v[2])).toEqual(was.map((z) => expect.closeTo(z, 12)));
  });

  it('skips drawn surfaces, which are rebuilt from their recipe instead', () => {
    const s = sceneOn(flat());
    const surf = draped([[45, 45], [53, 47], [48, 56]], 0.1);
    surf.drawn = { ring: [], drape: true, roofZ: null, xf: newXf() };
    s.surfaces.push(surf);
    expect(stroke(s).surfaces).toEqual([]);
  });
});
