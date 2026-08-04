export type CrsDef = {
  def: string;
  name: string;
  datum: string;
  vert: string | null;
};

export type ResolvedCrs = CrsDef & { epsg: string };

export const CRS_DEFS: Record<string, CrsDef> = {
  '2154': {
    def: '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs',
    name: 'RGF93 / Lambert-93',
    datum: 'RGF93',
    vert: 'NGF-IGN69',
  },
  '27700': {
    def: '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs',
    name: 'OSGB36 / British National Grid',
    datum: 'OSGB36',
    vert: 'ODN',
  },
  '25832': {
    def: '+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs',
    name: 'ETRS89 / UTM zone 32N',
    datum: 'ETRS89',
    vert: 'DHHN2016',
  },
  '28992': {
    def: '+proj=sterea +lat_0=52.1561605555556 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.417,50.3319,465.552,-0.398957,0.343988,-1.8774,4.0725 +units=m +no_defs',
    name: 'Amersfoort / RD New',
    datum: 'Amersfoort',
    vert: 'NAP',
  },
};

/** Selectable CRS values. 'auto' derives a UTM zone from the site centre. */
export const EPSG_CHOICES = ['2154', 'auto', '27700', '25832', '28992'] as const;

export function resolveCRS(sel: string, lat: number, lon: number): ResolvedCrs {
  if (sel !== 'auto') return { epsg: 'EPSG:' + sel, ...CRS_DEFS[sel] };
  const zone = Math.floor((lon + 180) / 6) + 1;
  const south = lat < 0;
  return {
    epsg: 'EPSG:' + ((south ? 32700 : 32600) + zone),
    def: `+proj=utm +zone=${zone}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`,
    name: `WGS 84 / UTM zone ${zone}${south ? 'S' : 'N'}`,
    datum: 'WGS84',
    vert: null,
  };
}
