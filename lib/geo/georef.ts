import proj4 from 'proj4';
import type { SiteMeta, Vec2 } from '@/lib/types';

/**
 * Where model (0,0,0) is on the map, and which way the model's axes point.
 *
 * Shared by the two writers — IfcMapConversion in lib/ifc/writer and the scene
 * extras in lib/gltf/emit — so the two deliverables cannot disagree about where
 * the same model sits. The reasoning behind each number is written out where
 * the IFC states it, which is the file with an entity for every one of them.
 */
export type MapPlacement = {
  /** Map coordinates of model (0,0,0). */
  eastings: number;
  northings: number;
  /** Elevation above the vertical datum of model z = 0. */
  orthogonalHeight: number;
  /** The model's +X in map coordinates: (cos, sin) of the project angle. */
  xAxisAbscissa: number;
  xAxisOrdinate: number;
  /** The origin marker in WGS84 — informational, like IfcSite's RefLatitude.
   *  Not model zero: the project base can put that elsewhere. */
  markerLat: number;
  markerLon: number;
};

/**
 * Site coordinates p become model coordinates q as q = R(-th)·(p - off) + base,
 * where off is the origin marker and base/th the project placement — see the
 * local project coordinate system in ContextModel.
 */
export function mapPlacementOf(o: SiteMeta): MapPlacement {
  const off = o.exportOffset;
  const base = o.projectBase;
  const th = (o.projectAngle * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);

  /* The marker's map position is the site origin plus its offset — projectBase
     and projectAngle rename coordinates rather than move the point. A
     hand-edited draft can carry a definition proj4 rejects, and a bad
     informational attribute must not cost the whole export, so that falls back
     to the site centre, which is where the marker starts anyway. */
  let markerLon = o.lon;
  let markerLat = o.lat;
  try {
    const g = proj4(o.crsDef, 'EPSG:4326', [o.origin[0] + off[0], o.origin[1] + off[1]]) as Vec2;
    if (Number.isFinite(g[0]) && Number.isFinite(g[1])) [markerLon, markerLat] = g;
  } catch {
    /* keep the site centre */
  }

  return {
    eastings: o.origin[0] + off[0] - (base[0] * cos - base[1] * sin),
    northings: o.origin[1] + off[1] - (base[0] * sin + base[1] * cos),
    orthogonalHeight: off[2] - base[2],
    xAxisAbscissa: cos,
    xAxisOrdinate: sin,
    markerLat,
    markerLon,
  };
}
