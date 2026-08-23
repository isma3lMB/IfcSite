import { describe, expect, it } from 'vitest';
import {
  M_PER_LAT,
  PAD_MAX,
  PAD_MIN,
  RECT_EPS,
  SERVICE_MAX,
  SITE_MAX,
  SITE_MIN,
  boundsOf,
  clampAxis,
  clampRect,
  containsRect,
  cornersOf,
  mPerLon,
  overlapsRect,
  padMetres,
  padRect,
  rectArea,
  rectCentre,
  rectSize,
  sameRect,
  squareAt,
  subtractRect,
} from '@/lib/geo/rect';
import type { SiteRect } from '@/lib/types';

const PARIS = { lat: 48.8566, lon: 2.3522 };

const r = (minLat: number, maxLat: number, minLon: number, maxLon: number): SiteRect => ({
  minLat,
  maxLat,
  minLon,
  maxLon,
});

/** A plain unit square in degrees, for the arithmetic that does not care where. */
const UNIT = r(0, 1, 0, 1);

describe('mPerLon', () => {
  it('is a full degree of latitude at the equator', () => {
    expect(mPerLon(0)).toBeCloseTo(M_PER_LAT, 6);
  });

  it('halves at 60 degrees, where the cosine is a half', () => {
    expect(mPerLon(60)).toBeCloseTo(M_PER_LAT / 2, 6);
  });

  it('is symmetric about the equator', () => {
    expect(mPerLon(-48.8566)).toBeCloseTo(mPerLon(48.8566), 9);
  });

  it('collapses at the pole', () => {
    expect(mPerLon(90)).toBeCloseTo(0, 6);
  });
});

describe('squareAt', () => {
  it('produces the requested side in metres, both axes', () => {
    const { w, h } = rectSize(squareAt(PARIS.lat, PARIS.lon, 600));
    expect(w).toBeCloseTo(600, 6);
    expect(h).toBeCloseTo(600, 6);
  });

  it('stays square as latitude climbs, despite the meridians converging', () => {
    for (const lat of [0, 45, 60, 70]) {
      const { w, h } = rectSize(squareAt(lat, 12, 800));
      expect(w).toBeCloseTo(800, 4);
      expect(h).toBeCloseTo(800, 4);
    }
  });

  it('centres on the point it was given', () => {
    const c = rectCentre(squareAt(PARIS.lat, PARIS.lon, 600));
    expect(c.lat).toBeCloseTo(PARIS.lat, 12);
    expect(c.lon).toBeCloseTo(PARIS.lon, 12);
  });

  it('defaults to the default side', () => {
    const { h } = rectSize(squareAt(PARIS.lat, PARIS.lon));
    expect(h).toBeCloseTo(600, 6);
  });
});

describe('boundsOf', () => {
  it('normalises whichever way round the two corners were dragged', () => {
    const a = boundsOf({ lat: 1, lng: 4 }, { lat: 3, lng: 2 });
    expect(a).toEqual(r(1, 3, 2, 4));
    expect(boundsOf({ lat: 3, lng: 2 }, { lat: 1, lng: 4 })).toEqual(a);
  });
});

describe('cornersOf', () => {
  const c = cornersOf(UNIT);

  it('runs SW, SE, NE, NW', () => {
    expect(c).toEqual([
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ]);
  });

  /** What a corner drag pivots on: the opposite corner is always (i+2)%4. */
  it('puts every corner diagonally opposite the one two along', () => {
    for (let i = 0; i < 4; i++) {
      const [lat, lon] = c[i];
      const [oLat, oLon] = c[(i + 2) % 4];
      expect(lat).not.toBe(oLat);
      expect(lon).not.toBe(oLon);
    }
  });
});

describe('containment', () => {
  it('contains itself', () => {
    expect(containsRect(UNIT, UNIT)).toBe(true);
    expect(sameRect(UNIT, UNIT)).toBe(true);
  });

  it('contains a rectangle inside it, and not the other way round', () => {
    const inner = r(0.25, 0.75, 0.25, 0.75);
    expect(containsRect(UNIT, inner)).toBe(true);
    expect(containsRect(inner, UNIT)).toBe(false);
    expect(sameRect(UNIT, inner)).toBe(false);
  });

  /**
   * The same rectangle reached through a Leaflet drag, through squareAt and
   * through clampAxis differs in the last bits, so containment carries about a
   * centimetre of slack.
   */
  it('absorbs a difference below RECT_EPS', () => {
    const nudged = r(-RECT_EPS / 2, 1 + RECT_EPS / 2, -RECT_EPS / 2, 1 + RECT_EPS / 2);
    expect(containsRect(UNIT, nudged)).toBe(true);
    expect(sameRect(UNIT, nudged)).toBe(true);
  });

  it('does not absorb a difference well past it', () => {
    expect(containsRect(UNIT, r(-1e-4, 1, 0, 1))).toBe(false);
  });
});

