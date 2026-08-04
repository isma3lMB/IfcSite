import type { SiteRect } from '@/lib/types';

/**
 * Site rectangle arithmetic, in WGS84 degrees. Kept free of any Leaflet import
 * so it can be unit-reasoned and used from the React layer, which never loads
 * Leaflet: `boundsOf` takes {lat,lng} structurally rather than an L.LatLng.
 */

/** Metres per side. Past 2000 m Overpass and the IGN WFS start refusing. */
export const SITE_MIN = 100;
export const SITE_MAX = 2000;
export const SITE_DEFAULT = 600;

export const M_PER_LAT = 111320;
export const mPerLon = (lat: number): number => M_PER_LAT * Math.cos((lat * Math.PI) / 180);

export type LatLngLike = { lat: number; lng: number };

/**
 * SW, SE, NE, NW — opposite corner is always (i+2)%4, which is what a corner
 * drag pivots on.
 */
export const cornersOf = (b: SiteRect): [number, number][] => [
  [b.minLat, b.minLon],
  [b.minLat, b.maxLon],
  [b.maxLat, b.maxLon],
  [b.maxLat, b.minLon],
];

export const rectSize = (b: SiteRect): { w: number; h: number } => ({
  w: (b.maxLon - b.minLon) * mPerLon((b.minLat + b.maxLat) / 2),
  h: (b.maxLat - b.minLat) * M_PER_LAT,
});

export const rectCentre = (b: SiteRect): { lat: number; lon: number } => ({
  lat: (b.minLat + b.maxLat) / 2,
  lon: (b.minLon + b.maxLon) / 2,
});

export const boundsOf = (a: LatLngLike, b: LatLngLike): SiteRect => ({
  minLat: Math.min(a.lat, b.lat),
  maxLat: Math.max(a.lat, b.lat),
  minLon: Math.min(a.lng, b.lng),
  maxLon: Math.max(a.lng, b.lng),
});

export function squareAt(lat: number, lon: number, side: number = SITE_DEFAULT): SiteRect {
  const dLat = side / 2 / M_PER_LAT;
  const dLon = side / 2 / mPerLon(lat);
  return { minLat: lat - dLat, maxLat: lat + dLat, minLon: lon - dLon, maxLon: lon + dLon };
}

/**
 * Clamping has to keep whichever edge the user is not moving where it is,
 * otherwise hitting the limit drags the opposite corner along too.
 */
export function clampAxis(
  min: number,
  max: number,
  perDeg: number,
  anchor: number | null | undefined,
): [number, number, boolean] {
  const size = (max - min) * perDeg;
  const want = Math.min(SITE_MAX, Math.max(SITE_MIN, size));
  if (want === size) return [min, max, false];
  const d = want / perDeg;
  if (anchor === min) return [min, min + d, true];
  if (anchor === max) return [max - d, max, true];
  const c = (min + max) / 2;
  return [c - d / 2, c + d / 2, true];
}

/** Applies both axis clamps. Returns the rectangle and whether it was clamped. */
export function clampRect(
  r: SiteRect,
  anchor?: LatLngLike | null,
): { rect: SiteRect; clamped: boolean } {
  const midLat = (r.minLat + r.maxLat) / 2;
  const [minLat, maxLat, cy] = clampAxis(r.minLat, r.maxLat, M_PER_LAT, anchor?.lat);
  const [minLon, maxLon, cx] = clampAxis(r.minLon, r.maxLon, mPerLon(midLat), anchor?.lng);
  return { rect: { minLat, maxLat, minLon, maxLon }, clamped: cx || cy };
}
