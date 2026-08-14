/**
 * Generates public/epsg.json — the location-aware CRS index the picker reads.
 *
 * Run it by hand (`npm run epsg`) and commit the result. It is deliberately not
 * wired into `next build`: the output changes only when the EPSG registry does,
 * and a static export should not depend on a 16 MB devDependency being present.
 *
 * The filtering is where the value is. epsg-index publishes what EPSG says, and
 * a good half of that cannot be used correctly by proj4js in a browser. Shipping
 * those anyway would not fail — it would convert, silently, and be wrong by
 * anything from a metre to half a kilometre, in a file whose whole purpose is to
 * say where something is. Every rule below drops a class we cannot honour rather
 * than passing the problem downstream.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import proj4 from 'proj4';
import { CRS_DEFS } from '../lib/geo/crs';

const root = fileURLToPath(new URL('..', import.meta.url));
const SRC = root + 'node_modules/epsg-index/all.json';
const OUT = root + 'public/epsg.json';

/**
 * Codes carrying a hand-tuned definition in lib/geo/crs.ts. Those are written
 * into the file in place of the published ones, so a record is usable on its own
 * terms and the file has no definition in it that proj4js cannot run.
 *
 * 27700 is why this exists: EPSG publishes British National Grid with a
 * +nadgrids= file the browser cannot load, and rule 3 would otherwise drop it.
 */
const curatedDef = (code: number): string | undefined => CRS_DEFS[String(code)]?.def;

type Source = {
  code: string;
  kind: string;
  name: string;
  proj4: string | null;
  bbox: [number, number, number, number] | null; // N, W, S, E
  unit: string | null;
  area: string | null;
  accuracy: number | null;
};

/** One CRS, with short keys: these names repeat four thousand times. */
type CrsRecord = {
  c: number; // EPSG code
  n: string; // "RGF93 v1 / Lambert-93"
  a: string; // area of use
  b: [number, number, number, number]; // N, W, S, E, as published
  p: string; // proj4 definition
  k?: number; // accuracy of the datum tie to WGS84, in metres; absent if unstated
};

/**
 * Codes at and above this are not EPSG's. The registry carries ESRI's own
 * numbering too — 102400 "London Survey Grid", 103495 "NAD 1983 (CORS96) SPCS
 * New York Long Island" — and they arrive as duplicates of, or project-local
 * alternatives to, the EPSG entry a user actually wants. Writing one into
 * IfcProjectedCRS as "EPSG:102400" would be a false citation.
 */
const ESRI_CODE = 100000;

const REASONS = [
  'not a projected CRS',
  'not an EPSG code',
  'no proj4 or no bbox',
  'not in metres',
  'needs an NTv2 grid proj4js cannot load',
  'no datum tie to WGS84',
  'failed the proj4 round trip',
] as const;
const dropped: Record<string, number> = Object.fromEntries(REASONS.map((r) => [r, 0]));
const drop = (reason: (typeof REASONS)[number]): false => (dropped[reason]++, false);

const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;

/**
 * Does the definition tell proj4 how to get from WGS84 to this datum?
 *
 * +datum= and +towgs84= both do. An @-prefixed grid is optional by PROJ's own
 * convention, so a definition carrying one still transforms without it.
 *
 * The subtle case is a definition with none of those. proj4js then applies no
 * shift at all and treats the WGS84 latitude/longitude as if it were already on
 * the local ellipsoid. On GRS80 or WGS84 that is true to within a couple of
 * metres and fine for a site model. On Krassovsky, Bessel, Clarke or Airy it is
 * a fiction worth 100–500 m, so those go.
 */
const hasDatumTie = (def: string): boolean =>
  /\+datum=|\+towgs84=/.test(def) || /\+ellps=(GRS80|WGS84)\b/.test(def);

/** Longitude midpoint, the short way round — a bbox may cross the antimeridian,
 *  where the naive mean lands on the far side of the planet. */
const midLon = (w: number, e: number): number => {
  const m = w <= e ? (w + e) / 2 : (w + e + 360) / 2;
  return m > 180 ? m - 360 : m;
};

/**
 * Prove the definition works in the very library the app will use it with.
 *
 * Projects the centre of the area of use and brings it back. That catches
 * definitions proj4js cannot parse, ones that produce NaN or absurd magnitudes,
 * and ones whose inverse disagrees with their forward — none of which are worth
 * discovering mid-build. It says nothing about datum correctness: a definition
 * with its grid stripped would round-trip perfectly while sitting 450 m from
 * where it claims. That is what the two rules above are for.
 */
function transforms(def: string, bbox: [number, number, number, number]): boolean {
  const [n, w, s, e] = bbox;
  const lat = (n + s) / 2;
  const lon = midLon(w, e);
  try {
    proj4.defs('SELFTEST', def);
    const [x, y] = proj4('EPSG:4326', 'SELFTEST', [lon, lat]) as [number, number];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (Math.abs(x) > 1e8 || Math.abs(y) > 1e8) return false;
    const [lon2, lat2] = proj4('SELFTEST', 'EPSG:4326', [x, y]) as [number, number];
    if (!Number.isFinite(lon2) || !Number.isFinite(lat2)) return false;
    let dLon = Math.abs(lon2 - lon);
    if (dLon > 180) dLon = 360 - dLon;
    return dLon < 1e-6 && Math.abs(lat2 - lat) < 1e-6;
  } catch {
    return false;
  }
}

const all: Record<string, Source> = JSON.parse(readFileSync(SRC, 'utf8'));
const source = Object.values(all);

const kept: CrsRecord[] = [];
for (const r of source) {
  const code = Number(r.code);
  if (r.kind !== 'CRS-PROJCRS') {
    drop('not a projected CRS');
    continue;
  }
  if (!Number.isFinite(code) || code >= ESRI_CODE) {
    drop('not an EPSG code');
    continue;
  }
  if (!r.proj4 || !r.bbox || r.bbox.length !== 4) {
    drop('no proj4 or no bbox');
    continue;
  }
  // unit is null on a slice of otherwise sound records, so +units=m is the
  // check that decides and `unit` only vetoes when it was actually captured.
  if (!/\+units=m\b/.test(r.proj4) || (r.unit !== null && r.unit !== 'metre')) {
    drop('not in metres');
    continue;
  }
  const def = curatedDef(code) ?? r.proj4;
  if (/\+nadgrids=(?!@)/.test(def)) {
    drop('needs an NTv2 grid proj4js cannot load');
    continue;
  }
  if (!hasDatumTie(def)) {
    drop('no datum tie to WGS84');
    continue;
  }
  if (!transforms(def, r.bbox)) {
    drop('failed the proj4 round trip');
    continue;
  }
  kept.push({
    c: code,
    n: r.name,
    a: r.area ?? '',
    b: [r4(r.bbox[0]), r4(r.bbox[1]), r4(r.bbox[2]), r4(r.bbox[3])],
    p: def,
    ...(typeof r.accuracy === 'number' ? { k: r.accuracy } : {}),
  });
}

kept.sort((a, b) => a.c - b.c);
writeFileSync(OUT, JSON.stringify(kept));

const bytes = readFileSync(OUT).length;
console.log(`read    ${source.length} EPSG entries`);
for (const reason of REASONS) console.log(`  drop  ${String(dropped[reason]).padStart(5)}  ${reason}`);
console.log(`kept    ${kept.length} CRSs`);
console.log(`wrote   public/epsg.json  ${(bytes / 1024 / 1024).toFixed(2)} MB`);
