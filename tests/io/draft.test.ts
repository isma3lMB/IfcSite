import { describe, expect, it } from 'vitest';
import { DEFAULT_FORM } from '@/lib/build/defaults';
import { DEFAULT_TUNABLES } from '@/lib/build/tunables';
import { isAppError } from '@/lib/errors';
import { CRS_DEFS } from '@/lib/geo/crs';
import {
  DRAFT_MAGIC,
  DRAFT_VERSION,
  type Draft,
  draftToText,
  parseDraft,
  toDraft,
} from '@/lib/io/draft';
import { defaultProjectName, emptyScene, newIfcMeta } from '@/lib/types';
import type { SiteMeta, Site, SiteRect } from '@/lib/types';

/* -------------------------------------------------------------------------
   A minimal but genuinely valid draft: Paris, Lambert-93, an empty scene.
   Built through toDraft rather than written out by hand, so the fixture cannot
   drift away from what the writer actually emits.
   ------------------------------------------------------------------------- */

const RECT: SiteRect = { minLat: 48.8539, maxLat: 48.8593, minLon: 2.3481, maxLon: 2.3563 };

const SITE: Site = {
  ...RECT,
  lat: 48.8566,
  lon: 2.3522,
  halfX: 300,
  halfY: 300,
  radius: 424.26,
};

const META: SiteMeta = {
  origin: [652000, 6862000],
  exportOffset: [0, 0, 0],
  projectBase: [0, 0, 0],
  projectAngle: 0,
  lat: 48.8566,
  lon: 2.3522,
  epsg: 'EPSG:2154',
  crsName: CRS_DEFS['2154'].name,
  geodeticDatum: CRS_DEFS['2154'].datum,
  verticalDatum: null,
  verticalDatumEpsg: null,
  crsDef: CRS_DEFS['2154'].def,
  ifc: { ...newIfcMeta(), projectName: 'Test site' },
  provider: 'ign',
  fetched: '2026-02-14',
};

const draft = (): Draft =>
  toDraft({
    name: 'Test site',
    rect: RECT,
    site: SITE,
    form: { ...DEFAULT_FORM, tune: { ...DEFAULT_TUNABLES } },
    epsgPicked: true,
    crsDef: CRS_DEFS['2154'].def,
    meta: META,
    scene: emptyScene(),
  });

const text = (patch: Record<string, unknown> = {}): string =>
  draftToText({ ...draft(), ...patch } as Draft);

/** The error code an AppError carried, or null if something else was thrown. */
const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
  } catch (e) {
    return isAppError(e) ? e.code : `not-an-AppError: ${String(e)}`;
  }
  return null;
};

describe('toDraft', () => {
  it('stamps the magic and the current version', () => {
    const d = draft();
    expect(d.magic).toBe(DRAFT_MAGIC);
    expect(d.version).toBe(DRAFT_VERSION);
  });

  it('records when it was saved, as an ISO instant', () => {
    expect(() => new Date(draft().savedAt).toISOString()).not.toThrow();
    expect(Number.isNaN(Date.parse(draft().savedAt))).toBe(false);
  });

  /**
   * The lattice is a pure function of (rect, n) and the faces of n alone, so
   * only the heights are stored — at the ceiling that is ~650 kB against
   * ~3.6 MB.
   */
  it('trims terrain to its column of heights', () => {
    const d = draft();
    expect(d.scene.terrain).toBeNull();
    expect((d.scene as Record<string, unknown>).verts).toBeUndefined();
  });
});

describe('draftToText', () => {
  /**
   * Not rounded, on purpose: the IFC writer emits full doubles, so trimming
   * here would mean a draft that reopens and re-exports a different file from
   * the one it was saved beside.
   */
  it('round-trips a double exactly', () => {
    const meta = { ...META, origin: [652000.123456789, 6862000.987654321] as [number, number] };
    const out = parseDraft(draftToText({ ...draft(), meta }));
    expect(out.meta.origin[0]).toBe(652000.123456789);
    expect(out.meta.origin[1]).toBe(6862000.987654321);
  });

  it('is compact rather than pretty-printed', () => {
    expect(draftToText(draft())).not.toContain('\n');
  });
});

