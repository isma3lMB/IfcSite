import { describe, expect, it } from 'vitest';
import { emitIFC } from '@/lib/ifc/emit';
import { esc } from '@/lib/ifc/writer';
import { pushBuilding, pushTree } from '@/lib/scene/push';
import { DATA_SOURCES } from '@/lib/sources/licence';
import { emptyScene, newIfcMeta, type SceneData, type SiteMeta, type Vec2 } from '@/lib/types';

/* -------------------------------------------------------------------------
   ePset_License — what the export says about whose data it carries.

   OSM's ODbL and IGN's Licence Ouverte both make the credit a condition of use,
   and an IFC is a deliverable that leaves this app, so the notice has to be
   inside the file. These assert on the raw SPF text for the same reason
   crs-header.test does: what matters is what a reader on the other end actually
   receives, not what the model object thought it meant.
   ------------------------------------------------------------------------- */

const meta = (over: Partial<SiteMeta>): SiteMeta => ({
  origin: [0, 0], exportOffset: [0, 0, 0], projectBase: [0, 0, 0], projectAngle: 0,
  projectBaseFromGlobal: false,
  lat: 48.8566, lon: 2.3522,
  epsg: 'EPSG:2154', crsName: 'RGF93 / Lambert-93', geodeticDatum: 'RGF93',
  verticalDatum: null, verticalDatumEpsg: null,
  crsDef: '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs',
  ifc: { ...newIfcMeta(), projectName: 'test' },
  provider: 'osm', fetched: '2026-08-27',
  ...over,
});

const square = (x: number): Vec2[] => [
  [x, 0],
  [x + 10, 0],
  [x + 10, 10],
  [x, 10],
];

/** n sourced buildings, plus a tree, a hand-drawn footprint or terrain if asked. */
const sceneWith = (
  n: number,
  opts: { tree?: boolean; drawn?: boolean; terrain?: boolean } = {},
): SceneData => {
  const s = emptyScene();
  for (let i = 0; i < n; i++)
    pushBuilding(s, square(i * 20), 12, 'tag:height', 0, `w${i}`, `B${i}`, {
      osm_id: `way/${i}`,
    });
  if (opts.drawn)
    pushBuilding(s, square(500), 9, 'user', 0, 'drawn-1', 'Drawn 1', { Source: 'drawn' });
  if (opts.tree) pushTree(s, 5, 5, 0, 8, 3, 0.2, 't1', 'Tree 1', { osm_id: 'node/1' }, 'osm');
  // One cell of flat lattice — enough to emit a terrain element, which is the
  // only thing the elevation source is ever credited on.
  if (opts.terrain)
    s.terrain = {
      n: 1,
      verts: [
        [0, 0, 0],
        [10, 0, 0],
        [0, 10, 0],
        [10, 10, 0],
      ],
      faces: [
        [0, 1, 3],
        [0, 3, 2],
      ],
      sample: () => 0,
    };
  return s;
};

/** Every `#n` listed in the RelatedObjects of the relationship whose property
 *  set names `source` — i.e. which elements the file says that licence covers.
 *
 *  `source` goes through esc() because the writer does: "BD TOPO®" reaches the
 *  file as `BD TOPO\X2\00AE\X0\`, and a test searching for the raw character
 *  would silently find nothing and pass every emptiness assertion. */
