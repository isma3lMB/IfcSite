/**
 * Reading a latitude/longitude out of whatever the user typed into the place
 * search. Pure string work in WGS84 degrees, no Leaflet and no network — it sits
 * next to rect.ts for the same reason that one does.
 *
 * The contract that matters: this is a *filter* in front of Nominatim, so it has
 * to decline loudly rather than guess. Anything that is not unambiguously a
 * coordinate pair returns null and goes to the geocoder as free text, because a
 * wrong pin somewhere in the Atlantic is worse than a slow address lookup.
 */

export type LatLon = { lat: number; lon: number };

/** ASCII plus the typographic variants a phone keyboard or a paste will produce. */
const DEGREE = /[°º]/g;
const MINUTE = /['′’‘]/g;
const SECOND = /["″”“]|''|’’/g;
/** Spelled-out units, so `48 deg 51 min 23 sec N` reads too. */
const WORDS = /\b(?:deg(?:rees?)?|min(?:utes?)?|sec(?:onds?)?)\b/gi;

/** Only one hemisphere letter per component, at either end of it. */
const HEMI_LEAD = /^([NSEW])\s*/i;
const HEMI_TRAIL = /\s*([NSEW])$/i;

const NUM = /^\d+(?:\.\d+)?$/;

type Angle = {
  /** Always positive here; `sign` and `hemi` are applied by the caller. */
  deg: number;
  /** 'N' | 'S' | 'E' | 'W', uppercased, or null when none was written. */
  hemi: string | null;
};

/**
 * One half of a pair: an optional sign, an optional hemisphere letter at either
 * end, and one to three numbers meaning degrees / minutes / seconds.
 *
 * Symbols are stripped rather than parsed, so `48°51'23"`, `48 51 23` and
 * `48 deg 51 min 23 sec` all reduce to the same three tokens. That is only safe
 * because the pair was already split (see splitPair) — a bare `48 51` reaching
 * here is known to be one angle, not two.
 */
function parseAngle(raw: string): Angle | null {
  let s = raw.trim();
  if (!s) return null;

  let hemi: string | null = null;
  const lead = s.match(HEMI_LEAD);
  if (lead) {
    hemi = lead[1].toUpperCase();
    s = s.slice(lead[0].length);
  }
  const trail = s.match(HEMI_TRAIL);
  if (trail) {
    if (hemi) return null; // a letter at both ends is a typo, not a coordinate
    hemi = trail[1].toUpperCase();
    s = s.slice(0, s.length - trail[0].length);
  }

  let sign = 1;
  const m = s.match(/^([+-])\s*/);
  if (m) {
    if (m[1] === '-') sign = -1;
    s = s.slice(m[0].length);
  }
  // A sign and a hemisphere together contradict each other as often as they
  // agree (-48S), so refuse the combination rather than pick a winner.
  if (sign < 0 && hemi) return null;

  const parts = s
    .replace(SECOND, ' ')
    .replace(MINUTE, ' ')
    .replace(DEGREE, ' ')
    .replace(WORDS, ' ')
    .trim()
    .split(/\s+/);
  if (parts.length > 3 || !parts.every((p) => NUM.test(p))) return null;

  const [d, mi = '0', se = '0'] = parts;
  const deg = +d;
  const min = +mi;
  const sec = +se;
  // Only the last written number may carry a fraction: 48°51.4' is degrees and
  // decimal minutes, but 48.5°51' is not a form anyone means.
  if (parts.length > 1 && !Number.isInteger(deg)) return null;
  if (parts.length > 2 && !Number.isInteger(min)) return null;
  if (min >= 60 || sec >= 60) return null;

  return { deg: sign * (deg + min / 60 + sec / 3600), hemi };
}

/**
 * Two components, or nothing. A comma is the explicit separator; without one,
 * the string has to be exactly two whitespace-separated words, which is what
 * keeps `10 Downing Street` out of here.
 */
function splitPair(q: string): [string, string] | null {
  const s = q.trim().replace(/[;/|]/g, ',');
  const parts = s.includes(',') ? s.split(',') : s.split(/\s+/);
  if (parts.length !== 2) return null;
  const [a, b] = parts.map((p) => p.trim());
  return a && b ? [a, b] : null;
}

/**
 * Parses `48.8566, 2.3522`, `48.8566N 2.3522E`, `-33.87 151.21`,
 * `48°51'23"N 2°21'08"E`, `48°51.4'N 2°21.1'E` and the unpunctuated
 * `48 51 23 N, 2 21 8 E`. Latitude first unless hemisphere letters say
 * otherwise — there is deliberately no lon-first heuristic for a bare pair,
 * since `2.35, 48.85` is a real point in the Mediterranean and silently
 * swapping it would be wrong in a way the user could not see.
 *
 * Returns null for anything else, including out-of-range numbers, so the caller
 * can fall through to the geocoder.
 */
export function parseLatLon(q: string): LatLon | null {
  const pair = splitPair(q);
  if (!pair) return null;

  const a = parseAngle(pair[0]);
  const b = parseAngle(pair[1]);
  if (!a || !b) return null;

  // Two bare integers separated by a space are far more likely to be part of an
  // address than a coordinate, so they need a comma, a decimal point, a sign, a
  // hemisphere or a DMS symbol somewhere to count. With a comma, a pair of
  // numbers is unambiguous enough on its own.
  if (!q.includes(',') && !/[.+\-°º'′’"″”NSEWnsew]/.test(q)) return null;

  let lat: number;
  let lon: number;
  if (a.hemi && b.hemi) {
    const ns = a.hemi === 'N' || a.hemi === 'S' ? a : b.hemi === 'N' || b.hemi === 'S' ? b : null;
    const ew = a.hemi === 'E' || a.hemi === 'W' ? a : b.hemi === 'E' || b.hemi === 'W' ? b : null;
    if (!ns || !ew || ns === ew) return null; // NN or EE says nothing
    lat = ns.hemi === 'S' ? -ns.deg : ns.deg;
    lon = ew.hemi === 'W' ? -ew.deg : ew.deg;
  } else if (a.hemi || b.hemi) {
    return null; // one letter and not the other is a half-written coordinate
  } else {
    lat = a.deg;
    lon = b.deg;
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** Five decimals is about a metre — enough to name the point, short enough to read. */
export function formatLatLon(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}
