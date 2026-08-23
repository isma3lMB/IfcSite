import { AppError } from '@/lib/errors';
import { findRecord, loadEpsgIndex, toCrsDef } from '@/lib/geo/epsg';

/**
 * A projected CRS as the pipeline needs it: a proj4 definition, and the two
 * names IfcProjectedCRS asks for.
 *
 * There is no vertical datum here. A projected CRS is two-dimensional — EPSG
 * publishes none — and the datum the heights are actually in belongs to whatever
 * produced them, which is the DEM, not the grid. It lives in ./vertical, and
 * runBuild is what puts the two together.
 */
export type CrsDef = {
  def: string;
  name: string;
  datum: string;
};

export type ResolvedCrs = CrsDef & { epsg: string };

/**
 * Hand-written definitions, consulted before the generated index.
 *
 * Two reasons they stay. EPSG publishes 27700 with a +nadgrids= NTv2 file that
 * proj4js cannot load, so British National Grid is only usable at all through
 * the +towgs84 form below — the index generator drops the published one. And
 * keeping the other three means files exported before the index existed still
 * come out byte-identical.
 */
export const CRS_DEFS: Record<string, CrsDef> = {
  '2154': {
    def: '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs',
    name: 'RGF93 / Lambert-93',
    datum: 'RGF93',
  },
  '27700': {
    def: '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs',
    name: 'OSGB36 / British National Grid',
    datum: 'OSGB36',
  },
  '25832': {
    def: '+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs',
    name: 'ETRS89 / UTM zone 32N',
    datum: 'ETRS89',
  },
  '28992': {
    def: '+proj=sterea +lat_0=52.1561605555556 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.417,50.3319,465.552,-0.398957,0.343988,-1.8774,4.0725 +units=m +no_defs',
    name: 'Amersfoort / RD New',
    datum: 'Amersfoort',
  },
};

/** Offered before a rectangle exists, when there is nowhere to look CRSs up for. */
export const EPSG_CHOICES = ['auto', '2154', '27700', '25832', '28992'] as const;

/** The UTM zone containing the site, as WGS 84. Always available, everywhere,
 *  without the index — which is why it stays the fallback and the default. */
export function resolveAuto(lat: number, lon: number): ResolvedCrs {
  const zone = Math.floor((lon + 180) / 6) + 1;
  const south = lat < 0;
  return {
    epsg: 'EPSG:' + ((south ? 32700 : 32600) + zone),
    def: `+proj=utm +zone=${zone}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`,
    name: `WGS 84 / UTM zone ${zone}${south ? 'S' : 'N'}`,
    datum: 'WGS84',
  };
}

/**
 * The definition to project through, from whatever the form holds.
 *
 * Async only because of the last branch: any of four thousand codes may be
 * selected, and the index that describes them is fetched. By the time a build
 * runs it is already in memory — the picker had to load it to offer the code —
 * so this awaits a resolved promise in practice.
 */
export async function resolveCRS(sel: string, lat: number, lon: number): Promise<ResolvedCrs> {
  if (sel === 'auto') return resolveAuto(lat, lon);
  const curated = CRS_DEFS[sel];
  if (curated) return { epsg: 'EPSG:' + sel, ...curated };

  let rec;
  try {
    rec = findRecord(await loadEpsgIndex(), sel);
  } catch {
    throw new AppError('err.crsIndexUnavailable');
  }
  if (!rec) throw new AppError('err.crsUnknown', { epsg: 'EPSG:' + sel });
  return { epsg: 'EPSG:' + sel, ...toCrsDef(rec) };
}
