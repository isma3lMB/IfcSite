import {
  containsRect,
  padMetres,
  padRect,
  rectArea,
  subtractRect,
} from '@/lib/geo/rect';
import type { SiteRect } from '@/lib/types';

/* =====================================================================
   Session cache for source data.

   Every build used to re-fetch everything. Rebuilding the same site because the
   fallback height changed cost another three-mirror Overpass round trip, and
   nudging the rectangle fifty metres cost it again. This holds the RAW upstream
   payloads for the life of the page, so a later build reuses them when the area
   asked for is the same as, inside, or overlapping one already fetched.

   Raw payloads rather than parsed scenes, on purpose. Parsing depends on the CRS
   (toLocal), the terrain (sampleZ), the tunables and the fallback height, none
   of which have anything to do with the bytes that came back — cache the scene
   and every one of those becomes part of the key.

   In memory only, so a reload is a cold start. Not localStorage, whose ~2.5 MB
   of JSON a dense site is well past; and not the IndexedDB the drafts use (see
   lib/io/slots), where a fetch payload nobody named would compete for quota with
   the documents the user asked to keep.

   This module is generic over the payload item: an Overpass element and a WFS
   feature are the same problem in two dialects, and keeping the shapes out of
   here is what stops a cycle back into overpass.ts and ign.ts.
   ===================================================================== */

/**
 * How long an entry may be served.
 *
 * There is no force-refresh control, so this and a reload are the only ways
 * stale data leaves. Half an hour is not really about the data — OSM and BD TOPO
 * move on a scale of days — but about the one user who edits OSM, comes back,
 * and rebuilds expecting to see their own change. Longer than any
 * nudge-and-rebuild session, short enough that "wait, or reload" is a real
 * answer.
 */
const TTL_MS = 30 * 60_000;

/**
 * Retained bytes across every region cache before the least recently used
 * entries are dropped.
 *
 * The worst realistic entry is the case ign.ts already names — 6423 buildings at
 * 900 m in dense Paris — whose object graph runs 12-20 MB. This holds two or
 * three of those, or a dozen ordinary ones, in a tab that is also carrying a
 * WebGL context and the 1.2 MB EPSG index.
 *
 * No per-entry ceiling. One large entry filling the budget and evicting the rest
 * IS correct LRU behaviour, and a cap would refuse to keep precisely the fetch
 * most worth keeping.
 */
const BUDGET = 48 * 1024 * 1024;

/**
 * Remainder pieces a stitched fetch may take, and how much of the padded area
 * they may cover.
 *
 * One piece, deliberately. `subtractRect` returns one only when the cached
 * rectangle spans the new one on an axis — a sideways pan, or one edge dragged
 * out — and that is the single case where the arithmetic is unambiguously worth
 * it, because it is one request replacing one request over less ground.
 *
 * Two pieces (a diagonal pan) is where it stops paying, and not because of area:
 * `overpassQuery` gives each mirror the full deadline in turn, so what a request
 * costs is dominated by which mirror answers, not by how much it was asked for.
 * Two requests are two chances to draw a slow one. A diagonal pan falls back to
 * a single full fetch, which is what it costs today anyway.
 */
const STITCH_MAX_PIECES = 1;
const STITCH_MAX_AREA = 0.6;

/** Hits since the last reset, read into the build summary. */
let reused = 0;
export const resetReuseCount = (): void => void (reused = 0);
export const reuseCount = (): number => reused;

/* ------------------------------------------------------------ region cache */

type Entry<T> = {
  ns: string;
  /** The rectangle actually fetched — padded, so wider than whatever asked for
   *  it. The coverage claim: every item of `kinds` intersecting this is in
   *  `items`. A lower bound; `items` may reach outside it, which is harmless
   *  because the parsers clip to the site. */
  rect: SiteRect;
  kinds: Set<string>;
  items: T[];
  bytes: number;
  /** Insertion time, for the TTL. Not touched on a hit — being useful extends an
   *  entry's place in the eviction order, never its claim to be current. */
  born: number;
};

/**
 * What a caller should do about a request.
 *
 * `have` is what the cache already holds and `fetch` is what is still missing.
 * An empty `fetch` is a clean hit; one rectangle that is not the padded request
 * is a stitch. The caller fetches each rectangle in turn and hands everything
 * back to `put`.
 */
export type Plan<T> = {
  have: T[];
  fetch: SiteRect[];
  hit: boolean;
  /** What the caller will have covered once it has fetched everything in
   *  `fetch` — hand this straight back to `put`. Passed rather than re-derived
   *  because a caller that falls back to an unpadded retry has covered less than
   *  this, and must be able to say so instead of filing a claim it cannot keep. */
  cover: SiteRect;
};

/** Every live cache, so one budget and one clear covers them all. */
const registry: {
  sweep: (now: number) => void;
  evict: () => number;
  bytes: () => number;
  clear: () => void;
}[] = [];

