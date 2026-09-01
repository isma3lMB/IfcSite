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
