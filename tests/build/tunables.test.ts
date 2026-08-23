import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TUNABLES,
  SCENE_TUNABLES,
  TUNE_RANGE,
  type Tunables,
  isDefaultTunables,
  sanitizeTunables,
} from '@/lib/build/tunables';

const KEYS = Object.keys(DEFAULT_TUNABLES) as (keyof Tunables)[];

describe('DEFAULT_TUNABLES', () => {
  it('is frozen, so a caller cannot edit the shipped configuration', () => {
    expect(Object.isFrozen(DEFAULT_TUNABLES)).toBe(true);
  });

  it('sits inside its own declared range, key for key', () => {
    for (const k of KEYS) {
      const [lo, hi] = TUNE_RANGE[k];
      expect(DEFAULT_TUNABLES[k]).toBeGreaterThanOrEqual(lo);
      expect(DEFAULT_TUNABLES[k]).toBeLessThanOrEqual(hi);
    }
  });

  it('declares a range for every tunable and no others', () => {
    expect(Object.keys(TUNE_RANGE).sort()).toEqual([...KEYS].sort());
  });

  it('has a low end below the high end everywhere', () => {
    for (const k of KEYS) expect(TUNE_RANGE[k][0]).toBeLessThan(TUNE_RANGE[k][1]);
  });

  /**
   * maxGridN is pinned, not chosen: RGE ALTI allows 5000 posts across the nine
   * requests lib/sources/ign makes, which is 45000, and (211+1)^2 = 44944.
   * Offer 212 and the IGN terrain path throws on a value the panel handed it.
   */
  it('keeps maxGridN at the ceiling the IGN request budget allows', () => {
    expect(TUNE_RANGE.maxGridN[1]).toBe(211);
    expect((211 + 1) ** 2).toBeLessThanOrEqual(45000);
    expect((212 + 1) ** 2).toBeGreaterThan(45000);
  });

  /**
   * The two that change nothing a build produces: siteMax bounds the rectangle
   * you may draw next, and orbitCycleMs only paces a camera. Counting either as
   * scene-changing would mark the scene stale on every drag of its slider.
   */
  it('counts every tunable except siteMax and orbitCycleMs as scene-changing', () => {
    const viewOnly = new Set(['siteMax', 'orbitCycleMs']);
    expect([...SCENE_TUNABLES].sort()).toEqual(KEYS.filter((k) => !viewOnly.has(k)).sort());
  });

  /** The shipped pace of the presentation orbit, pinned: it was CYCLE_MS in
   *  lib/viewer/presentation before the panel could reach it, and the default
   *  has to keep reproducing that exactly. */
  it('keeps the presentation orbit at its shipped 36 s revolution', () => {
    expect(DEFAULT_TUNABLES.orbitCycleMs).toBe(36000);
  });
});

describe('sanitizeTunables', () => {
  it('passes a valid object through unchanged', () => {
    const t = { ...DEFAULT_TUNABLES, conformStep: 12, storeyHeight: 4 };
    expect(sanitizeTunables(t)).toEqual(t);
  });

  it('returns the defaults for anything that is not an object', () => {
    for (const junk of [null, undefined, 42, 'nope', true, NaN]) {
      expect(sanitizeTunables(junk)).toEqual({ ...DEFAULT_TUNABLES });
    }
  });

  it('returns the defaults for an empty object', () => {
    expect(sanitizeTunables({})).toEqual({ ...DEFAULT_TUNABLES });
  });

  /** Walking the keys of DEFAULT_TUNABLES is what makes an old blob a non-event. */
  it('fills a missing field from the defaults and keeps the rest', () => {
    const out = sanitizeTunables({ conformStep: 12 });
    expect(out.conformStep).toBe(12);
    expect(out.treeCap).toBe(DEFAULT_TUNABLES.treeCap);
  });

  it('drops an unknown field rather than carrying it through', () => {
    const out = sanitizeTunables({ conformStep: 12, wingspan: 99 }) as Record<string, unknown>;
    expect(out.wingspan).toBeUndefined();
    expect(Object.keys(out).sort()).toEqual([...KEYS].sort());
  });

  it('clamps every key to the low end of its range', () => {
    const out = sanitizeTunables(Object.fromEntries(KEYS.map((k) => [k, -1e9])));
    for (const k of KEYS) expect(out[k]).toBe(TUNE_RANGE[k][0]);
  });

  it('clamps every key to the high end of its range', () => {
    const out = sanitizeTunables(Object.fromEntries(KEYS.map((k) => [k, 1e9])));
    for (const k of KEYS) expect(out[k]).toBe(TUNE_RANGE[k][1]);
  });

  it('leaves a value sitting exactly on either bound alone', () => {
    for (const k of KEYS) {
      const [lo, hi] = TUNE_RANGE[k];
      expect(sanitizeTunables({ [k]: lo })[k]).toBe(lo);
      expect(sanitizeTunables({ [k]: hi })[k]).toBe(hi);
    }
  });

  it('falls back to the default for a value of the wrong type', () => {
    for (const junk of ['4000', null, undefined, [], {}, true]) {
      expect(sanitizeTunables({ buildingCap: junk }).buildingCap).toBe(
        DEFAULT_TUNABLES.buildingCap,
      );
    }
  });

  /**
   * Finiteness is checked before the clamp, and the order matters: clamping
   * first lets NaN through, since Math.min(hi, Math.max(lo, NaN)) is NaN. A NaN
   * cap turns every `length >= cap` guard in the parsers into a no-op, which is
   * a browser tab pulling down a whole city rather than a wrong number on screen.
   */
  it('does not let NaN or an infinity reach a cap', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const out = sanitizeTunables({ buildingCap: bad, treeCap: bad, maxGridN: bad });
      expect(out.buildingCap).toBe(DEFAULT_TUNABLES.buildingCap);
      expect(out.treeCap).toBe(DEFAULT_TUNABLES.treeCap);
      expect(out.maxGridN).toBe(DEFAULT_TUNABLES.maxGridN);
      expect(Number.isFinite(out.buildingCap)).toBe(true);
    }
  });

  it('is idempotent, and always lands inside the ranges', () => {
    const once = sanitizeTunables({ buildingCap: 1e9, storeyHeight: 'x', treeCap: -5 });
    expect(sanitizeTunables(once)).toEqual(once);
    for (const k of KEYS) {
      const [lo, hi] = TUNE_RANGE[k];
      expect(once[k]).toBeGreaterThanOrEqual(lo);
      expect(once[k]).toBeLessThanOrEqual(hi);
    }
  });

  it('does not hand back the frozen defaults object itself', () => {
    const out = sanitizeTunables({});
    expect(out).not.toBe(DEFAULT_TUNABLES);
    expect(Object.isFrozen(out)).toBe(false);
  });
});

describe('isDefaultTunables', () => {
  it('is true for the shipped configuration and for a copy of it', () => {
    expect(isDefaultTunables({ ...DEFAULT_TUNABLES })).toBe(true);
    expect(isDefaultTunables(sanitizeTunables({}))).toBe(true);
  });

  it('is false once any single key differs', () => {
    for (const k of KEYS) {
      expect(isDefaultTunables({ ...DEFAULT_TUNABLES, [k]: TUNE_RANGE[k][0] - 1 })).toBe(false);
    }
  });
});
