import { DEFAULT_TUNABLES, TUNE_RANGE } from '@/lib/build/tunables';
import type { SiteRect } from '@/lib/types';

/**
 * Site rectangle arithmetic, in WGS84 degrees. Kept free of any Leaflet import
 * so it can be unit-reasoned and used from the React layer, which never loads
 * Leaflet: `boundsOf` takes {lat,lng} structurally rather than an L.LatLng.
 */

/**
 * Metres per side. Past 2000 m Overpass and the IGN WFS start refusing — which
 * is why SITE_MAX is only the default ceiling now that the options panel can
 * raise it: the services are the real limit, and how close to it you want to
 * sail is a judgement the panel hands back to you. Both clamps below take the
 * live ceiling as a defaulted argument.
 */
export const SITE_MIN = 100;
export const SITE_MAX = DEFAULT_TUNABLES.siteMax;
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

/* ---------------------------------------------------------------------------
   Containment, difference and padding. Used by the session cache in
   lib/sources/cache to decide whether an area already fetched answers the one
   being asked for, and how much wider than the request to fetch. Pure rectangle
   arithmetic, so it lives here with the rest of it rather than in the cache.
   --------------------------------------------------------------------------- */

/**
 * Degrees of slack on a containment test — about a centimetre of latitude.
 *
 * Exact equality is not on offer: the same rectangle reached through a Leaflet
 * drag, through `squareAt`, and through `clampAxis` differs in the last bits.
 * A centimetre is four orders of magnitude below the positional accuracy of
 * anything either provider ships, so a rectangle that contains another to
 * within it contains it.
 */
export const RECT_EPS = 1e-7;

export const containsRect = (outer: SiteRect, inner: SiteRect): boolean =>
  outer.minLat <= inner.minLat + RECT_EPS &&
  outer.maxLat >= inner.maxLat - RECT_EPS &&
  outer.minLon <= inner.minLon + RECT_EPS &&
  outer.maxLon >= inner.maxLon - RECT_EPS;

export const sameRect = (a: SiteRect, b: SiteRect): boolean =>
  containsRect(a, b) && containsRect(b, a);

export const overlapsRect = (a: SiteRect, b: SiteRect): boolean =>
  a.minLat < b.maxLat && a.maxLat > b.minLat && a.minLon < b.maxLon && a.maxLon > b.minLon;

/** Square degrees. Only ever compared against another figure from this same
 *  function at the same latitude, so the cosine is left out on purpose. */
export const rectArea = (b: SiteRect): number =>
  (b.maxLat - b.minLat) * (b.maxLon - b.minLon);

/**
 * `b` minus `a`, as up to four axis-aligned rectangles: the strip of `b` above
 * `a`, the strip below, then what is left of the middle band to `a`'s west and
 * east.
 *
 * `[]` when `a` already contains `b`, and `[b]` when they are disjoint. The
 * count is what the cache reads: one piece means `a` spans `b` on an axis, which
 * is the pan-sideways and grow-one-edge case, and the only shape where fetching
 * the remainder beats fetching the whole thing again.
 */
export function subtractRect(b: SiteRect, a: SiteRect): SiteRect[] {
  if (containsRect(a, b)) return [];
  if (!overlapsRect(a, b)) return [b];

  const out: SiteRect[] = [];
  const midMin = Math.max(b.minLat, a.minLat);
  const midMax = Math.min(b.maxLat, a.maxLat);

  if (b.maxLat > midMax + RECT_EPS) out.push({ ...b, minLat: midMax });
  if (b.minLat < midMin - RECT_EPS) out.push({ ...b, maxLat: midMin });
  if (b.minLon < a.minLon - RECT_EPS)
    out.push({
      minLat: midMin,
      maxLat: midMax,
      minLon: b.minLon,
      maxLon: Math.min(b.maxLon, a.minLon),
    });
  if (b.maxLon > a.maxLon + RECT_EPS)
    out.push({
      minLat: midMin,
      maxLat: midMax,
      minLon: Math.max(b.minLon, a.maxLon),
      maxLon: b.maxLon,
    });
  return out;
}

/**
 * The side length past which Overpass and the IGN WFS start refusing.
 *
 * Read off the top of the siteMax slider rather than written down again: that
 * ceiling is already pinned to what the services will take (see SITE_MAX above
 * and TUNE_RANGE in lib/build/tunables), and a padded box must not be able to go
 * somewhere a drawn one may not.
 *
 * Deliberately not `tune.siteMax` itself. That is a preference about the
 * rectangle you may draw next — tunables says so in as many words — and clamping
 * a fetch against it would switch padding off entirely for someone who tightened
 * the slider to 500 m, for no reason either service cares about.
 */
export const SERVICE_MAX = TUNE_RANGE.siteMax[1];

/** Fraction of the longer side added to each edge of a cached fetch. */
export const PAD_FRAC = 0.1;
/** Below this a margin buys nothing; above it the area stops paying for itself. */
export const PAD_MIN = 40;
export const PAD_MAX = 150;

/** How far outside the drawn rectangle to fetch, in metres per edge. */
export const padMetres = (r: SiteRect): number => {
  const { w, h } = rectSize(r);
  return Math.min(PAD_MAX, Math.max(PAD_MIN, PAD_FRAC * Math.max(w, h)));
};

/**
 * Grows every edge by `metres`, then walks the margin back uniformly if that
 * would push either side past `maxSide`.
 *
 * A rectangle already at or over the ceiling comes back untouched rather than
 * shrunk: the user drew it, and a cache is not the place to refuse it. The
 * degradation is the right one — at the maximum side there is no margin, so the
 * cache can still answer an exact or contained repeat and simply cannot absorb
 * a nudge.
 */
export function padRect(r: SiteRect, metres: number, maxSide: number = SERVICE_MAX): SiteRect {
  const midLat = (r.minLat + r.maxLat) / 2;
  const { w, h } = rectSize(r);
  // One margin for both axes, shrunk to whichever axis runs out of room first,
  // so the padded rectangle keeps the aspect of what was drawn.
  const room = Math.min(maxSide - w, maxSide - h) / 2;
  const m = Math.min(metres, room);
  if (m <= 0) return r;
  const dLat = m / M_PER_LAT;
  const dLon = m / mPerLon(midLat);
  return {
    minLat: r.minLat - dLat,
    maxLat: r.maxLat + dLat,
    minLon: r.minLon - dLon,
    maxLon: r.maxLon + dLon,
  };
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
  maxSide: number = SITE_MAX,
): [number, number, boolean] {
  const size = (max - min) * perDeg;
  const want = Math.min(maxSide, Math.max(SITE_MIN, size));
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
  maxSide: number = SITE_MAX,
): { rect: SiteRect; clamped: boolean } {
  const midLat = (r.minLat + r.maxLat) / 2;
  const [minLat, maxLat, cy] = clampAxis(r.minLat, r.maxLat, M_PER_LAT, anchor?.lat, maxSide);
  const [minLon, maxLon, cx] = clampAxis(r.minLon, r.maxLon, mPerLon(midLat), anchor?.lng, maxSide);
  return { rect: { minLat, maxLat, minLon, maxLon }, clamped: cx || cy };
}
