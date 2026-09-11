import { describe, expect, it } from 'vitest';
import { buildDrawn, drawnSurface, placeRing } from '@/lib/scene/drawn';
import { LAYER_DZ, skirtDepth } from '@/lib/scene/stack';
import type { Vec3 } from '@/lib/types';

/* -------------------------------------------------------------------------
   A shape drawn by hand, with no terrain grid under it: a flat datum, or the
   IGN single post — the case every scene without a DEM is. The draped path over
   a real lattice is conformToTerrain's, and is covered where that lives.
   ------------------------------------------------------------------------- */

const corners: Vec3[] = [
  [0, 0, 12],
  [20, 0, 14],
  [20, 10, 15],
  [0, 10, 13],
];

const flat = (z: number) => () => z;

describe('drawnSurface', () => {
  /* Drape off holds the whole skin one rung above the lowest corner — the rule a
     drawn building's base follows — so water comes out level and nothing floats
     over the downhill side. */
  it('holds a shape level at its lowest corner when the drape is off', () => {
    const s = drawnSurface(corners, 'water', {
      drape: false,
      roofZ: null,
      terrain: null,
      toGeo: (x, y) => [x, y],
      sampleZ: flat(0),
    })!;
    const top = 12 + LAYER_DZ.water;
    const bottom = top - skirtDepth('water');
    for (const v of s.verts) {
      expect([top, bottom].some((z) => Math.abs(v[2] - z) < 1e-9)).toBe(true);
    }
    expect(s.verts.some((v) => Math.abs(v[2] - top) < 1e-9)).toBe(true);
    expect(s.props?.z_source).toBe('level');
  });

  /* A shape begun on a roof stays on that roof: draping it would send it down
     through the building onto the ground beneath. */
  it('stays on the roof it was started on, whatever the drape says', () => {
    const s = drawnSurface(corners, 'vegetation', {
      drape: true,
      roofZ: 30,
      terrain: null,
      toGeo: (x, y) => [x, y],
      sampleZ: flat(0),
    })!;
    expect(Math.max(...s.verts.map((v) => v[2]))).toBeCloseTo(30 + LAYER_DZ.vegetation, 9);
  });

  it('drapes onto the sampled ground when asked to and able to', () => {
    const s = drawnSurface(corners, 'roads', {
      drape: true,
      roofZ: null,
      terrain: null,
      toGeo: (x, y) => [x, y],
      sampleZ: flat(7),
    })!;
    expect(Math.max(...s.verts.map((v) => v[2]))).toBeCloseTo(7 + LAYER_DZ.road, 9);
    expect(s.props?.z_source).toBeUndefined();
  });

  /* Without a projection there is no way to look the ground up, so the shape
     is held level rather than draped onto nothing. */
  it('holds the shape level when it has no projection to drape through', () => {
    const s = drawnSurface(corners, 'water', {
      drape: true,
      roofZ: null,
      terrain: null,
      toGeo: null,
      sampleZ: flat(99),
    })!;
    expect(Math.max(...s.verts.map((v) => v[2]))).toBeCloseTo(12 + LAYER_DZ.water, 9);
  });

  /* Closed into a grounded slab the way every fetched layer is (skirtInto), so
     it stacks against them by containment rather than by a hopeful few
     centimetres. A skin alone would be the top triangles and nothing else. */
  it('is a closed slab, not a skin', () => {
    const s = drawnSurface(corners, 'vegetation', {
      drape: false,
      roofZ: null,
      terrain: null,
      toGeo: null,
      sampleZ: flat(0),
    })!;
    // Two top triangles, eight wall triangles for four rim edges, two floor.
    expect(s.faces.length).toBe(12);
  });

  it('carries the layer, the IFC type and the drawn provenance', () => {
    const opts = { drape: false, roofZ: null, terrain: null, toGeo: null, sampleZ: flat(0) };
    expect(drawnSurface(corners, 'water', opts)).toMatchObject({ layer: 'water', type: 'WATER' });
    expect(drawnSurface(corners, 'vegetation', opts)).toMatchObject({
      layer: 'vegetation',
      type: 'VEGETATION',
    });
    expect(drawnSurface(corners, 'roads', opts)).toMatchObject({
      layer: 'roads',
      type: 'USERDEFINED',
      props: { Source: 'drawn' },
    });
  });

  it('refuses fewer than three corners', () => {
    const opts = { drape: false, roofZ: null, terrain: null, toGeo: null, sampleZ: flat(0) };
    expect(drawnSurface(corners.slice(0, 2), 'water', opts)).toBeNull();
  });
});

describe('placeRing', () => {
  const ring: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  const xf = (pos: Vec3, rz: number) => ({ pos, rot: [0, 0, rz] as Vec3, scale: [1, 1, 1] as Vec3, color: null, opacity: 1 });

  it('leaves an unmoved ring where it was drawn', () => {
    expect(placeRing(ring, xf([0, 0, 0], 0))).toEqual(ring);
  });

  /* About the ring's own centre, so a turn spins the shape in place rather than
     swinging it round the site origin. */
  it('turns about the ring’s own centre, then offsets', () => {
    const out = placeRing(ring, xf([100, -20, 0], Math.PI / 2));
    // Centre (5, 5) moves to (105, -15); the corner (0, 0) turns to (10, 0) about it.
    expect(out[0][0]).toBeCloseTo(110, 9);
    expect(out[0][1]).toBeCloseTo(-20, 9);
    const cx = out.reduce((s, p) => s + p[0], 0) / 4;
    const cy = out.reduce((s, p) => s + p[1], 0) / 4;
    expect(cx).toBeCloseTo(105, 9);
    expect(cy).toBeCloseTo(-15, 9);
  });
});

/* Moving a level shape across a slope has to re-measure its lowest corner where
   it landed, not keep the height it was drawn at. */
describe('buildDrawn', () => {
  it('re-levels a moved shape on the ground where it now stands', () => {
    const groundZ = (x: number) => 0.1 * x;
    const spec = {
      ring: [[0, 0], [10, 0], [10, 10], [0, 10]] as [number, number][],
      drape: false,
      roofZ: null,
      xf: { pos: [50, 0, 0] as Vec3, rot: [0, 0, 0] as Vec3, scale: [1, 1, 1] as Vec3, color: null, opacity: 1 },
    };
    const s = buildDrawn(spec, 'water', { terrain: null, toGeo: null, sampleZ: flat(0), groundZ })!;
    // The moved ring spans x 50..60, so its lowest corner stands at 5.
    expect(Math.max(...s.verts.map((v) => v[2]))).toBeCloseTo(5 + LAYER_DZ.water, 9);
    expect(Math.min(...s.verts.map((v) => v[0]))).toBeCloseTo(50, 9);
  });
});
