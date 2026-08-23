import { describe, expect, it } from 'vitest';
import {
  type CrsRecord,
  areaOf,
  bestAt,
  candidatesAt,
  containsPoint,
  findRecord,
  toCrsDef,
} from '@/lib/geo/epsg';

/**
 * Everything here except loadEpsgIndex is pure over a list of records, so the
 * tests hand it small fixtures rather than the 1.2 MB index. Nothing fetches.
 *
 * Areas of use are EPSG's own order — north, west, south, east — which is the
 * detail most likely to be got wrong by a future edit, so it is exercised
 * directly.
 */
const rec = (c: number, n: string, b: CrsRecord['b'], extra: Partial<CrsRecord> = {}): CrsRecord => ({
  c,
  n,
  a: extra.a ?? 'Somewhere',
  b,
  p: extra.p ?? `+proj=utm +zone=31 +datum=WGS84 +units=m +no_defs`,
  ...extra,
});

const PARIS = { lat: 48.8566, lon: 2.3522 };
const BARCELONA = { lat: 41.3874, lon: 2.1686 };

describe('containsPoint', () => {
  // North 52, west 0, south 48, east 8.
  const box = rec(1, 'A box', [52, 0, 48, 8]);

  it('is true inside the area of use', () => {
    expect(containsPoint(box, 50, 4)).toBe(true);
  });

  it('reads the bounds as north, west, south, east', () => {
    expect(containsPoint(box, 50, 4)).toBe(true);
    // Swapping the order would put this inside, and it must not be.
    expect(containsPoint(box, 4, 50)).toBe(false);
  });

  it('is false outside it on either axis', () => {
    expect(containsPoint(box, 53, 4)).toBe(false);
    expect(containsPoint(box, 47, 4)).toBe(false);
    expect(containsPoint(box, 50, -1)).toBe(false);
    expect(containsPoint(box, 50, 9)).toBe(false);
  });

  it('counts the edges as inside', () => {
    expect(containsPoint(box, 52, 0)).toBe(true);
    expect(containsPoint(box, 48, 8)).toBe(true);
  });

  /**
   * An area crossing the antimeridian is published with its west edge greater
   * than its east one — UTM zone 60, Fiji and Chukotka all are. A plain min/max
   * comparison rejects every point in exactly the places those CRSs serve.
   */
  describe('across the antimeridian', () => {
    const fiji = rec(3141, 'Fiji 1986 / Fiji Map Grid', [-12, 174, -22, -178]);

    it('accepts a point east of the west edge', () => {
      expect(containsPoint(fiji, -18, 178)).toBe(true);
      expect(containsPoint(fiji, -18, 180)).toBe(true);
    });

    it('accepts a point west of the east edge, past the dateline', () => {
      expect(containsPoint(fiji, -18, -179)).toBe(true);
      expect(containsPoint(fiji, -18, -178)).toBe(true);
    });

    it('rejects a point in the gap on the far side of the world', () => {
      expect(containsPoint(fiji, -18, 0)).toBe(false);
      expect(containsPoint(fiji, -18, 100)).toBe(false);
      expect(containsPoint(fiji, -18, -100)).toBe(false);
    });

    it('still applies the latitude test', () => {
      expect(containsPoint(fiji, -30, 178)).toBe(false);
    });
  });
});

describe('areaOf', () => {
  it('grows with both spans', () => {
    const small = rec(1, 'small', [51, 0, 50, 1]);
    const wide = rec(2, 'wide', [51, 0, 50, 10]);
    const tall = rec(3, 'tall', [59, 0, 50, 1]);
    expect(areaOf(wide)).toBeGreaterThan(areaOf(small));
    expect(areaOf(tall)).toBeGreaterThan(areaOf(small));
  });

  /** The cosine is there so a Svalbard grid does not read as larger than a
   *  French one covering the same ground. */
  it('weights by latitude, so the same box is smaller further north', () => {
    const south = rec(1, 'south', [11, 0, 10, 1]);
    const north = rec(2, 'north', [79, 0, 78, 1]);
    expect(areaOf(north)).toBeLessThan(areaOf(south));
  });

  it('measures the short way round for an area crossing the antimeridian', () => {
    const fiji = rec(3141, 'Fiji', [-12, 174, -22, -178]);
    // 174E to 178W is 8 degrees of longitude, not 352.
    expect(areaOf(fiji)).toBeLessThan(areaOf(rec(1, 'half the world', [-12, 0, -22, 180])));
    expect(areaOf(fiji)).toBeGreaterThan(0);
  });
});