const covered = (text: string, name: string): string[] => {
  const source = esc(name);
  const set = text.match(
    new RegExp(`#(\\d+)=IFCPROPERTYSET\\([^\\n]*'ePset_License'[^\\n]*`, 'g'),
  );
  const ps = (set ?? []).find((line) => {
    const props = line.match(/#\d+/g) ?? [];
    return props.some((ref) =>
      text.includes(`${ref}=IFCPROPERTYSINGLEVALUE('Source',$,IFCLABEL('${source}')`),
    );
  });
  if (!ps) return [];
  const id = ps.slice(0, ps.indexOf('='));
  const rel = text
    .split('\n')
    .find((l) => l.includes('IFCRELDEFINESBYPROPERTIES') && l.endsWith(`${id});`));
  return rel ? (rel.match(/\(#[\d,#]*\)/g)?.pop()?.match(/#\d+/g) ?? []) : [];
};

describe('ePset_License', () => {
  it('names OpenStreetMap and the ODbL for an OSM build', () => {
    const { text } = emitIFC(sceneWith(1), meta({}));
    expect(text).toContain("IFCPROPERTYSINGLEVALUE('Source',$,IFCLABEL('OpenStreetMap')");
    expect(text).toContain("IFCPROPERTYSINGLEVALUE('License',$,IFCLABEL('ODbL 1.0')");
    expect(text).toContain(
      "IFCPROPERTYSINGLEVALUE('LicenseUrl',$,IFCIDENTIFIER('https://www.openstreetmap.org/copyright')",
    );
  });

  /* The Licence Ouverte asks for the source AND the date of the last update of
     the information reused — that date is the whole reason SiteMeta carries a
     fetch date at all. */
  it('carries the fetch date the Licence Ouverte asks for', () => {
    const { text } = emitIFC(sceneWith(1), meta({ provider: 'ign' }));
    expect(text).toContain("IFCPROPERTYSINGLEVALUE('Retrieved',$,IFCLABEL('2026-08-27')");
    expect(text).toContain("IFCPROPERTYSINGLEVALUE('Source',$,IFCLABEL('IGN BD TOPO");
  });

  /* A draft written before the date was recorded does not know it, and a wrong
     date is a worse answer than none. */
  it('omits Retrieved rather than guessing when the date is unknown', () => {
    const { text } = emitIFC(sceneWith(1), meta({ fetched: '' }));
    expect(text).toContain("IFCLABEL('OpenStreetMap')");
    expect(text).not.toContain("'Retrieved'");
  });

  /* The case the whole per-element design exists for: BD TOPO has no individual
     trees, so an IGN build fetches them from Overpass and the file owes two
     different licences at once. */
  it('credits BD TOPO and OSM separately in one IGN file', () => {
    const s = sceneWith(2, { tree: true });
    const { text } = emitIFC(s, meta({ provider: 'ign' }));

    const ign = covered(text, 'IGN BD TOPO®');
    const osm = covered(text, 'OpenStreetMap');
    expect(ign).toHaveLength(2);
    expect(osm).toHaveLength(1);
    // Not the same elements: the buildings are IGN's, the tree is not.
    expect(ign.some((r) => osm.includes(r))).toBe(false);
  });

  it('leaves hand-drawn geometry uncredited', () => {
    const { text } = emitIFC(sceneWith(1, { drawn: true }), meta({}));
    // Two proxies in the file, one of them the user's own work.
    expect((text.match(/IFCBUILDINGELEMENTPROXY\(/g) ?? [])).toHaveLength(2);
    expect(covered(text, 'OpenStreetMap')).toHaveLength(1);
  });

  /* A water surface drawn in the 3D view is the same kind of element as a
     BD TOPO lake, and must not be credited to BD TOPO because it is one. */
  it('leaves a hand-drawn surface uncredited beside a fetched one of its layer', () => {
    const s = sceneWith(0);
    const tri = {
      verts: [
        [0, 0, 0],
        [10, 0, 0],
        [0, 10, 0],
      ] as [number, number, number][],
      faces: [[0, 1, 2]],
      type: 'WATER',
      layer: 'water' as const,
    };
    s.surfaces.push({ ...tri, name: 'Lake' });
    s.surfaces.push({ ...tri, name: 'Drawn water 1', id: 'drawn-water-1', src: 'user' });
    const { text } = emitIFC(s, meta({ provider: 'ign' }));
    expect((text.match(/IFCGEOGRAPHICELEMENT\(/g) ?? [])).toHaveLength(2);
    expect(covered(text, 'IGN BD TOPO®')).toHaveLength(1);
  });

  /* One relationship per source, not per element. RelatedObjects is a SET in
     every schema this writes, and saying the same sentence once per building
     would cost thousands of entities on a real site. */
  it('shares one relationship across every element from a source', () => {
    const { text } = emitIFC(sceneWith(12), meta({}));
    expect(covered(text, 'OpenStreetMap')).toHaveLength(12);
    // Two ePset_License sets in the file: the shared one, and the summary on
    // IfcSite.
    expect((text.match(/'ePset_License'/g) ?? [])).toHaveLength(2);
  });

  /* Readable without an IFC viewer at all — a licence notice is no use if
     reading it needs one. */
  it('states the attribution in the file header, escaped', () => {
    const { text } = emitIFC(sceneWith(1), meta({}));
    const header = text.split('\n')[2];
    expect(header).toContain('FILE_DESCRIPTION');
    expect(header).toContain('OpenStreetMap contributors');
    // © is not ASCII, so STEP spells it out.
    expect(header).toContain('\\X2\\00A9\\X0\\');
    expect(header).not.toContain('©');
  });

  /* A file with nothing sourced in it owes nobody anything, and should not
     claim otherwise. */
  it('says nothing about licences in an empty file', () => {
    const { text } = emitIFC(emptyScene(), meta({}));
    expect(text).not.toContain('ePset_License');
    expect(text.split('\n')[2]).not.toContain('OpenStreetMap');
  });

  /* IfcRoot.OwnerHistory is mandatory in IFC2X3, and a `$` there is a file
     validators reject — so the licence entities have to carry it like every
     other root does. */
  it('gives the IFC2X3 licence entities their mandatory OwnerHistory', () => {
    const { text } = emitIFC(sceneWith(1), meta({ ifc: { ...newIfcMeta(), schema: 'IFC2X3' } }));
    const owner = text.match(/(#\d+)=IFCOWNERHISTORY/)?.[1];
    expect(owner).toBeTruthy();
    for (const line of text.split('\n')) {
      if (!/=IFCPROPERTYSET\(|=IFCRELDEFINESBYPROPERTIES\(/.test(line)) continue;
      expect(line).toContain(`,${owner},`);
    }
  });

  /* The terrain tiles cite the AWS registry page, not the credit table AWS's
     own registry entry names in its License field: that document is a branch
     path in a repo dormant since 2021, and this URL is embedded in files that
     outlive the app. The github.com assertion is the regression guard — it is
     what fails if someone reinstates the deep link. */
  it('cites the terrain tiles by their registry page, not a repo path', () => {
    const { text } = emitIFC(sceneWith(1, { terrain: true }), meta({}));
    expect(text).toContain(
      "IFCPROPERTYSINGLEVALUE('LicenseUrl',$,IFCIDENTIFIER('https://registry.opendata.aws/terrain-tiles/')",
    );
    expect(text).not.toContain('github.com');
  });

  it('quotes the licence table verbatim, so the page and the file agree', () => {
    const { text } = emitIFC(sceneWith(1), meta({}));
    expect(text).toContain(DATA_SOURCES.osm.licence);
  });
});