describe('overlapsRect', () => {
  it('is true for a genuine intersection, either way round', () => {
    const other = r(0.5, 1.5, 0.5, 1.5);
    expect(overlapsRect(UNIT, other)).toBe(true);
    expect(overlapsRect(other, UNIT)).toBe(true);
  });

  it('is false for disjoint rectangles', () => {
    expect(overlapsRect(UNIT, r(2, 3, 2, 3))).toBe(false);
  });

  /** Strict comparisons throughout: sharing only an edge is not an overlap. */
  it('is false for rectangles that only touch along an edge', () => {
    expect(overlapsRect(UNIT, r(1, 2, 0, 1))).toBe(false);
    expect(overlapsRect(UNIT, r(0, 1, 1, 2))).toBe(false);
  });
});

describe('rectArea', () => {
  it('is the product of the two spans, in square degrees', () => {
    expect(rectArea(UNIT)).toBeCloseTo(1, 12);
    expect(rectArea(r(0, 0.5, 0, 0.25))).toBeCloseTo(0.125, 12);
  });
});

describe('subtractRect', () => {
  it('is empty when the cached area already covers the request', () => {
    expect(subtractRect(r(0.25, 0.75, 0.25, 0.75), UNIT)).toEqual([]);
    expect(subtractRect(UNIT, UNIT)).toEqual([]);
  });

  it('is the whole request when the two are disjoint', () => {
    expect(subtractRect(UNIT, r(5, 6, 5, 6))).toEqual([UNIT]);
  });

  /**
   * One piece is what the cache reads as worth fetching: the cached area spans
   * the request on an axis, which is the pan-sideways and grow-one-edge case.
   */
  it('leaves one strip when the cached area spans an axis', () => {
    const out = subtractRect(r(0, 1, 0, 2), r(-1, 2, 0, 1));
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(r(0, 1, 1, 2));
  });

  it('leaves one strip when the request grows northward', () => {
    const out = subtractRect(r(0, 2, 0, 1), UNIT);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(r(1, 2, 0, 1));
  });

  it('leaves four pieces when the cached area sits wholly inside the request', () => {
    const out = subtractRect(r(0, 3, 0, 3), r(1, 2, 1, 2));
    expect(out).toHaveLength(4);
    // The strips above and below span the full width; the middle band is split
    // west and east of the hole.
    expect(out).toContainEqual(r(2, 3, 0, 3));
    expect(out).toContainEqual(r(0, 1, 0, 3));
    expect(out).toContainEqual(r(1, 2, 0, 1));
    expect(out).toContainEqual(r(1, 2, 2, 3));
  });

  it('tiles the request exactly, losing and double-counting no area', () => {
    const req = r(0, 3, 0, 3);
    const cached = r(1, 2, 1, 2);
    const covered = subtractRect(req, cached).reduce((s, p) => s + rectArea(p), 0);
    expect(covered).toBeCloseTo(rectArea(req) - rectArea(cached), 12);
  });

  it('does not emit a sliver for an edge that only differs by epsilon', () => {
    expect(subtractRect(UNIT, r(-RECT_EPS / 2, 1 + RECT_EPS / 2, 0, 1))).toEqual([]);
  });
});

describe('padMetres', () => {
  it('is a tenth of the longer side, between the two limits', () => {
    expect(padMetres(squareAt(0, 0, 1000))).toBeCloseTo(100, 6);
  });

  it('floors at PAD_MIN for a small site', () => {
    expect(padMetres(squareAt(0, 0, SITE_MIN))).toBe(PAD_MIN);
  });

  it('ceilings at PAD_MAX for a large one', () => {
    expect(padMetres(squareAt(0, 0, 2000))).toBe(PAD_MAX);
  });
});

describe('padRect', () => {
  it('grows every edge by the margin asked for', () => {
    const site = squareAt(PARIS.lat, PARIS.lon, 600);
    const { w, h } = rectSize(padRect(site, 100));
    expect(w).toBeCloseTo(800, 3);
    expect(h).toBeCloseTo(800, 3);
  });

  it('keeps the centre where it was', () => {
    const site = squareAt(PARIS.lat, PARIS.lon, 600);
    const before = rectCentre(site);
    const after = rectCentre(padRect(site, 100));
    expect(after.lat).toBeCloseTo(before.lat, 12);
    expect(after.lon).toBeCloseTo(before.lon, 12);
  });

  it('walks the margin back rather than pushing a side past the ceiling', () => {
    const site = squareAt(0, 0, SERVICE_MAX - 100);
    const { w, h } = rectSize(padRect(site, 500));
    expect(w).toBeLessThanOrEqual(SERVICE_MAX + 1e-6);
    expect(h).toBeLessThanOrEqual(SERVICE_MAX + 1e-6);
  });

  /** The user drew it, and a cache is not the place to refuse it. */
  it('returns a rectangle already at the ceiling untouched', () => {
    const site = squareAt(0, 0, SERVICE_MAX);
    expect(padRect(site, 100)).toEqual(site);
    const over = squareAt(0, 0, SERVICE_MAX + 500);
    expect(padRect(over, 100)).toEqual(over);
  });

  it('keeps the aspect of what was drawn', () => {
    const wide = r(0, 0.001, 0, 0.01);
    const before = rectSize(wide);
    const after = rectSize(padRect(wide, 50));
    expect(after.w - before.w).toBeCloseTo(after.h - before.h, 6);
  });
});

