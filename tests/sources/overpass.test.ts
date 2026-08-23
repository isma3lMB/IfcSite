import { describe, expect, it } from 'vitest';
import { parseHeight } from '@/lib/sources/overpass';

/**
 * The tag reader that decides how tall an OSM footprint comes out. Pure, so it
 * is tested directly — nothing here opens a socket, and no Overpass mirror is
 * involved.
 *
 * The ladder is fixed: an explicit height wins, storeys are the fallback below
 * it, and the caller's default is the floor. Which rung answered comes back
 * alongside the number and ends up in the IFC as `height_source`, so the two
 * halves of the return are tested together throughout.
 */
const FALLBACK = 9;
const STOREY = 3;

const height = (tags: Record<string, string>): [number, string] =>
  parseHeight(tags, FALLBACK, STOREY);

describe('parseHeight', () => {
  describe('an explicit height tag', () => {
    it('is read straight off `height`', () => {
      expect(height({ height: '12' })).toEqual([12, 'tag:height']);
    });

    it('is read off `building:height` when `height` is absent', () => {
      expect(height({ 'building:height': '18.5' })).toEqual([18.5, 'tag:height']);
    });

    it('prefers `height` when both are present', () => {
      expect(height({ height: '12', 'building:height': '30' })).toEqual([12, 'tag:height']);
    });

    it('keeps the fraction', () => {
      expect(height({ height: '12.75' })).toEqual([12.75, 'tag:height']);
    });

    /** OSM heights arrive with units attached often enough to matter. */
    it('strips a unit suffix', () => {
      expect(height({ height: '12 m' })).toEqual([12, 'tag:height']);
      expect(height({ height: '12m' })).toEqual([12, 'tag:height']);
      expect(height({ height: '12 metres' })).toEqual([12, 'tag:height']);
    });

    /**
     * Everything but digits and the point is stripped before parsing, so a
     * feet-and-inches value is silently read as a decimal metre figure. Recorded
     * as the current behaviour rather than endorsed: `12'6"` becomes 126 m.
     */
    it("reads an imperial height as though it were metric", () => {
      expect(height({ height: `12'6"` })).toEqual([126, 'tag:height']);
    });

    it('falls through when the tag holds no number at all', () => {
      expect(height({ height: 'tall' })).toEqual([FALLBACK, 'fallback']);
      expect(height({ height: '' })).toEqual([FALLBACK, 'fallback']);
    });

    it('falls through for a height of zero', () => {
      expect(height({ height: '0' })).toEqual([FALLBACK, 'fallback']);
    });

    /**
     * The minus is not a digit or a point, so it is stripped with the units and
     * a negative height comes back positive. Recorded rather than endorsed —
     * it is the same stripping that makes `12 m` work, and a negative height in
     * OSM is a typo whose magnitude is usually the number meant.
     */
    it('reads a negative height as its magnitude', () => {
      expect(height({ height: '-5' })).toEqual([5, 'tag:height']);
    });

    it('falls through to storeys rather than to the default', () => {
      expect(height({ height: 'tall', 'building:levels': '4' })).toEqual([12, 'tag:levels']);
    });
  });

  describe('storeys', () => {
    it('multiplies levels by the storey height', () => {
      expect(height({ 'building:levels': '4' })).toEqual([12, 'tag:levels']);
    });

    it('takes the storey height from the tunable it was passed', () => {
      expect(parseHeight({ 'building:levels': '4' }, FALLBACK, 4.5)).toEqual([18, 'tag:levels']);
    });

    it('handles a fractional level count', () => {
      expect(height({ 'building:levels': '2.5' })).toEqual([7.5, 'tag:levels']);
    });

    it('falls through for a non-positive or unreadable level count', () => {
      expect(height({ 'building:levels': '0' })).toEqual([FALLBACK, 'fallback']);
      expect(height({ 'building:levels': 'ground' })).toEqual([FALLBACK, 'fallback']);
    });
  });

  describe('the fallback', () => {
    it('answers for an empty tag bag', () => {
      expect(height({})).toEqual([FALLBACK, 'fallback']);
    });

    it('answers for tags that say nothing about height', () => {
      expect(height({ building: 'yes', name: 'Somewhere' })).toEqual([FALLBACK, 'fallback']);
    });

    /** The caller's number, verbatim — parseOSM counts anything else as tagged. */
    it('returns exactly what it was given', () => {
      expect(parseHeight({}, 21.5, STOREY)).toEqual([21.5, 'fallback']);
    });
  });

  it('reports a source that is only "fallback" when nothing was tagged', () => {
    expect(height({ height: '10' })[1]).not.toBe('fallback');
    expect(height({ 'building:levels': '3' })[1]).not.toBe('fallback');
    expect(height({})[1]).toBe('fallback');
  });
});
