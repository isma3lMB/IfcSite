import { describe, expect, it } from 'vitest';
import { emitIFC } from '@/lib/ifc/emit';
import {
  APPLICATION_NAME,
  APPLICATION_VERSION,
  ifcFileName,
  ORIGINATING_SYSTEM,
  SOFTWARE_COMPANY,
} from '@/lib/ifc/writer';
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

const header = (text: string, kind: 'FILE_NAME' | 'FILE_DESCRIPTION'): string =>
  text.split('\n').find((l) => l.startsWith(kind)) as string;

/** FILE_NAME's seven attributes, split on the top-level commas. */
const fileNameAttrs = (text: string): string[] => {
  const body = header(text, 'FILE_NAME').replace(/^FILE_NAME\(/, '').replace(/\);$/, '');
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = '';
  for (const c of body) {
    if (c === "'") inStr = !inStr;
    if (!inStr && c === '(') depth++;
    if (!inStr && c === ')') depth--;
    if (!inStr && depth === 0 && c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
};

describe('authorship', () => {
  it('carries the typed author and organisation in the header', () => {
    const { text } = emitIFC(emptyScene(), meta({ author: 'A. Perret', organization: 'Atelier X' }));
    expect(header(text, 'FILE_NAME')).toContain("('A. Perret'),('Atelier X')");
  });

  it('leaves both lists empty when nobody is named — never the vendor', () => {
    const { text } = emitIFC(emptyScene(), meta());
    const [, , author, organization] = fileNameAttrs(text);
    expect(author).toBe("('')");
    expect(organization).toBe("('')");
  });

  /* buildingSMART's header rules: `Company - Application - Version`, a space
     either side of each dash, no dash inside a name, a PEP 440 version. */
  it('writes originating_system in the three-part form the validators parse', () => {
    const attrs = fileNameAttrs(emitIFC(emptyScene(), meta()).text);
    const originating = attrs[5];
    expect(originating).toBe("'" + ORIGINATING_SYSTEM + "'");
    expect(ORIGINATING_SYSTEM).toMatch(/^[^-]+ - [^-]+ - \d+(\.\d+)*$/);
    expect(ORIGINATING_SYSTEM).toBe(
      `${SOFTWARE_COMPANY} - ${APPLICATION_NAME} - ${APPLICATION_VERSION}`,
    );
    expect(attrs[4]).toBe(`'${APPLICATION_NAME} ${APPLICATION_VERSION}'`);
  });

  it('names itself in the header as the download is named', () => {
    const m = meta();
    expect(fileNameAttrs(emitIFC(emptyScene(), m).text)[0]).toBe(`'${ifcFileName(m)}'`);
  });

  /* Someone who types their name expects it in the file whatever the schema, so
     an author is the second reason a file carries an owner history. */
  it('emits an owner history under IFC4 once an author is named', () => {
    const { text } = emitIFC(emptyScene(), meta({ author: 'A. Perret' }));
    expect(text).toContain('IFCOWNERHISTORY');
    // FamilyName, the second attribute — no given name is invented.
    expect(text).toContain("IFCPERSON($,'A. Perret',$,$,$,$,$,$)");
    expect(text).toContain("IFCORGANIZATION($,'" + SOFTWARE_COMPANY + "',$,$,$)");
    expect(text).toContain(
      `'${APPLICATION_VERSION}','${APPLICATION_NAME}','IFCSITE')`,
    );
  });

  /* The user's firm and the vendor are two IfcOrganizations: the first owns
     the data, the second developed the application. */
  it('keeps the user organisation apart from the software developer', () => {
    const { text } = emitIFC(emptyScene(), meta({ organization: 'Atelier X' }));
    expect(text).toContain('IFCOWNERHISTORY');
    expect(text).toContain("IFCORGANIZATION($,'Atelier X',$,$,$)");
    expect(text).toContain("IFCORGANIZATION($,'" + SOFTWARE_COMPANY + "',$,$,$)");
  });

  /* IfcOwnerHistory.CorrectChangeAction (IFC4): .ADDED. is only allowed beside
     a LastModifiedDate, so the file writes one, equal to its creation date. */
  it('pairs ChangeAction .ADDED. with a LastModifiedDate', () => {
    for (const schema of ['IFC2X3', 'IFC4', 'IFC4X3'] as const) {
      const { text } = emitIFC(emptyScene(), meta({ schema, author: 'A. Perret' }));
      const line = text.split('\n').find((l) => l.includes('=IFCOWNERHISTORY(')) as string;
      const m = line.match(/,\.ADDED\.,(\d+),\$,\$,(\d+)\);$/);
      expect(m).toBeTruthy();
      expect(m![1]).toBe(m![2]);
    }
  });

  it('writes no owner history under IFC4 with both fields blank', () => {
    expect(emitIFC(emptyScene(), meta()).text).not.toContain('IFCOWNERHISTORY');
  });

  /* IFC2X3 always carries an owner history, and there an unnamed IfcPerson
     breaks WR1 and an unnamed IfcOrganization a mandatory attribute. */
  it('names every person and organisation under IFC2X3, even left blank', () => {
    const { text } = emitIFC(emptyScene(), meta({ schema: 'IFC2X3' }));
    expect(text).toContain('IFCOWNERHISTORY');
    expect(text).not.toMatch(/IFCPERSON\(\$,\$/);
    expect(text).not.toMatch(/IFCORGANIZATION\(\$,\$/);
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
    // IFC4X3 is written under the released schema's own name.
    const token = { IFC2X3: 'IFC2X3', IFC4: 'IFC4', IFC4X3: 'IFC4X3_ADD2' } as const;
    for (const schema of ['IFC2X3', 'IFC4', 'IFC4X3'] as const) {
      expect(emitIFC(emptyScene(), meta({ schema })).text).toContain(
        `FILE_SCHEMA(('${token[schema]}'));`,
      );
    }
  });

  /* An official MVD for each schema, or the validator reads the view as unknown. */
  it('names an official ViewDefinition for the schema', () => {
    const views = { IFC2X3: 'CoordinationView_V2.0', IFC4: 'ReferenceView_V1.2', IFC4X3: 'ReferenceView' };
    for (const [schema, view] of Object.entries(views) as [keyof typeof views, string][]) {
      expect(header(emitIFC(emptyScene(), meta({ schema })).text, 'FILE_DESCRIPTION')).toContain(
        `'ViewDefinition [${view}]'`,
      );
    }
  });
});