export class RegionCache<T> {
  /** Flat, because Map iterates in insertion order: re-inserting on a hit is the
   *  whole of the LRU. The namespace is a field on the entry rather than nested
   *  maps or a key prefix, since a linear scan over a few dozen entries costs
   *  nothing beside a 45 s deadline. */
  private store = new Map<number, Entry<T>>();
  private held = 0;
  private seq = 0;

  constructor(
    /** The item's stable upstream identity, or null when it has none — an
     *  unidentifiable item cannot be deduped, and its presence makes the whole
     *  payload unstorable rather than risk collapsing distinct features
     *  together. */
    private ident: (item: T) => string | null,
    private estimate: (items: T[]) => number,
  ) {
    registry.push({
      sweep: (now) => this.sweep(now),
      evict: () => this.evictOldest(),
      bytes: () => this.held,
      clear: () => {
        this.store.clear();
        this.held = 0;
      },
    });
  }

  private sweep(now: number): void {
    for (const [k, e] of this.store)
      if (now - e.born > TTL_MS) {
        this.store.delete(k);
        this.held -= e.bytes;
      }
  }

  /**
   * Drops the single least recently used entry; returns its bytes, or 0 when
   * there was nothing left to drop.
   *
   * Stops at one entry rather than emptying the store. Insertion order means the
   * survivor is whatever was used most recently — on the call right after a
   * `put`, that is the entry just inserted, and dropping the payload of the
   * build currently running would make the cache worse than not having one. A
   * single oversized entry therefore outlives the budget until the TTL takes it.
   */
  private evictOldest(): number {
    if (this.store.size <= 1) return 0;
    const first = this.store.keys().next();
    if (first.done) return 0;
    const e = this.store.get(first.value)!;
    this.store.delete(first.value);
    this.held -= e.bytes;
    return e.bytes;
  }

  /**
   * The best entry that can answer this request, or undefined.
   *
   * "Best" is the SMALLEST containing rectangle, so a later small site is not
   * handed a 2 km payload to filter when a 700 m one would do.
   */
  private lookup(ns: string, rect: SiteRect, need: Set<string>): [number, Entry<T>] | undefined {
    this.sweep(Date.now());
    let best: [number, Entry<T>] | undefined;
    let bestArea = Infinity;
    for (const [k, e] of this.store) {
      if (e.ns !== ns) continue;
      let covers = true;
      for (const want of need)
        if (!e.kinds.has(want)) {
          covers = false;
          break;
        }
      if (!covers || !containsRect(e.rect, rect)) continue;
      const a = rectArea(e.rect);
      if (a < bestArea) {
        best = [k, e];
        bestArea = a;
      }
    }
    return best;
  }

  /** The entry overlapping `rect` most, ignoring containment — the stitch
   *  candidate. */
  private overlapping(ns: string, rect: SiteRect, need: Set<string>): Entry<T> | undefined {
    let best: Entry<T> | undefined;
    let bestLeft = Infinity;
    for (const e of this.store.values()) {
      if (e.ns !== ns) continue;
      let covers = true;
      for (const want of need)
        if (!e.kinds.has(want)) {
          covers = false;
          break;
        }
      if (!covers) continue;
      const rem = subtractRect(rect, e.rect);
      if (rem.length !== STITCH_MAX_PIECES) continue;
      const left = rem.reduce((s, r) => s + rectArea(r), 0);
      if (left < bestLeft) {
        best = e;
        bestLeft = left;
      }
    }
    return best && bestLeft < STITCH_MAX_AREA * rectArea(rect) ? best : undefined;
  }

  plan(ns: string, rect: SiteRect, kinds: string[]): Plan<T> {
    const need = new Set(kinds);

    // Containment is tested against the rectangle actually asked for, never the
    // padded one. Padding decides what we fetch; letting it decide what we
    // require would turn a hit into a miss for want of a margin nobody needed.
    const found = this.lookup(ns, rect, need);
    if (found) {
      const [k, e] = found;
      this.store.delete(k);
      this.store.set(k, e);
      reused++;
      return { have: e.items, fetch: [], hit: true, cover: e.rect };
    }

    const want = padRect(rect, padMetres(rect));
    const near = this.overlapping(ns, want, need);
    if (near) {
      reused++;
      return { have: near.items, fetch: subtractRect(want, near.rect), hit: false, cover: want };
    }

    return { have: [], fetch: [want], hit: false, cover: want };
  }

