/**
 * The pipeline's limits and geometry fallbacks, as data rather than as literals
 * scattered through the modules that use them.
 *
 * Every value here used to be a `const` next to its one call site. That was fine
 * while they were nobody's business but the builder's; it stopped being fine the
 * moment the options panel wanted to expose them, because three of them were
 * written down twice (a storey's height, a lane's width, a track's width, once
 * for OSM and once for BD TOPO) and two more had to agree with each other by
 * hand (the Overpass client deadline and the query's own `timeout:`). Naming
 * them once here is what makes "the same number" true rather than a convention.
 *
 * **This module imports nothing at runtime, on purpose.** components/controls-panel
 * imports it, and lib/geo/grid's own comment explains the rule: a module the
 * panel touches must not drag lib/scene (and with it polygon-clipping) or
 * lib/sources (and with it three.js) into the panel's chunk. So the literals live
 * here and the pipeline modules import *from* here, not the other way round.
 */

export type Tunables = {
  /** Footprints imported before the rest are dropped. */
  buildingCap: number;
  /** OSM `natural=tree` nodes imported, under either provider. */
  treeCap: number;
  /** Longest side, in metres, a drawn rectangle may have. */
  siteMax: number;
  /** Client-side deadline per Overpass mirror, in ms. */
  overpassTimeoutMs: number;
  /** Densest DEM lattice any provider may build, in cells across the site. */
  maxGridN: number;
  /** Block size, in metres, at which surfaces are cut to follow the ground. */
  conformStep: number;
  /** Metres per level, for a building that states levels but not height. */
  storeyHeight: number;
  /** Metres of carriageway per lane, absent an explicit `width`. */
  laneWidth: number;
  /** Metres of ribbon per parallel track, absent an explicit `width`. */
  railTrackWidth: number;
};

export const DEFAULT_TUNABLES: Readonly<Tunables> = Object.freeze({
  buildingCap: 4000,
  treeCap: 1500,
  siteMax: 1000,
  overpassTimeoutMs: 45000,
  maxGridN: 211,
  conformStep: 8,
  storeyHeight: 3.0,
  laneWidth: 3.25,
  railTrackWidth: 3.5,
});

/**
 * The bounds every value is held to — by the panel's sliders, which cannot emit
 * anything outside them, and again by sanitize() for anything that did not come
 * from a slider.
 *
 * Two maxima are pinned rather than chosen, and must stay pinned:
 *
 * `buildingCap` to BUILDING_CAP, because lib/viewer/Viewer still reads that
 * constant directly for the draw tool's own guard. A tunable may tighten a
 * ceiling the un-threaded readers enforce; it may never lift one.
 *
 * `maxGridN` to MAX_GRID_N = 211, which is not a round number and has no slack:
 * RGE ALTI's 5000 posts across the 9 requests lib/sources/ign will make is
 * exactly 45000, and (211+1)^2 = 44944. Offer 212 and the IGN terrain path
 * throws err.altiGridTooLarge on a value this panel handed it.
 */
export const TUNE_RANGE: Record<keyof Tunables, [number, number]> = {
  buildingCap: [200, 4000],
  treeCap: [100, 5000],
  siteMax: [500, 2000],
  overpassTimeoutMs: [10000, 180000],
  maxGridN: [16, 211],
  conformStep: [2, 40],
  storeyHeight: [2, 6],
  laneWidth: [2, 6],
  railTrackWidth: [1, 8],
};

/**
 * The tunables that change what a build *produces*, and so mean the scene on
 * screen was made under rules the next build would not use.
 *
 * `siteMax` is the one that does not: it bounds the rectangle you may draw next
 * and says nothing about a scene already built. See onFormChange in
 * components/ifc-site.
 */
export const SCENE_TUNABLES: ReadonlySet<keyof Tunables> = new Set<keyof Tunables>([
  'buildingCap',
  'treeCap',
  'overpassTimeoutMs',
  'maxGridN',
  'conformStep',
  'storeyHeight',
  'laneWidth',
  'railTrackWidth',
]);

const STORAGE_KEY = 'ifcsite.tunables';

const KEYS = Object.keys(DEFAULT_TUNABLES) as (keyof Tunables)[];

/**
 * A trusted Tunables out of anything at all.
 *
 * It walks the keys of DEFAULT_TUNABLES rather than the keys of what it was
 * given, which is what makes an older or newer stored blob a non-event: a
 * missing field takes its default, an unknown one is dropped, and renaming a
 * field later needs no migration step.
 *
 * runBuild calls this on entry as well as the panel calling it on load, so a
 * poisoned value cannot reach a fetch deadline or a geometry loop even by a path
 * that never went through a slider.
 */
export function sanitizeTunables(v: unknown): Tunables {
  const src = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const out = {} as Tunables;
  for (const k of KEYS) {
    const raw = src[k];
    const [lo, hi] = TUNE_RANGE[k];
    // Finiteness first, then clamp. The other order lets NaN through silently —
    // Math.min(hi, Math.max(lo, NaN)) is NaN — and a NaN cap turns every
    // `length >= cap` guard in the parsers into a no-op, which is a browser tab
    // pulling down a whole city rather than a wrong number on screen.
    out[k] =
      typeof raw === 'number' && Number.isFinite(raw)
        ? Math.min(hi, Math.max(lo, raw))
        : DEFAULT_TUNABLES[k];
  }
  return out;
}

/** Whether `t` is the shipped configuration, which is what disables Reset. */
export const isDefaultTunables = (t: Tunables): boolean =>
  KEYS.every((k) => t[k] === DEFAULT_TUNABLES[k]);

/** Stored settings, or the defaults if there are none or they are unusable. */
export function loadTunables(): Tunables {
  try {
    // The parse is inside the try with the read, so corrupt JSON lands in the
    // same place a disabled storage does: the defaults, in full.
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return sanitizeTunables(JSON.parse(raw));
  } catch {
    // Storage disabled, or a blob that is not JSON at all.
  }
  return { ...DEFAULT_TUNABLES };
}

export function saveTunables(t: Tunables): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  } catch {
    // Private mode with storage disabled: the settings still hold for this
    // session, they just will not be remembered.
  }
}
