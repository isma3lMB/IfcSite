import { describe, expect, it } from 'vitest';
import {
  clipPolyline,
  clipToBox,
  clipToConvex,
  collapseNear,
  dedupe,
  densify,
  ensureCCW,
  pointInRing,
  ringCentre,
  signedArea,
} from '@/lib/geo/rings';
import type { Vec2 } from '@/lib/types';

/** The unit square, counter-clockwise, unclosed — the shape most of this takes. */
const CCW: Vec2[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
const CW: Vec2[] = [...CCW].reverse();

/** Sum of edge lengths, closed or open, for the densify invariants. */
const length = (pts: Vec2[], closed = false): number => {
  let s = 0;
  const last = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return s;
};

const longestEdge = (pts: Vec2[], closed = false): number => {
  let m = 0;
  const last = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    m = Math.max(m, Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return m;
};

describe('dedupe', () => {
  it('leaves a clean ring alone', () => {
    expect(dedupe(CCW)).toEqual(CCW);
  });

  it('drops consecutive duplicates', () => {
    expect(
      dedupe([
        [0, 0],
        [0, 0],
        [1, 0],
        [1, 0],
        [1, 1],
      ]),
    ).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
  });

  it('drops the closing repeat of the first vertex', () => {
    expect(dedupe([...CCW, [0, 0]])).toEqual(CCW);
  });

  it('treats a difference below 1e-9 as a duplicate, and one above as real', () => {
    expect(dedupe([[0, 0], [1e-12, 1e-12], [1, 0]])).toHaveLength(2);
    expect(dedupe([[0, 0], [1e-6, 0], [1, 0]])).toHaveLength(3);
  });

  it('survives the degenerate inputs', () => {
    expect(dedupe([])).toEqual([]);
    expect(dedupe([[3, 4]])).toEqual([[3, 4]]);
    expect(
      dedupe([
        [3, 4],
        [3, 4],
      ]),
    ).toEqual([[3, 4]]);
  });
});

describe('collapseNear', () => {
  it('drops a vertex closer to its predecessor than the tolerance', () => {
    const run: Vec2[] = [
      [0, 0],
      [0.02, 0],
      [40, 0],
    ];
    expect(collapseNear(run, 1)).toEqual([
      [0, 0],
      [40, 0],
    ]);
  });

  /** Both ends are where the run meets the site boundary or another run. */
  it('keeps both endpoints exactly', () => {
    const run: Vec2[] = [
      [0, 0],
      [40, 0],
      [40.02, 0],
    ];
    const out = collapseNear(run, 1);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([40.02, 0]);
  });

  it('lets a dropped last point replace its predecessor rather than vanish', () => {
    const out = collapseNear(
      [
        [0, 0],
        [40, 0],
        [40.02, 0],
      ],
      1,
    );
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual([40.02, 0]);
  });

  /**
   * Collinear vertices are drape stations: removing them is simplification, a
   * different operation, and it lets the surface cut through a hill.
   */
  it('keeps collinear vertices that are far enough apart', () => {
    const run: Vec2[] = [
      [0, 0],
      [10, 0],
      [20, 0],
      [30, 0],
    ];
    expect(collapseNear(run, 1)).toEqual(run);
  });

  it('reduces a run entirely inside the tolerance to its two ends', () => {
    const out = collapseNear(
      [
        [0, 0],
        [0.1, 0],
        [0.2, 0],
      ],
      10,
    );
    expect(out).toEqual([
      [0, 0],
      [0.2, 0],
    ]);
  });

  it('reduces a run whose ends coincide to a single point, for the caller to drop', () => {
    const out = collapseNear(
      [
        [0, 0],
        [0.1, 0],
        [0, 0],
      ],
      10,
    );
    expect(out).toEqual([[0, 0]]);
  });

  it('is a no-op for a non-positive tolerance or too few points', () => {
    const run: Vec2[] = [
      [0, 0],
      [0.001, 0],
    ];
    expect(collapseNear(run, 0)).toBe(run);
    expect(collapseNear(run, -1)).toBe(run);
    expect(collapseNear([[0, 0]], 5)).toEqual([[0, 0]]);
  });
});

describe('signedArea', () => {
  it('is positive counter-clockwise and negative clockwise', () => {
    expect(signedArea(CCW)).toBeCloseTo(1, 12);
    expect(signedArea(CW)).toBeCloseTo(-1, 12);
  });

  it('does not care whether the ring is written closed', () => {
    expect(signedArea([...CCW, [0, 0]])).toBeCloseTo(signedArea(CCW), 12);
  });

  it('is zero for a degenerate ring', () => {
    expect(
      signedArea([
        [0, 0],
        [1, 1],
        [2, 2],
      ]),
    ).toBeCloseTo(0, 12);
  });
});

describe('ensureCCW', () => {
  /** IFC profiles need CCW outer curves; skip this and half the buildings invert. */
  it('flips a clockwise ring', () => {
    const out = ensureCCW(CW);
    expect(signedArea(out)).toBeGreaterThan(0);
    expect(out).toEqual(CCW);
  });

  it('returns a counter-clockwise ring as-is, by reference', () => {
    expect(ensureCCW(CCW)).toBe(CCW);
  });

  it('is idempotent', () => {
    expect(ensureCCW(ensureCCW(CW))).toEqual(ensureCCW(CW));
  });

  it('does not mutate its input', () => {
    const input = [...CW];
    ensureCCW(input);
    expect(input).toEqual(CW);
  });
});

describe('clipToBox', () => {
  it('leaves a ring wholly inside the box alone', () => {
    const out = clipToBox(CCW, -1, -1, 2, 2);
    expect(signedArea(out)).toBeCloseTo(1, 12);
  });

  it('empties a ring wholly outside the box', () => {
    expect(clipToBox(CCW, 10, 10, 20, 20)).toEqual([]);
  });

  it('cuts a ring straddling one edge down to the overlap', () => {
    const out = clipToBox(CCW, -1, -1, 0.5, 2);
    expect(Math.abs(signedArea(out))).toBeCloseTo(0.5, 12);
    for (const [x] of out) expect(x).toBeLessThanOrEqual(0.5 + 1e-12);
  });

  it('cuts a ring overhanging a corner down to the overlap', () => {
    const out = clipToBox(CCW, 0.5, 0.5, 2, 2);
    expect(Math.abs(signedArea(out))).toBeCloseTo(0.25, 12);
  });

  it('clips a large ring down to the box exactly', () => {
    const big: Vec2[] = [
      [-100, -100],
      [100, -100],
      [100, 100],
      [-100, 100],
    ];
    const out = clipToBox(big, 0, 0, 3, 5);
    expect(Math.abs(signedArea(out))).toBeCloseTo(15, 9);
  });

  /** On-the-line counts as inside, so a shared edge is not lost to rounding. */
  it('keeps a ring whose edge lies exactly on the boundary', () => {
    const out = clipToBox(CCW, 0, 0, 1, 1);
    expect(Math.abs(signedArea(out))).toBeCloseTo(1, 12);
  });

  it('preserves winding', () => {
    expect(signedArea(clipToBox(CCW, -1, -1, 0.5, 2))).toBeGreaterThan(0);
    expect(signedArea(clipToBox(CW, -1, -1, 0.5, 2))).toBeLessThan(0);
  });

  it('never puts a vertex outside the box', () => {
    const star: Vec2[] = [
      [-2, 0.5],
      [0.5, -2],
      [3, 0.5],
      [0.5, 3],
    ];
    for (const [x, y] of clipToBox(star, 0, 0, 1, 1)) {
      expect(x).toBeGreaterThanOrEqual(-1e-12);
      expect(x).toBeLessThanOrEqual(1 + 1e-12);
      expect(y).toBeGreaterThanOrEqual(-1e-12);
      expect(y).toBeLessThanOrEqual(1 + 1e-12);
    }
  });
});

describe('clipPolyline', () => {
  const line: Vec2[] = [
    [-1, 0.5],
    [2, 0.5],
  ];

  it('cuts a crossing line to the span inside the box', () => {
    const runs = clipPolyline(line, 0, 0, 1, 1);
    expect(runs).toHaveLength(1);
    expect(runs[0][0][0]).toBeCloseTo(0, 12);
    expect(runs[0][runs[0].length - 1][0]).toBeCloseTo(1, 12);
  });

  it('drops a line that misses the box entirely', () => {
    expect(
      clipPolyline(
        [
          [-5, -5],
          [-4, -4],
        ],
        0,
        0,
        1,
        1,
      ),
    ).toEqual([]);
  });

  it('leaves a line wholly inside alone', () => {
    const inside: Vec2[] = [
      [0.1, 0.1],
      [0.5, 0.5],
      [0.9, 0.2],
    ];
    const runs = clipPolyline(inside, 0, 0, 1, 1);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(3);
  });

  /** A way that leaves and comes back is two roads as far as the site knows. */
  it('splits a line that exits and re-enters into separate runs', () => {
    const out: Vec2[] = [
      [0.2, 0.5],
      [0.2, 5],
      [0.8, 5],
      [0.8, 0.5],
    ];
    expect(clipPolyline(out, 0, 0, 1, 1)).toHaveLength(2);
  });

  /**
   * The reason a polygon clipper cannot do this job: Sutherland-Hodgman
   * reconnects the last vertex to the first, giving a centreline a phantom
   * closing segment.
   */
  it('does not close the run back onto its own start', () => {
    const bent: Vec2[] = [
      [0.1, 0.1],
      [0.9, 0.1],
      [0.9, 0.9],
    ];
    const runs = clipPolyline(bent, 0, 0, 1, 1);
    expect(runs[0][0]).not.toEqual(runs[0][runs[0].length - 1]);
  });

  it('never emits a single-point run', () => {
    for (const run of clipPolyline(line, 0, 0, 1, 1)) expect(run.length).toBeGreaterThan(1);
  });

  /**
   * A line grazing one corner touches the box at a single point. The clipper
   * emits it as a two-point run of one repeated coordinate rather than dropping
   * it — the "runs of a single point are dropped" rule is by length, not by
   * geometry. Harmless downstream (collapseNear folds it back to one point and
   * the caller drops it) and pinned here so a change to it is a decision rather
   * than a surprise.
   */
  it('emits a corner graze as a zero-length run', () => {
    const runs = clipPolyline(
      [
        [-1, 1],
        [1, -1],
      ],
      0,
      0,
      1,
      1,
    );
    for (const run of runs) {
      expect(length(run)).toBeCloseTo(0, 12);
      for (const p of run) expect(p).toEqual([0, 0]);
    }
  });

  it('keeps a segment running along an edge of the box', () => {
    const runs = clipPolyline(
      [
        [-1, 0],
        [2, 0],
      ],
      0,
      0,
      1,
      1,
    );
    expect(runs).toHaveLength(1);
  });
});

describe('clipToConvex', () => {
  /** A terrain triangle, counter-clockwise — the window lib/geo/conform passes. */
  const TRI: Vec2[] = [
    [0, 0],
    [4, 0],
    [0, 4],
  ];

  it('leaves a subject wholly inside the window alone', () => {
    const small: Vec2[] = [
      [0.5, 0.5],
      [1, 0.5],
      [0.5, 1],
    ];
    expect(Math.abs(signedArea(clipToConvex(small, TRI)))).toBeCloseTo(
      Math.abs(signedArea(small)),
      12,
    );
  });

  it('empties a subject wholly outside it', () => {
    const far: Vec2[] = [
      [10, 10],
      [11, 10],
      [10, 11],
    ];
    expect(clipToConvex(far, TRI)).toEqual([]);
  });

  it('cuts a square down to the triangle it overlaps', () => {
    const square: Vec2[] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ];
    expect(Math.abs(signedArea(clipToConvex(square, TRI)))).toBeCloseTo(8, 9);
  });

  /**
   * A convex subject cannot be severed, so it comes back as one convex piece
   * and is exact by construction. This is the guarantee lib/geo/conform stays
   * inside deliberately, by triangulating a region and cutting the triangles
   * rather than cutting the region and triangulating the result.
   */
  it('is exact in area for a convex subject', () => {
    // The square's far corner pokes through the hypotenuse; what is left is the
    // right triangle on (1,1), (3,1), (1,3).
    const square: Vec2[] = [
      [1, 1],
      [3, 1],
      [3, 3],
      [1, 3],
    ];
    expect(Math.abs(signedArea(clipToConvex(square, TRI)))).toBeCloseTo(2, 12);
  });

  it('agrees with clipToBox when the window is that box', () => {
    const box: Vec2[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const subject: Vec2[] = [
      [-1, -1],
      [2, 0.5],
      [0.5, 2],
    ];
    expect(Math.abs(signedArea(clipToConvex(subject, box)))).toBeCloseTo(
      Math.abs(signedArea(clipToBox(subject, 0, 0, 1, 1))),
      9,
    );
  });

  /**
   * The documented precondition, pinned as a caveat rather than as a promise: a
   * subject the window severs comes back as ONE self-overlapping ring. Its
   * component count is unrecoverable, and because the connectors here run along
   * two different edges of the window rather than one clip line, its signed area
   * is not the area of what survived either — 3.18 against a true 2.42.
   *
   * Ear clipping copes with this in practice, which is why lib/geo/conform can
   * use it. What a caller must NOT do is read the area or the piece count off
   * this ring, and that is what this test exists to record.
   */
  it('returns one self-overlapping ring for a subject the window severs', () => {
    // Two prongs reaching down into the triangle, joined by a bar at y >= 4.5
    // that lies wholly outside it — so what survives is two disjoint pieces.
    const comb: Vec2[] = [
      [0.2, 0.2],
      [0.8, 0.2],
      [0.8, 4.5],
      [1.5, 4.5],
      [1.5, 0.2],
      [2.1, 0.2],
      [2.1, 5],
      [0.2, 5],
    ];
    const out = clipToConvex(comb, TRI);

    // Every vertex is inside the window: the geometry is sound, the topology is
    // what was lost.
    for (const [x, y] of out) {
      expect(x).toBeGreaterThanOrEqual(-1e-12);
      expect(y).toBeGreaterThanOrEqual(-1e-12);
      expect(x + y).toBeLessThanOrEqual(4 + 1e-12);
    }

    // Both prongs made it through, joined into the one ring.
    expect(out.some(([x]) => x < 0.9)).toBe(true);
    expect(out.some(([x]) => x > 1.4)).toBe(true);
    expect(Math.abs(signedArea(out))).not.toBeCloseTo(2.42, 6);
  });
});

describe('densify', () => {
  const long: Vec2[] = [
    [0, 0],
    [200, 0],
  ];

  it('splits an edge longer than the cap', () => {
    const out = densify(long, 50);
    expect(out).toHaveLength(5);
    expect(longestEdge(out)).toBeLessThanOrEqual(50 + 1e-9);
  });

  it('leaves an edge already short enough alone', () => {
    const short: Vec2[] = [
      [0, 0],
      [10, 0],
    ];
    expect(densify(short, 50)).toEqual(short);
  });

  it('keeps the endpoints and the total length', () => {
    const out = densify(long, 30);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([200, 0]);
    expect(length(out)).toBeCloseTo(length(long), 9);
  });

  it('puts the new vertices on the original line', () => {
    const diag: Vec2[] = [
      [0, 0],
      [100, 100],
    ];
    for (const [x, y] of densify(diag, 10)) expect(x).toBeCloseTo(y, 9);
  });

  it('densifies the closing edge too when told the ring is closed', () => {
    const ring: Vec2[] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    const open = densify(ring, 25);
    const closed = densify(ring, 25, true);
    expect(longestEdge(closed, true)).toBeLessThanOrEqual(25 + 1e-9);
    // The open form never emits the wrap-around edge, so it is shorter by that
    // edge's worth of inserted vertices.
    expect(closed.length).toBeGreaterThan(open.length);
  });

  it('does not repeat the first vertex when closed', () => {
    const ring: Vec2[] = [
      [0, 0],
      [100, 0],
      [100, 100],
    ];
    const out = densify(ring, 25, true);
    expect(out[out.length - 1]).not.toEqual(out[0]);
  });

  it('is a no-op for degenerate input', () => {
    expect(densify([[1, 2]], 10)).toEqual([[1, 2]]);
    expect(densify(long, 0)).toBe(long);
    expect(densify(long, -5)).toBe(long);
  });

  /** The cap is a safety valve, not a target — but it must actually hold. */
  it('stops inserting rather than growing without bound', () => {
    const huge: Vec2[] = [
      [0, 0],
      [1e7, 0],
    ];
    expect(densify(huge, 1).length).toBeLessThan(5000);
  });
});

describe('ringCentre', () => {
  it('is the vertex mean', () => {
    expect(ringCentre(CCW)).toEqual([0.5, 0.5]);
  });

  it('follows the vertices rather than the area', () => {
    // Three vertices bunched left, one right: the vertex mean sits left of the
    // area centroid, which is what the original did and what callers expect.
    const skewed: Vec2[] = [
      [0, 0],
      [0, 1],
      [0, 2],
      [6, 1],
    ];
    expect(ringCentre(skewed)[0]).toBeCloseTo(1.5, 12);
  });
});

describe('pointInRing', () => {
  it('is true inside and false outside', () => {
    expect(pointInRing([0.5, 0.5], CCW)).toBe(true);
    expect(pointInRing([5, 5], CCW)).toBe(false);
    expect(pointInRing([-0.001, 0.5], CCW)).toBe(false);
  });

  /** Winding-agnostic on purpose: a hole is wound against its outer ring. */
  it('gives the same answer for either winding', () => {
    expect(pointInRing([0.5, 0.5], CW)).toBe(true);
    expect(pointInRing([5, 5], CW)).toBe(false);
  });

  it('is false in the notch of a concave ring', () => {
    const ell: Vec2[] = [
      [0, 0],
      [4, 0],
      [4, 1],
      [1, 1],
      [1, 4],
      [0, 4],
    ];
    expect(pointInRing([0.5, 0.5], ell)).toBe(true);
    expect(pointInRing([3, 3], ell)).toBe(false);
  });

  it('is false in the hole of a ring wound against its outer', () => {
    const hole: Vec2[] = [
      [1, 1],
      [1, 2],
      [2, 2],
      [2, 1],
    ];
    expect(pointInRing([1.5, 1.5], hole)).toBe(true);
    expect(pointInRing([0.5, 0.5], hole)).toBe(false);
  });
});
