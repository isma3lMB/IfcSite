import { describe, expect, it } from 'vitest';
import { emitIFC } from '@/lib/ifc/emit';
import { APPLICATION, ORGANISATION } from '@/lib/ifc/writer';
import { emptyScene, newIfcMeta, type IfcMeta, type SiteMeta } from '@/lib/types';

/* -------------------------------------------------------------------------
   IfcMeta — the attributes the export panel types into the file.

   On the raw SPF text, for the reason crs-header.test gives: what matters is
   what a reader on the other end receives, not what the model object thought it
   meant. The scene is empty throughout — none of this is geometry.

   The first test is the important one. Every field here is optional and empty by
   default, and the whole promise of that is that a panel nobody has touched
   writes the file this wrote before the panel existed.
   ------------------------------------------------------------------------- */

const meta = (ifc: Partial<IfcMeta> = {}): SiteMeta => ({
  origin: [0, 0],
  exportOffset: [0, 0, 0],
  projectBase: [0, 0, 0],
  projectAngle: 0,
  projectBaseFromGlobal: false,
  lat: 48.8566,
  lon: 2.3522,
  epsg: 'EPSG:2154',
  crsName: 'RGF93 / Lambert-93',
  geodeticDatum: 'RGF93',
  verticalDatum: null,
  verticalDatumEpsg: null,
  crsDef:
    '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs',
  ifc: { ...newIfcMeta(), ...ifc },
  provider: 'osm',
  fetched: '2026-08-27',
});

/** The one IFCPROJECT or IFCSITE line, with its `#id=` prefix and its GlobalId
 *  dropped — both are fresh random values on every emit. */
const entity = (text: string, type: 'IFCPROJECT' | 'IFCSITE'): string => {
  const line = text.split('\n').find((l) => l.includes(`=${type}(`));
  expect(line).toBeTruthy();
  return (line as string).replace(/^#\d+=/, '').replace(/\('[^']{22}',/, '(');
};

describe('an untouched bag', () => {
  it('names the project after the site, as the writer always did', () => {
    // Applied at write time, so moving the site moves the name with it.
    expect(entity(emitIFC(emptyScene(), meta()).text, 'IFCPROJECT')).toContain(
      "$,'Context 48.8566, 2.3522',$,$,$,$,",
    );
  });

  it('leaves IfcSite named Site, with every optional attribute unset', () => {
    const site = entity(emitIFC(emptyScene(), meta()).text, 'IFCSITE');
    // Name, Description, ObjectType, then the placement — and LongName back at $.
    expect(site).toContain("$,'Site',$,$,#");
    // LandTitleNumber and SiteAddress, the last two attributes.
    expect(site.endsWith('$,$);')).toBe(true);
  });

  /* IFC4 made IfcRoot.OwnerHistory optional and this file left it out. With
     nobody named there is still nothing honest to put in it. */
  it('writes no owner history under IFC4', () => {
    expect(emitIFC(emptyScene(), meta()).text).not.toContain('IFCOWNERHISTORY');
  });

  it('still writes one under IFC2X3, where the schema demands it', () => {
    expect(emitIFC(emptyScene(), meta({ schema: 'IFC2X3' })).text).toContain('IFCOWNERHISTORY');
  });
});

describe('the project and site attributes', () => {
  const typed: Partial<IfcMeta> = {
    projectName: 'Gare du Nord',
    projectLongName: 'Gare du Nord — context massing',
    projectDescription: 'LOD100 surroundings',
    projectPhase: 'Concept',
    siteName: 'Rue de Dunkerque',
    siteLongName: '18 rue de Dunkerque, 75010 Paris',
    siteDescription: 'Northern parcel',
    siteLandTitle: 'AB-0142',
  };

  it('lands each project field in its own slot', () => {
    const line = entity(emitIFC(emptyScene(), meta(typed)).text, 'IFCPROJECT');
    // Name, Description, ObjectType, LongName, Phase — attributes 3 to 7.
    expect(line).toContain(
      "$,'Gare du Nord','LOD100 surroundings',$," +
        "'Gare du Nord \\X2\\2014\\X0\\ context massing','Concept',",
    );
  });

  it('lands each site field in its own slot', () => {
    const line = entity(emitIFC(emptyScene(), meta(typed)).text, 'IFCSITE');
    expect(line).toContain("$,'Rue de Dunkerque','Northern parcel',$,#");
    expect(line).toContain("'18 rue de Dunkerque, 75010 Paris',.ELEMENT.");
    // LandTitleNumber, then SiteAddress still unset.
    expect(line.endsWith("'AB-0142',$);")).toBe(true);
  });

  /* A blank field is not an empty string: `''` in Description is a claim that
     the description is empty, which is not the same as saying nothing. */
  it('omits a field that has been typed into and cleared again', () => {
    const line = entity(emitIFC(emptyScene(), meta({ projectPhase: '' })).text, 'IFCPROJECT');
    expect(line).not.toContain("'',");
  });
});

describe('authorship', () => {
  it('carries the author and the fixed organisation in the header', () => {
    const { text } = emitIFC(emptyScene(), meta({ author: 'A. Perret' }));
    const fileName = text.split('\n').find((l) => l.startsWith('FILE_NAME')) as string;
    expect(fileName).toContain("('A. Perret'),('" + ORGANISATION + "')");
    // preprocessor_version and originating_system, both the tool.
    expect(fileName).toContain("'" + APPLICATION + "','" + APPLICATION + "',''");
  });

  it('leaves the author list empty when nobody is named', () => {
    const { text } = emitIFC(emptyScene(), meta());
    expect(text.split('\n').find((l) => l.startsWith('FILE_NAME'))).toContain("(''),('bim-lane')");
  });

  /* Someone who types their name expects it in the file whatever the schema, so
     an author is the second reason a file carries an owner history. */
  it('emits an owner history under IFC4 once an author is named', () => {
    const { text } = emitIFC(emptyScene(), meta({ author: 'A. Perret' }));
    expect(text).toContain('IFCOWNERHISTORY');
    // FamilyName, the second attribute — no given name is invented.
    expect(text).toContain("IFCPERSON($,'A. Perret',$,$,$,$,$,$)");
    expect(text).toContain("IFCORGANIZATION($,'" + ORGANISATION + "',$,$,$)");
    expect(text).toContain("IFCAPPLICATION(#");
    expect(text).toContain("'" + APPLICATION + "','IFCSITE')");
  });

  /* ISO-10303-21 string literals are ASCII, and an author is at least as likely
     to carry an accent as the attribution lines the same escape was built for. */
  it('escapes a non-ASCII author rather than writing raw UTF-8', () => {
    const { text } = emitIFC(emptyScene(), meta({ author: 'Émile' }));
    expect(text).toContain("('\\X2\\00C9\\X0\\mile')");
    expect(text).not.toContain('Émile');
  });
});

describe('the schema', () => {
  it('is what FILE_SCHEMA reports', () => {
    for (const schema of ['IFC2X3', 'IFC4', 'IFC4X3'] as const) {
      expect(emitIFC(emptyScene(), meta({ schema })).text).toContain(
        `FILE_SCHEMA(('${schema}'));`,
      );
    }
  });
});