describe('candidatesAt', () => {
  const national = rec(27700, 'OSGB36 / British National Grid', [61, -9, 49, 2]);
  const utm = rec(32630, 'WGS 84 / UTM zone 30N', [84, -6, 0, 0]);
  const continental = rec(3035, 'ETRS89 / LAEA Europe', [84, -35, 24, 45]);
  const elsewhere = rec(2154, 'RGF93 / Lambert-93', [51.56, -9.86, 41.15, 10.38], {
    a: 'France - onshore and offshore, mainland and Corsica.',
  });

  it('drops records whose area of use does not reach the point', () => {
    const out = candidatesAt([national, elsewhere], -33.87, 151.21);
    expect(out).toEqual([]);
  });

  /** A CRS published for one département beats one published for a hemisphere. */
  it('ranks the most local first', () => {
    const out = candidatesAt([continental, utm, national], 51.5, -0.12);
    expect(out.map((r) => r.c)).toEqual([27700, 32630, 3035]);
  });

  /**
   * Ties are the successive realizations of one datum over the same ground —
   * Amersfoort RD Old and RD New, NAD83 beside its HARN and NSRS readjustments.
   * The higher code is the later registration, so it wins.
   */
  it('breaks a tie on area by preferring the higher code', () => {
    const older = rec(28991, 'Amersfoort / RD Old', [54, 3, 50, 8]);
    const newer = rec(28992, 'Amersfoort / RD New', [54, 3, 50, 8]);
    expect(candidatesAt([older, newer], 52, 5).map((r) => r.c)).toEqual([28992, 28991]);
  });

  /**
   * A datum tie worse than 5 m is a tier, not a filter: Tokyo datum is 9 m and
   * JGD2011 is 1 m over the same wards, and the legacy system publishes the
   * smaller box, so locality alone would quietly place a site a bus ride away.
   */
  it('demotes a coarse datum tie below a fine one, however local it is', () => {
    const legacy = rec(30169, 'Tokyo / Japan Plane Rectangular CS IX', [36.5, 139.5, 35.5, 140.5], {
      k: 9,
    });
    const current = rec(6677, 'JGD2011 / Japan Plane Rectangular CS IX', [37, 138, 35, 141], {
      k: 1,
    });
    expect(candidatesAt([legacy, current], 35.7, 139.7).map((r) => r.c)).toEqual([6677, 30169]);
  });

  /** Plenty of current national CRSs simply carry no accuracy figure. */
  it('reads an unstated accuracy as fine, not as bad', () => {
    const stated = rec(1, 'stated', [37, 138, 35, 141], { k: 9 });
    const unstated = rec(2, 'unstated', [37, 138, 35, 141] );
    expect(candidatesAt([stated, unstated], 36, 139).map((r) => r.c)).toEqual([2, 1]);
  });

  it('leaves the caller list untouched', () => {
    const list = [continental, utm, national];
    const before = [...list];
    candidatesAt(list, 51.5, -0.12);
    expect(list).toEqual(before);
  });
});

/**
 * The France rule. An area of use is a bounding box, and a box around France
 * contains Barcelona, Bilbao and Zaragoza — so ranking on box area alone hands
 * a Spanish site Lambert-93.
 */
describe('the France spill rule', () => {
  const lambert = rec(2154, 'RGF93 / Lambert-93', [51.56, -9.86, 41.15, 10.38], {
    a: 'France - onshore and offshore, mainland and Corsica.',
  });
  const utm31 = rec(25831, 'ETRS89 / UTM zone 31N', [84, 0, 0, 6], {
    a: 'Europe between 0°E and 6°E.',
  });
  const CURATED = ['2154', '27700', '25832', '28992'];

  it('keeps a French system for a site in France', () => {
    const out = candidatesAt([utm31, lambert], PARIS.lat, PARIS.lon);
    expect(out[0].c).toBe(2154);
  });

  /** With this rule northern Spain lands on a UTM zone like the rest of Spain. */
  it('demotes a French system for a site over the border', () => {
    const out = candidatesAt([lambert, utm31], BARCELONA.lat, BARCELONA.lon);
    expect(out[0].c).toBe(25831);
    expect(out.map((r) => r.c)).toContain(2154);
  });

  it('is a tier and not a filter, so the French system stays in the picker', () => {
    expect(candidatesAt([lambert], BARCELONA.lat, BARCELONA.lon).map((r) => r.c)).toEqual([2154]);
  });

  /**
   * EPSG:25832 is a UTM zone shared by eight countries, registered with a
   * smaller box than Lambert-93 — whose own box is half Atlantic. Ranking by
   * area alone handed Nice, Strasbourg and both Corsican cities a German UTM
   * zone instead of the grid every French deliverable is drawn on.
   */
  it('prefers the curated code that names France for a site inside it', () => {
    // EPSG's own bounds for 25832, which really are the smaller box of the two.
    const utm32 = rec(25832, 'ETRS89 / UTM zone 32N', [84, 6, 38.76, 12], {
      a: 'Europe between 6°E and 12°E.',
    });
    // Strasbourg: both cover it, and the UTM box is the smaller one.
    const strasbourg = { lat: 48.5734, lon: 7.7521 };
    expect(areaOf(utm32)).toBeLessThan(areaOf(lambert));
    expect(bestAt([utm32, lambert], CURATED, strasbourg.lat, strasbourg.lon)?.c).toBe(2154);
  });
});