describe('parseDraft', () => {
  it('reads back what toDraft wrote', () => {
    const out = parseDraft(text());
    expect(out.name).toBe('Test site');
    expect(out.rect).toEqual(RECT);
    expect(out.crsDef).toBe(CRS_DEFS['2154'].def);
    expect(out.epsgPicked).toBe(true);
    expect(out.meta.epsg).toBe('EPSG:2154');
    expect(out.scene.buildings).toEqual([]);
  });

  it('round-trips through a second save unchanged', () => {
    const first = parseDraft(text());
    const second = parseDraft(draftToText(toDraft({ ...first })));
    expect(second.rect).toEqual(first.rect);
    expect(second.meta).toEqual(first.meta);
    expect(second.form).toEqual(first.form);
    expect(second.scene).toEqual(first.scene);
  });

  /**
   * The three failures are told apart on purpose: "not our file" is a different
   * thing to fix from "our file, from a newer build" and from "our file,
   * damaged". Each of these is what the status line translates.
   */
  describe('err.draftUnreadable — not our file', () => {
    it('for malformed JSON', () => {
      expect(codeOf(() => parseDraft('{'))).toBe('err.draftUnreadable');
      expect(codeOf(() => parseDraft(''))).toBe('err.draftUnreadable');
      expect(codeOf(() => parseDraft('not json at all'))).toBe('err.draftUnreadable');
    });

    it('for valid JSON that is not an object', () => {
      for (const t of ['null', '42', '"a string"', '[1,2,3]', 'true']) {
        expect(codeOf(() => parseDraft(t))).toBe('err.draftUnreadable');
      }
    });

    it('for a missing or wrong magic', () => {
      expect(codeOf(() => parseDraft(JSON.stringify({ version: 1 })))).toBe('err.draftUnreadable');
      expect(codeOf(() => parseDraft(text({ magic: 'something.else' })))).toBe(
        'err.draftUnreadable',
      );
      expect(codeOf(() => parseDraft(text({ magic: 42 })))).toBe('err.draftUnreadable');
    });

    /** A version that is not a whole number at least 1 is not a version. */
    it('for a version that is not a positive integer', () => {
      for (const version of [0, -1, 1.5, 'one', null, NaN]) {
        expect(codeOf(() => parseDraft(text({ version })))).toBe('err.draftUnreadable');
      }
    });
  });

  describe('err.draftVersion — our file, from a newer build', () => {
    it('for a version past the one this build writes', () => {
      expect(codeOf(() => parseDraft(text({ version: DRAFT_VERSION + 1 })))).toBe(
        'err.draftVersion',
      );
      expect(codeOf(() => parseDraft(text({ version: 99 })))).toBe('err.draftVersion');
    });

    it('carrying the version it found, so the message can name it', () => {
      try {
        parseDraft(text({ version: 7 }));
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(isAppError(e)).toBe(true);
        expect(isAppError(e) && e.params).toEqual({ version: 7 });
      }
    });

    it('but not for the current version', () => {
      expect(codeOf(() => parseDraft(text({ version: DRAFT_VERSION })))).toBeNull();
    });
  });

  describe('err.draftCorrupt — our file, damaged', () => {
    it('for a missing or unusable rect', () => {
      for (const rect of [undefined, null, {}, 'nowhere', { minLat: 1 }]) {
        expect(codeOf(() => parseDraft(text({ rect })))).toBe('err.draftCorrupt');
      }
    });

    it('for a rect carrying a non-finite bound', () => {
      expect(codeOf(() => parseDraft(text({ rect: { ...RECT, maxLat: null } })))).toBe(
        'err.draftCorrupt',
      );
    });

    it('for a missing or empty crsDef', () => {
      for (const crsDef of [undefined, null, '', 42]) {
        expect(codeOf(() => parseDraft(text({ crsDef })))).toBe('err.draftCorrupt');
      }
    });

    /**
     * proj4 rejects a malformed definition by throwing, and that is a corrupt
     * file rather than an unreadable one — the envelope parsed fine.
     */
    it('for a crsDef proj4 cannot use', () => {
      expect(codeOf(() => parseDraft(text({ crsDef: '+proj=nonsense +units=m' })))).toBe(
        'err.draftCorrupt',
      );
    });

    it('for a missing scene', () => {
      for (const scene of [undefined, null, 'gone', 7]) {
        expect(codeOf(() => parseDraft(text({ scene })))).toBe('err.draftCorrupt');
      }
    });

    it('for a missing site or meta', () => {
      expect(codeOf(() => parseDraft(text({ site: null })))).toBe('err.draftCorrupt');
      expect(codeOf(() => parseDraft(text({ meta: null })))).toBe('err.draftCorrupt');
    });
  });

  describe('the sanitisers', () => {
    /** The envelope's copy wins: it is the one this loader has just validated. */
    it('lets the envelope crsDef override whatever the embedded meta carried', () => {
      const out = parseDraft(
        text({ meta: { ...META, crsDef: CRS_DEFS['27700'].def }, crsDef: CRS_DEFS['2154'].def }),
      );
      expect(out.meta.crsDef).toBe(CRS_DEFS['2154'].def);
    });

    /* The attribution the export has to carry travels with the draft: an IFC
       written from a reopened site must still name its sources, and must still
       report when the data actually came down rather than when the button was
       pressed the second time. */
    it('round-trips the provider and the fetch date', () => {
      const out = parseDraft(text({}));
      expect(out.meta.provider).toBe('ign');
      expect(out.meta.fetched).toBe('2026-02-14');
    });

    /* A draft written before the meta carried a provider still recorded one on
       its form — that is what runBuild was handed. */
    it('recovers the provider from the form when the meta has none', () => {
      const { provider: _p, ...bare } = META;
      const form = { ...DEFAULT_FORM, provider: 'ign', tune: { ...DEFAULT_TUNABLES } };
      expect(parseDraft(text({ meta: bare, form })).meta.provider).toBe('ign');
    });

    /* An old draft genuinely does not know when its data was fetched, and the
       export omits the property rather than claiming today. */
    it('leaves the fetch date empty rather than inventing one', () => {
      const { fetched: _f, ...bare } = META;
      expect(parseDraft(text({ meta: bare })).meta.fetched).toBe('');
    });

    it('falls back to the project name when the draft has no name', () => {
      expect(parseDraft(text({ name: undefined })).name).toBe(META.ifc.projectName);
      expect(parseDraft(text({ name: 42 })).name).toBe(META.ifc.projectName);
    });

    /* With no name typed into the IFC panel either, the fallback is the same
       one the writer puts on IfcProject — so Drafts and the file agree. */
    it('falls back to the coordinates when the project name is blank too', () => {
      const meta = { ...META, ifc: newIfcMeta() };
      expect(parseDraft(text({ name: undefined, meta })).name).toBe(
        defaultProjectName(META.lat, META.lon),
      );
    });

    /* The two fields IfcMeta absorbed sat at the top of the meta before it
       existed. A site saved then has to reopen under its own name and schema. */
    it('migrates a draft that carried projectName and schema on the meta', () => {
      const { ifc: _i, ...bare } = META;
      const legacy = { ...bare, projectName: 'Older site', schema: 'IFC2X3' };
      const out = parseDraft(text({ meta: legacy })).meta.ifc;
      expect(out.projectName).toBe('Older site');
      expect(out.schema).toBe('IFC2X3');
      expect(out.author).toBe('');
    });

    it('repairs a poisoned tunable rather than rejecting the file', () => {
      const form = { ...DEFAULT_FORM, tune: { ...DEFAULT_TUNABLES, buildingCap: NaN } };
      const out = parseDraft(text({ form }));
      expect(out.form.tune.buildingCap).toBe(DEFAULT_TUNABLES.buildingCap);
      expect(Number.isFinite(out.form.tune.buildingCap)).toBe(true);
    });

    it('reads a missing form back as the defaults', () => {
      const out = parseDraft(text({ form: undefined }));
      expect(out.form.epsg).toBe(DEFAULT_FORM.epsg);
      expect(out.form.tune).toEqual(DEFAULT_TUNABLES);
    });

    it('gives every layer a state, even from a scene that named none', () => {
      const out = parseDraft(text({ scene: { ...draft().scene, layers: undefined } }));
      expect(Object.keys(out.scene.layers).length).toBeGreaterThan(0);
      for (const xf of Object.values(out.scene.layers)) {
        expect(xf).toHaveProperty('offset');
      }
    });
  });
});
