import { describe, expect, it } from 'vitest';
import { emitIFC } from '@/lib/ifc/emit';
import { VERTICAL_DATUMS } from '@/lib/geo/vertical';
import { emptyScene, newIfcMeta, type SiteMeta } from '@/lib/types';

/**
 * What the georeferencing header says, per data source.
 *
 * The scene is empty on purpose: this is about IfcProjectedCRS and the IFC2X3
 * property set that stands in for it, not about geometry. The build that fills a
 * scene needs Overpass and a DEM, and neither belongs in a unit test.
 */
const meta = (over: Partial<SiteMeta>): SiteMeta => ({
  origin: [0, 0], exportOffset: [0, 0, 0], projectBase: [0, 0, 0], projectAngle: 0,
  lat: 41.3874, lon: 2.1686,
  epsg: 'EPSG:25831', crsName: 'ETRS89 / UTM zone 31N', geodeticDatum: 'ETRS89',
  verticalDatum: null, verticalDatumEpsg: null,
  crsDef: '+proj=utm +zone=31 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
  ifc: { ...newIfcMeta(), projectName: 'test' },
  provider: 'osm', fetched: '2026-01-01',
  ...over,
});

describe('IfcProjectedCRS', () => {
  it('cites the registry code for a Terrarium site, not the datum name', () => {
    const { text } = emitIFC(emptyScene(), meta({
      verticalDatum: VERTICAL_DATUMS.osm.name,
      verticalDatumEpsg: VERTICAL_DATUMS.osm.epsg,
    }));
    expect(text).toContain(
      "IFCPROJECTEDCRS('EPSG:25831','ETRS89 / UTM zone 31N','ETRS89','EPSG:5773'",
    );
  });

  it('cites NGF-IGN69 by code for an IGN site', () => {
    const { text } = emitIFC(emptyScene(), meta({
      epsg: 'EPSG:2154', crsName: 'RGF93 / Lambert-93', geodeticDatum: 'RGF93',
      crsDef: '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs',
      verticalDatum: VERTICAL_DATUMS.ign.name,
      verticalDatumEpsg: VERTICAL_DATUMS.ign.epsg,
    }));
    expect(text).toContain(
      "IFCPROJECTEDCRS('EPSG:2154','RGF93 / Lambert-93','RGF93','EPSG:5720'",
    );
  });

  /* No altimetry means no vertical datum to declare — naming one would be a
     claim nothing in the file supports. */
  it('leaves VerticalDatum unset on a flat site', () => {
    const { text } = emitIFC(emptyScene(), meta({}));
    expect(text).toContain("IFCPROJECTEDCRS('EPSG:25831','ETRS89 / UTM zone 31N','ETRS89',$");
  });

  /* IFC2X3 has neither entity, so the same statement goes on IfcSite as the
     pset the buildingSMART georeferencing guidance defines. */
  it('carries the same code through the IFC2X3 property set', () => {
    const { text } = emitIFC(emptyScene(), meta({
      ifc: { ...newIfcMeta(), schema: 'IFC2X3' },
      verticalDatum: VERTICAL_DATUMS.osm.name,
      verticalDatumEpsg: VERTICAL_DATUMS.osm.epsg,
    }));
    expect(text).toContain("IFCPROPERTYSINGLEVALUE('VerticalDatum',$,IFCLABEL('EPSG:5773')");
    expect(text).toContain("IFCPROPERTYSINGLEVALUE('Name',$,IFCLABEL('EPSG:25831')");
  });
});

/* -------------------------------------------------------------------------
   Which root the IFC2X3 property sets land on.

   The convention settles the two names and not the host, and readers disagree
   about where they look — so the target is a setting, and these are the three
   answers it can give. Read off the relationship rather than off the pset: the
   properties are identical in all three cases, and the only thing that moves is
   RelatedObjects.
   ------------------------------------------------------------------------- */

const x3 = (georefTarget: 'site' | 'project' | 'both'): string =>
  emitIFC(emptyScene(), meta({ ifc: { ...newIfcMeta(), schema: 'IFC2X3', georefTarget } })).text;

/** The `#n` of the file's one IFCPROJECT or IFCSITE. `=IFCPROJECT(` with the
 *  paren, so IFCPROJECTEDCRS cannot answer for it. */
const ref = (text: string, type: 'IFCPROJECT' | 'IFCSITE'): string => {
  const line = text.split('\n').find((l) => l.includes(`=${type}(`));
  expect(line, `the file has one ${type}`).toBeTruthy();
  return (line as string).slice(0, (line as string).indexOf('='));
};

/** The RelatedObjects of the relationship attaching the named property set,
 *  as entity refs. */
const hosts = (text: string, name: string): string[] => {
  const lines = text.split('\n');
  const ps = lines.find((l) => l.includes('=IFCPROPERTYSET(') && l.includes(`'${name}'`));
  expect(ps, `${name} is in the file`).toBeTruthy();
  const id = (ps as string).slice(0, (ps as string).indexOf('='));
  const rel = lines.find(
    (l) => l.includes('=IFCRELDEFINESBYPROPERTIES(') && l.endsWith(`,${id});`),
  );
  expect(rel, `${name} is attached to something`).toBeTruthy();
  const m = (rel as string).match(/,\((#[\d,#]*)\),#\d+\);$/);
  expect(m, `${name}'s relationship lists RelatedObjects`).toBeTruthy();
  return (m as RegExpMatchArray)[1].split(',');
};

describe('the IFC2X3 georeferencing target', () => {
  /* The default, and what the writer did before there was anything to choose. */
  it('puts both property sets on IfcSite by default', () => {
    const text = x3('site');
    const site = ref(text, 'IFCSITE');
    expect(hosts(text, 'ePset_ProjectedCRS')).toEqual([site]);
    expect(hosts(text, 'ePset_MapConversion')).toEqual([site]);
  });

  it('moves both to IfcProject when asked', () => {
    const text = x3('project');
    const project = ref(text, 'IFCPROJECT');
    expect(hosts(text, 'ePset_ProjectedCRS')).toEqual([project]);
    expect(hosts(text, 'ePset_MapConversion')).toEqual([project]);
  });

  /* One property set on two roots, not two copies of it: RelatedObjects is a
     SET, which is the whole reason "both" costs a relationship and not a file. */
  it('lists both roots on one relationship each for "both"', () => {
    const text = x3('both');
    const both = [ref(text, 'IFCSITE'), ref(text, 'IFCPROJECT')];
    expect(hosts(text, 'ePset_ProjectedCRS')).toEqual(both);
    expect(hosts(text, 'ePset_MapConversion')).toEqual(both);
    for (const name of ['ePset_ProjectedCRS', 'ePset_MapConversion']) {
      const sets = text
        .split('\n')
        .filter((l) => l.includes('=IFCPROPERTYSET(') && l.includes(`'${name}'`));
      expect(sets).toHaveLength(1);
    }
  });

  /* IFC4 has IfcMapConversion, which names its own source context — the setting
     is not consulted, and no ePset_ is written whatever it says. */
  it('is ignored under a schema that has IfcMapConversion', () => {
    const { text } = emitIFC(
      emptyScene(),
      meta({ ifc: { ...newIfcMeta(), schema: 'IFC4', georefTarget: 'project' } }),
    );
    expect(text).toContain('IFCMAPCONVERSION(');
    expect(text).not.toContain('ePset_MapConversion');
    expect(text).not.toContain('ePset_ProjectedCRS');
  });
});