describe('bestAt', () => {
  const CURATED = ['2154', '27700', '25832', '28992'];
  const bng = rec(27700, 'OSGB36 / British National Grid', [61, -9, 49, 2]);
  // EPSG publishes these over London too, all more local than 27700 and none of
  // them what anyone means.
  const hs2 = rec(9300, 'HS2 Survey Grid', [53.5, -2.7, 51.3, -0.1]);
  const londonSurvey = rec(7405, 'London Survey Grid', [51.7, -0.6, 51.3, 0.3]);

  it('prefers a curated national grid over a more local railway grid', () => {
    const out = bestAt([hs2, londonSurvey, bng], CURATED, 51.5, -0.12);
    expect(out?.c).toBe(27700);
  });

  it('falls back to the most local candidate where no curated code covers the site', () => {
    const local = rec(2039, 'Israel 1993 / Israeli TM Grid', [33.5, 34, 29.4, 35.7]);
    const wide = rec(32636, 'WGS 84 / UTM zone 36N', [84, 30, 0, 36]);
    expect(bestAt([wide, local], CURATED, 31.77, 35.21)?.c).toBe(2039);
  });

  it('is undefined where nothing covers the site at all', () => {
    expect(bestAt([bng], CURATED, -33.87, 151.21)).toBeUndefined();
  });

  /**
   * Outside France the search skips the spilled records rather than scanning the
   * whole list — otherwise a curated code is found however far it was demoted,
   * which is precisely how EPSG:2154 kept winning in Spain.
   */
  it('does not reach past a demoted French code to pick it anyway', () => {
    const lambert = rec(2154, 'RGF93 / Lambert-93', [51.56, -9.86, 41.15, 10.38], {
      a: 'France - onshore and offshore, mainland and Corsica.',
    });
    const utm31 = rec(25831, 'ETRS89 / UTM zone 31N', [84, 0, 0, 6], {
      a: 'Europe between 0°E and 6°E.',
    });
    expect(bestAt([lambert, utm31], CURATED, BARCELONA.lat, BARCELONA.lon)?.c).toBe(25831);
  });
});

describe('toCrsDef', () => {
  it('splits the datum off the published name', () => {
    const out = toCrsDef(rec(2154, 'RGF93 v1 / Lambert-93', [51, -5, 42, 8], { p: '+proj=lcc' }));
    expect(out).toEqual({ def: '+proj=lcc', name: 'RGF93 v1 / Lambert-93', datum: 'RGF93 v1' });
  });

  it('takes only the first separator', () => {
    expect(toCrsDef(rec(1, 'A / B / C', [1, 0, 0, 1])).datum).toBe('A');
  });

  /** Names without a separator are rare and are their own best answer. */
  it('uses the whole name as the datum when there is no separator', () => {
    expect(toCrsDef(rec(1, 'Some Grid', [1, 0, 0, 1])).datum).toBe('Some Grid');
  });
});

describe('findRecord', () => {
  const list = [rec(2154, 'Lambert-93', [51, -5, 42, 8]), rec(27700, 'BNG', [61, -9, 49, 2])];

  it('finds a record by its code as a string', () => {
    expect(findRecord(list, '27700')?.n).toBe('BNG');
  });

  it('is undefined for a code that is not there, or not a number', () => {
    expect(findRecord(list, '9999')).toBeUndefined();
    expect(findRecord(list, 'auto')).toBeUndefined();
    expect(findRecord(list, '')).toBeUndefined();
  });
});