  /**
   * Record what a request ended up holding, and hand back the deduped items.
   *
   * `cover` is the ground actually fetched over — `plan.cover` normally, or the
   * narrower rectangle a caller that fell back to an unpadded retry really
   * reached. The claim holds for a stitch too: the padded rectangle is covered
   * by the reused entry plus the remainders, so anything intersecting it is in
   * one of the two sets being merged here.
   *
   * `storable: false` uses the payload once and keeps nothing — for a WFS run
   * that hit its paging cap, where what came back is a truncation rather than an
   * answer.
   */
  put(ns: string, cover: SiteRect, kinds: string[], items: T[], storable = true): T[] {
    const seen = new Set<string>();
    const keep: T[] = [];
    let identified = true;
    for (const it of items) {
      const id = this.ident(it);
      // No identity, no dedupe. Two features that merely both lack an id are not
      // the same feature, and collapsing them would silently delete geometry —
      // so keep every one of them and refuse to store the payload, since a later
      // stitch onto it could not tell its duplicates apart either.
      if (id === null) {
        identified = false;
        keep.push(it);
        continue;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      keep.push(it);
    }
    if (!storable || !identified) return keep;

    const bytes = this.estimate(keep);
    this.store.set(++this.seq, {
      ns,
      rect: cover,
      kinds: new Set(kinds),
      items: keep,
      bytes,
      born: Date.now(),
    });
    this.held += bytes;

    // The budget is shared, so a large IGN fetch may evict an old OSM one. Each
    // cache gives up its oldest in turn until we are under, or until nobody has
    // anything left to give — evictOldest holds its last entry back, so this
    // cannot drop what was just inserted and cannot spin.
    let total = registry.reduce((s, c) => s + c.bytes(), 0);
    while (total > BUDGET) {
      let freed = 0;
      for (const c of registry) freed += c.evict();
      if (!freed) break;
      total -= freed;
    }
    return keep;
  }
}

/* -------------------------------------------------------------- exact keys */

/**
 * Promise memo for the requests where area reuse does not apply.
 *
 * The elevation lattice is a pure function of (box, N) — see gridLattice in
 * lib/geo/grid — so a smaller rectangle's sample points are not a subset of a
 * larger one's, and an exact key is the whole opportunity there.
 *
 * The promise is stored rather than the value, which also shares a request
 * already in flight — worth having for the terrain tiles, which go out nine at a
 * time. A rejection clears the key rather than poisoning it, so a flaky attempt
 * can be retried: the same rule loadEpsgIndex follows in lib/geo/epsg.
 */
export function memo<T>(
  store: Map<string, Promise<T>>,
  key: string,
  run: () => Promise<T>,
  /** Whether a hit counts towards the figure the build summary reports. Terrain
   *  tiles pass false: the browser HTTP-caches the PNG bytes anyway, so what is
   *  saved is a decode rather than a download, and counting nine of them would
   *  swamp the one Overpass round trip the user actually cares about. */
  count = true,
): Promise<T> {
  const held = store.get(key);
  if (held) {
    if (count) reused++;
    return held;
  }
  const p = run().catch((e: unknown) => {
    store.delete(key);
    throw e;
  });
  store.set(key, p);
  return p;
}

/** Trims an exact-key memo to its most recent `max` entries. Insertion order
 *  again, so the oldest key is the first one out. */
export function trimMemo(store: Map<string, unknown>, max: number): void {
  while (store.size > max) {
    const first = store.keys().next();
    if (first.done) break;
    store.delete(first.value);
  }
}

/**
 * Decoded terrain tiles, keyed `z/x/y`.
 *
 * A tile is already a quantised rectangle, so this gets area reuse for free with
 * no bbox arithmetic at all — a twenty-metre nudge lands on the same nine tiles.
 * The browser HTTP-caches the PNG bytes; what this saves is the decode, which is
 * what the canvas stitch actually waits on.
 *
 * Budgeted separately by count rather than by the byte pool above: a decoded
 * bitmap is not on the JS heap, and estimating it into the same figure would be
 * a lie. 64 tiles at 256x256x4 is about 16 MB.
 */
export const tileMemo = new Map<string, Promise<HTMLImageElement>>();
export const TILE_MAX = 64;

/**
 * RGE ALTI results, keyed on the rectangle and the lattice size.
 *
 * The patched height array, not the nine chunk payloads it was assembled from —
 * those ARE the lattice, and keeping both would store the same numbers twice.
 * Float32 resolves the highest ground in France to about half a millimetre, so
 * Float64 would be storing noise.
 */
export const altiMemo = new Map<string, Promise<Float32Array>>();
export const ALTI_MAX = 8;

/** Single-point datum probes, keyed on the posted lon/lat pair. */
export const datumMemo = new Map<string, Promise<number>>();
export const DATUM_MAX = 32;

/** Empties everything. Nothing in the UI calls this yet; it is what a refresh
 *  control, or a test wanting a cold start, would reach for. */
export function clearSourceCache(): void {
  for (const c of registry) c.clear();
  tileMemo.clear();
  altiMemo.clear();
  datumMemo.clear();
  reused = 0;
}
