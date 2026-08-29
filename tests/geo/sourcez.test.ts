import { describe, expect, it } from 'vitest';
import { polylineZAt, zLineFrom } from '@/lib/geo/sourcez';
import type { Vec2, Vec3 } from '@/lib/types';

/** The identity projection. These helpers never project anything themselves —
 *  they take toLocal as an argument — so a real proj4 definition here would only
 *  be testing proj4. */
const ident = (lon: number, lat: number): Vec2 => [lon, lat];

describe('zLineFrom', () => {
  it('is null for a 2D ring — the source carries no elevation to use', () => {
    expect(
      zLineFrom(
        [
          [0, 0],
          [10, 0],
        ],
        ident,
      ),
    ).toBeNull();
  });

  it('carries the third ordinate through as Z', () => {
    expect(
      zLineFrom(
        [
          [0, 0, 100],
          [10, 0, 110],
        ],
        ident,
      ),
    ).toEqual([
      [0, 0, 100],
      [10, 0, 110],
    ]);
  });

  it('drops positions with no usable Z rather than defaulting them to zero', () => {
    // A zero would be a real elevation as far as everything downstream can tell,
    // and one of them in the middle of a road is a hole punched to sea level.
    const z = zLineFrom(
      [
        [0, 0, 100],
        [5, 0],
        [10, 0, Number.NaN],
        [15, 0, 130],
      ],
      ident,
    );
    expect(z).toEqual([
      [0, 0, 100],
      [15, 0, 130],
    ]);
  });

  it("drops BD TOPO's -1000 nodata sentinel, which is finite and passes isFinite", () => {
    // The bug this guards: one of these left in put a ribbon corner 1160 m under
    // a site at +160 m and hung a spike off the model down to it.
    const z = zLineFrom(
      [
        [0, 0, 160],
        [5, 0, -1000],
        [10, 0, 170],
      ],
      ident,
    );
    expect(z).toEqual([
      [0, 0, 160],
      [10, 0, 170],
    ]);
  });

  it('is null when every position is the sentinel, so the caller drapes', () => {
    expect(
      zLineFrom(
        [
          [0, 0, -1000],
          [5, 0, -1000],
          [10, 0, -1000],
        ],
        ident,
      ),
    ).toBeNull();
  });

  it('keeps a genuinely negative altitude — the sentinel filter is not "no negatives"', () => {
    // surface_hydrographique really does return -2.3 m near Bordeaux. This is the
    // case that decides the floor is -500 and not 0, and the one that would break
    // first if anyone tightened the band.
    const z = zLineFrom(
      [
        [0, 0, -2.3],
        [10, 0, 1.5],
      ],
      ident,
    );
    expect(z).toEqual([
      [0, 0, -2.3],
      [10, 0, 1.5],
    ]);
  });

  it('is null below two survivors — one point defines no segment', () => {
    expect(zLineFrom([[0, 0, 100], [5, 0]], ident)).toBeNull();
    expect(zLineFrom([], ident)).toBeNull();
  });

  it('projects through the toLocal it is given', () => {
    const shift = (lon: number, lat: number): Vec2 => [lon - 100, lat - 200];
    expect(
      zLineFrom(
        [
          [100, 200, 7],
          [110, 200, 9],
        ],
        shift,
      ),
    ).toEqual([
      [0, 0, 7],
      [10, 0, 9],
    ]);
  });
});

describe('polylineZAt', () => {
  /** A 100 m run climbing from 10 m to 20 m, along the x axis. */
  const RAMP: Vec3[] = [
    [0, 0, 10],
    [100, 0, 20],
  ];

  it('interpolates along the segment', () => {
    const z = polylineZAt([RAMP]);
    expect(z(0, 0)).toBeCloseTo(10);
    expect(z(50, 0)).toBeCloseTo(15);
    expect(z(100, 0)).toBeCloseTo(20);
  });

  it('reads the same offset sideways from the line', () => {
    // The whole reason this is nearest-point and not per-vertex: a carriageway's
    // outline sits half a width off its own centreline, and every point of it
    // still has to get that centreline's elevation.
    const z = polylineZAt([RAMP]);
    expect(z(50, 6)).toBeCloseTo(15);
    expect(z(50, -6)).toBeCloseTo(15);
  });

  it('clamps past either end instead of extrapolating off the road', () => {
    const z = polylineZAt([RAMP]);
    expect(z(-500, 0)).toBeCloseTo(10);
    expect(z(9999, 0)).toBeCloseTo(20);
  });

  it('follows a profile that is not monotonic', () => {
    const hump: Vec3[] = [
      [0, 0, 0],
      [10, 0, 8],
      [20, 0, 0],
    ];
    const z = polylineZAt([hump]);
    expect(z(5, 0)).toBeCloseTo(4);
    expect(z(10, 0)).toBeCloseTo(8);
    expect(z(15, 0)).toBeCloseTo(4);
  });

  it('picks the nearer of two lines crossing at different heights', () => {
    // The bridge case, and the reason drape-off skips the cross-road union: the
    // deck and the road under it overlap in plan, so the answer at a point has
    // to come from whichever centreline that point actually belongs to.
    const under: Vec3[] = [
      [-50, 0, 100],
      [50, 0, 100],
    ];
    const over: Vec3[] = [
      [0, -50, 112],
      [0, 50, 112],
    ];
    const z = polylineZAt([under, over]);
    expect(z(40, 0)).toBeCloseTo(100); // along the lower road, well clear
    expect(z(0, 40)).toBeCloseTo(112); // along the deck, well clear
  });

  it('agrees with itself whatever the bucket grid comes out as', () => {
    // The uniform grid is sized off the segment count, so a long line and a
    // short one take different numbers of cells and different ring searches. A
    // segment two cells away can still beat one in the centre cell, which is
    // what the widening search exists for; a dense line is where a wrong stop
    // condition would show up.
    const dense: Vec3[] = Array.from({ length: 400 }, (_, i): Vec3 => [i, 0, i * 0.5]);
    const z = polylineZAt([dense]);
    for (const x of [0, 1, 37.5, 200, 398.25, 399]) expect(z(x, 3)).toBeCloseTo(x * 0.5);
  });

  it('interpolates across a dropped sentinel rather than diving to it', () => {
    // The two helpers together, which is how the build uses them: the sentinel
    // vertex is gone by the time the sampler sees the line, so the elevation at
    // its position comes from the neighbours either side.
    const line = zLineFrom(
      [
        [0, 0, 100],
        [50, 0, -1000],
        [100, 0, 120],
      ],
      ident,
    );
    expect(line).not.toBeNull();
    const z = polylineZAt([line as Vec3[]]);
    expect(z(50, 0)).toBeCloseTo(110);
    expect(z(50, 4)).toBeCloseTo(110);
  });

  it('is total on an input with no segment at all', () => {
    expect(polylineZAt([])(0, 0)).toBe(0);
    expect(polylineZAt([[[1, 2, 3]]])(0, 0)).toBe(0);
  });
});