describe('clampAxis', () => {
  const perDeg = M_PER_LAT;
  const deg = (metres: number): number => metres / perDeg;

  it('leaves an axis already in range alone, and says so', () => {
    const [min, max, clamped] = clampAxis(0, deg(600), perDeg, null);
    expect(clamped).toBe(false);
    expect([min, max]).toEqual([0, deg(600)]);
  });

  it('grows a too-small axis up to SITE_MIN', () => {
    const [min, max, clamped] = clampAxis(0, deg(10), perDeg, null);
    expect(clamped).toBe(true);
    expect((max - min) * perDeg).toBeCloseTo(SITE_MIN, 6);
  });

  it('shrinks a too-large axis down to the ceiling', () => {
    const [min, max, clamped] = clampAxis(0, deg(99999), perDeg, null);
    expect(clamped).toBe(true);
    expect((max - min) * perDeg).toBeCloseTo(SITE_MAX, 6);
  });

  /**
   * The whole point of the anchor: hitting the limit must not drag the corner
   * the user is not holding.
   */
  it('holds the min edge when that is the anchor', () => {
    const [min, max] = clampAxis(5, 5 + deg(10), perDeg, 5);
    expect(min).toBe(5);
    expect((max - min) * perDeg).toBeCloseTo(SITE_MIN, 6);
  });

  it('holds the max edge when that is the anchor', () => {
    const top = 5 + deg(10);
    const [min, max] = clampAxis(5, top, perDeg, top);
    expect(max).toBe(top);
    expect((max - min) * perDeg).toBeCloseTo(SITE_MIN, 6);
  });

  it('grows about the centre with no anchor', () => {
    const [min, max] = clampAxis(0, deg(10), perDeg, null);
    expect((min + max) / 2).toBeCloseTo(deg(5), 12);
  });

  it('takes a raised ceiling as an argument', () => {
    const [min, max, clamped] = clampAxis(0, deg(3000), perDeg, null, 4000);
    expect(clamped).toBe(false);
    expect((max - min) * perDeg).toBeCloseTo(3000, 6);
  });
});

describe('clampRect', () => {
  it('passes a rectangle inside the limits through unclamped', () => {
    const site = squareAt(PARIS.lat, PARIS.lon, 600);
    const { rect, clamped } = clampRect(site);
    expect(clamped).toBe(false);
    expect(sameRect(rect, site)).toBe(true);
  });

  it('reports clamping when either axis had to move', () => {
    const tiny = squareAt(PARIS.lat, PARIS.lon, 10);
    const { rect, clamped } = clampRect(tiny);
    expect(clamped).toBe(true);
    const { w, h } = rectSize(rect);
    expect(w).toBeCloseTo(SITE_MIN, 3);
    expect(h).toBeCloseTo(SITE_MIN, 3);
  });

  it('holds the anchored corner while the opposite one moves', () => {
    const tiny = squareAt(PARIS.lat, PARIS.lon, 10);
    const anchor = { lat: tiny.minLat, lng: tiny.minLon };
    const { rect } = clampRect(tiny, anchor);
    expect(rect.minLat).toBe(tiny.minLat);
    expect(rect.minLon).toBe(tiny.minLon);
    expect(rect.maxLat).toBeGreaterThan(tiny.maxLat);
    expect(rect.maxLon).toBeGreaterThan(tiny.maxLon);
  });

  it('clamps to a raised ceiling when the options panel supplies one', () => {
    const big = squareAt(0, 0, 3000);
    expect(clampRect(big, null, 4000).clamped).toBe(false);
    expect(clampRect(big, null, 2000).clamped).toBe(true);
  });

  it('is idempotent, so clamping a clamped rectangle changes nothing', () => {
    const once = clampRect(squareAt(PARIS.lat, PARIS.lon, 10)).rect;
    const twice = clampRect(once);
    expect(twice.clamped).toBe(false);
    expect(sameRect(twice.rect, once)).toBe(true);
  });
});
