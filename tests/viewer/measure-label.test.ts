import { describe, expect, it } from 'vitest';
import { labelSpot } from '@/lib/viewer/measureLayer';

/** A readout roughly the size the distance tool draws: two lines of mono. */
const W = 160;
const H = 34;
/** Mirrors CLEAR in measureLayer.ts. Not exported — a test that reached in for
 *  it would only be asserting that a constant equals itself. */
const CLEAR = 14;

/** Whether the point being aimed at falls inside the box drawn at `spot`,
 *  which is the one thing this must never allow. */
const covers = (spot: { x: number; y: number }, tip: { x: number; y: number }): boolean =>
  Math.abs(spot.x - tip.x) < W / 2 && Math.abs(spot.y - tip.y) < H / 2;

describe('labelSpot', () => {
  it('leaves a distant anchor exactly where it is', () => {
    const anchor = { x: 400, y: 120 };
    const spot = labelSpot(anchor, { x: 400, y: 600 }, W, H);
    expect(spot).toEqual(anchor);
  });

  it('pushes straight up when the anchor is the tip', () => {
    const tip = { x: 300, y: 300 };
    const spot = labelSpot(tip, tip, W, H);
    expect(spot.x).toBeCloseTo(300);
    expect(spot.y).toBeCloseTo(300 - (H / 2 + CLEAR));
  });

  it('clears sideways along a horizontal span', () => {
    // Anchor a few pixels right of the tip: the box would swallow it, so it
    // slides right until its left edge is CLEAR past the tip.
    const spot = labelSpot({ x: 305, y: 300 }, { x: 300, y: 300 }, W, H);
    expect(spot.y).toBeCloseTo(300);
    expect(spot.x).toBeCloseTo(300 + (W / 2 + CLEAR));
  });

  it('never covers the tip, at any distance or bearing', () => {
    const tip = { x: 250, y: 250 };
    for (let deg = 0; deg < 360; deg += 7) {
      const a = (deg * Math.PI) / 180;
      for (let len = 0; len <= 200; len += 2.5) {
        const anchor = { x: tip.x + Math.cos(a) * len, y: tip.y + Math.sin(a) * len };
        expect(covers(labelSpot(anchor, tip, W, H), tip)).toBe(false);
      }
    }
  });

  it('slides continuously, with no jump at the handover', () => {
    const tip = { x: 250, y: 250 };
    const a = (37 * Math.PI) / 180;
    const at = (len: number) =>
      labelSpot({ x: tip.x + Math.cos(a) * len, y: tip.y + Math.sin(a) * len }, tip, W, H);

    // From half a pixel out, not from zero: at zero there is no line to slide
    // along and the direction falls back to straight up, so the step onto the
    // real bearing is a jump by construction — the one below covers it.
    let prev = at(0.5);
    for (let len = 1; len <= 200; len += 0.5) {
      const spot = at(len);
      // The anchor moves half a pixel per step; the label must never move more,
      // which is what rules out a threshold being crossed.
      expect(Math.hypot(spot.x - prev.x, spot.y - prev.y)).toBeLessThanOrEqual(0.5 + 1e-9);
      prev = spot;
    }
    // And by the far end it has settled onto the anchor itself.
    const far = { x: tip.x + Math.cos(a) * 200, y: tip.y + Math.sin(a) * 200 };
    expect(at(200)).toEqual(far);
  });

  it('stays clear of the tip across the degenerate step', () => {
    // The only place the position jumps: the anchor leaving the tip picks a
    // bearing where there was none. The jump is allowed, covering the tip is
    // not, and both ends sit the same distance out.
    const tip = { x: 250, y: 250 };
    const a = (37 * Math.PI) / 180;
    const zero = labelSpot(tip, tip, W, H);
    const next = labelSpot({ x: tip.x + Math.cos(a) * 0.5, y: tip.y + Math.sin(a) * 0.5 }, tip, W, H);
    expect(covers(zero, tip)).toBe(false);
    expect(covers(next, tip)).toBe(false);
  });

  it('treats a zero-sized label as the clearance alone', () => {
    // A label measured before layout reports 0 x 0. It must still resolve to a
    // point rather than a NaN.
    const spot = labelSpot({ x: 100, y: 100 }, { x: 100, y: 100 }, 0, 0);
    expect(spot.x).toBeCloseTo(100);
    expect(spot.y).toBeCloseTo(100 - CLEAR);
  });
});
