import { describe, expect, it } from 'vitest';
import { formatLatLon, parseLatLon } from '@/lib/geo/coords';

/** Paris, to five decimals, in every notation the search box accepts. */
const LAT = 48.8566;
const LON = 2.3522;

describe('parseLatLon', () => {
  describe('accepts', () => {
    const ok: [string, number, number][] = [
      ['48.8566, 2.3522', 48.8566, 2.3522],
      ['48.8566,2.3522', 48.8566, 2.3522],
      ['48.8566 2.3522', 48.8566, 2.3522],
      ['-33.87, 151.21', -33.87, 151.21],
      ['-33.87 151.21', -33.87, 151.21],
      ['48.8566N 2.3522E', 48.8566, 2.3522],
      ['48.8566 N, 2.3522 E', 48.8566, 2.3522],
      ['N48.8566 E2.3522', 48.8566, 2.3522],
      ['33.87S, 151.21E', -33.87, 151.21],
      ['40.7128N 74.0060W', 40.7128, -74.006],
    ];
    for (const [q, lat, lon] of ok) {
      it(q, () => expect(parseLatLon(q)).toEqual({ lat, lon }));
    }

    it('degrees, minutes and seconds with typographic symbols', () => {
      const r = parseLatLon('48°51\'23"N 2°21\'08"E');
      expect(r!.lat).toBeCloseTo(48.85639, 5);
      expect(r!.lon).toBeCloseTo(2.35222, 5);
    });

    it('degrees and decimal minutes', () => {
      const r = parseLatLon("48°51.4'N 2°21.1'E");
      expect(r!.lat).toBeCloseTo(48.85667, 5);
      expect(r!.lon).toBeCloseTo(2.35167, 5);
    });

    it('unpunctuated DMS, once hemispheres disambiguate it', () => {
      const r = parseLatLon('48 51 23 N, 2 21 8 E');
      expect(r!.lat).toBeCloseTo(48.85639, 5);
      expect(r!.lon).toBeCloseTo(2.35222, 5);
    });

    it('spelled-out units', () => {
      const r = parseLatLon('48 deg 51 min 23 sec N, 2 deg 21 min 8 sec E');
      expect(r!.lat).toBeCloseTo(48.85639, 5);
    });

    it('the poles and the antimeridian, which are in range', () => {
      expect(parseLatLon('90, 180')).toEqual({ lat: 90, lon: 180 });
      expect(parseLatLon('-90, -180')).toEqual({ lat: -90, lon: -180 });
    });

    /** Latitude first for a bare pair, always: `2.35, 48.85` is a real point in
     *  the Mediterranean, and swapping it silently would be invisible. */
    it('does not reorder a bare pair that looks lon-first', () => {
      expect(parseLatLon('2.3522, 48.8566')).toEqual({ lat: 2.3522, lon: 48.8566 });
    });

    it('reorders when hemisphere letters say to', () => {
      expect(parseLatLon('2.3522E, 48.8566N')).toEqual({ lat: 48.8566, lon: 2.3522 });
    });
  });

  /**
   * The declining half is the point of this function: it is a filter in front of
   * Nominatim, so anything short of unambiguous has to fall through to the
   * geocoder rather than drop a pin in the Atlantic.
   */
  describe('declines', () => {
    const no: [string, string][] = [
      ['an address', '10 Downing Street'],
      ['a place name', 'Paris'],
      ['a bare integer pair with no comma or symbol', '48 51'],
      ['three components', '48.85, 2.35, 100'],
      ['one component', '48.8566'],
      ['an empty string', ''],
      ['whitespace', '   '],
      ['a trailing comma', '48.8566,'],
      ['hemisphere letters at both ends of a component', 'N48.8566N 2.3522E'],
      ['a sign and a hemisphere together', '-48.8566S, 2.3522E'],
      ['two north-south letters', '48.8566N 2.3522N'],
      ['two east-west letters', '48.8566E 2.3522E'],
      ['one letter and not the other', '48.8566N 2.3522'],
      ['minutes at sixty', '48 60 00 N, 2 21 08 E'],
      ['seconds at sixty', '48 51 60 N, 2 21 08 E'],
      ['a fractional degree before minutes', "48.5°51'N 2°21'E"],
      ['a fractional minute before seconds', '48 51.5 23 N, 2 21 8 E'],
      ['more than three components in an angle', '48 51 23 11 N, 2 21 8 E'],
      ['a latitude past the pole', '91, 2.3522'],
      ['a longitude past the antimeridian', '48.8566, 181'],
      ['letters mixed into a number', '48.8x, 2.35'],
    ];
    for (const [why, q] of no) {
      it(why, () => expect(parseLatLon(q)).toBeNull());
    }
  });

  it('treats semicolons, slashes and pipes as the comma they stand in for', () => {
    for (const sep of [';', '/', '|']) {
      expect(parseLatLon(`48.8566${sep} 2.3522`)).toEqual({ lat: LAT, lon: LON });
    }
  });
});

describe('formatLatLon', () => {
  it('gives five decimals, which is about a metre', () => {
    expect(formatLatLon(LAT, LON)).toBe('48.85660, 2.35220');
  });

  it('pads and rounds rather than truncating', () => {
    expect(formatLatLon(0, -0.000004)).toBe('0.00000, -0.00000');
    expect(formatLatLon(1.234567, -7.6)).toBe('1.23457, -7.60000');
  });

  it('round-trips back through the parser', () => {
    const r = parseLatLon(formatLatLon(-33.8688, 151.2093));
    expect(r).toEqual({ lat: -33.8688, lon: 151.2093 });
  });
});
