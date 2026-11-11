import { dedupe, pointInRing } from '@/lib/geo/rings';
import type { Vec2 } from '@/lib/types';

/**
 * Points to plant inside a drawn ring — what the tree tool's area mode fills a
 * polygon with.
 *
 * A staggered (hexagonal) lattice rather than a square one: every tree is the
 * same distance from its six neighbours, which is how a planted grove reads,
 * and it packs about 15 % more trees into the same area for the same spacing.
 * The rows run along the ring's longest edge, so an avenue or a strip along a
 * street comes out in rows parallel to it rather than at whatever angle the
 * site's axes happen to make.
 *
 * Pure and deterministic: the jitter comes off a seeded generator, so the same
 * ring and options always give the same planting — which is what lets a test
 * say anything about it, and what keeps a redo landing the trees where the
 * first commit did (redo re-inserts the records, but that is still worth not
 * leaving to chance).
 */
export type ScatterOpts = {
  /** Centre-to-centre distance between neighbouring trees, metres. */
  spacing: number;
  /** How far each point may wander off its lattice node, as a fraction of the
   *  spacing. 0 is a strict grid. Kept under 0.5 so neighbours cannot swap. */
  jitter?: number;
  /** Minimum distance from a point to the ring's boundary, metres — so a crown
   *  does not hang over the edge of the area it was planted in. Defaults to
   *  a third of the spacing. */
  margin?: number;
  /** Seed for the jitter. */
  seed?: number;
  /** Refuse past this many points: the result is null rather than a partial
   *  planting, so the caller can say why nothing happened. */
  max?: number;
};

/** The spacing the panel's field is clamped to. Under a metre, a crown is
 *  wider than the gap between trees and the count explodes for nothing. */
export const MIN_SPACING = 1;

/** mulberry32 — tiny, fast, and good enough to scatter trees with. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Distance from p to the segment ab. */
function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Distance from p to the nearest edge of a closed ring. */
export function ringDist(p: Vec2, ring: Vec2[]): number {
  let d = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) d = Math.min(d, segDist(p, ring[j], ring[i]));
  return d;
}

/** The angle of the ring's longest edge, which the rows are laid along. */
function rowAngle(ring: Vec2[]): number {
  let best = 0;
  let angle = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const dx = ring[i][0] - ring[j][0];
    const dy = ring[i][1] - ring[j][1];
    const l = dx * dx + dy * dy;
    if (l > best) {
      best = l;
      angle = Math.atan2(dy, dx);
    }
  }
  return angle;
}

/**
 * Fill a ring with points on a staggered lattice, `spacing` apart.
 *
 * The lattice is centred on the ring's bounding box in the rotated frame, so a
 * symmetric area gets a symmetric planting instead of one hugging a corner.
 * Each candidate is kept if it lies inside the ring and at least `margin` from
 * its boundary. An area too narrow to hold a single lattice node still gets one
 * tree, at the deepest of the sampled points, when that point clears the margin
 * — otherwise a narrow strip would silently plant nothing.
 *
 * Returns null when more than `max` points would fit.
 */
export function scatterInRing(ringIn: Vec2[], opts: ScatterOpts): Vec2[] | null {
  const ring = dedupe(ringIn);
  if (ring.length < 3) return [];
  const s = Math.max(MIN_SPACING, opts.spacing);
  const jitter = Math.max(0, Math.min(0.45, opts.jitter ?? 0));
  const margin = Math.max(0, opts.margin ?? s / 3);
  const max = opts.max ?? Infinity;
  const rnd = seededRandom(opts.seed ?? 1);

  // Work in a frame whose x axis runs along the longest edge.
  const th = rowAngle(ring);
  const c = Math.cos(th);
  const sn = Math.sin(th);
  const toLocal = ([x, y]: Vec2): Vec2 => [x * c + y * sn, -x * sn + y * c];
  const toSite = ([u, v]: Vec2): Vec2 => [u * c - v * sn, u * sn + v * c];
  const local = ring.map(toLocal);

  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (const [u, v] of local) {
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }

  const dv = (s * Math.sqrt(3)) / 2;
  // Whole rows and columns, centred in the box: the leftover is split evenly
  // either side rather than all of it landing on the far edge.
  const rows = Math.floor((maxV - minV) / dv);
  const cols = Math.floor((maxU - minU) / s);
  // A cheap bound before anything is tested: one lattice cell holds one point,
  // so the area says roughly how many there will be, and an area holding
  // millions is a refusal, not a loop to sit through. Twice the cap, so a fill
  // that only just fits is still counted exactly below.
  let area2 = 0;
  for (let i = 0, j = local.length - 1; i < local.length; j = i++)
    area2 += local[j][0] * local[i][1] - local[i][0] * local[j][1];
  if (Math.abs(area2) / 2 / (s * dv) > max * 2) return null;
  const v0 = (minV + maxV) / 2 - (rows * dv) / 2;
  const u0 = (minU + maxU) / 2 - (cols * s) / 2;

  const out: Vec2[] = [];
  for (let r = 0; r <= rows; r++) {
    const v = v0 + r * dv;
    // Odd rows sit half a step over, and carry one node more so the stagger
    // reaches both ends of the box.
    const shift = r % 2 ? -s / 2 : 0;
    const n = r % 2 ? cols + 1 : cols;
    for (let k = 0; k <= n; k++) {
      let u = u0 + shift + k * s;
      let w = v;
      if (jitter > 0) {
        const a = rnd() * Math.PI * 2;
        const d = Math.sqrt(rnd()) * jitter * s;
        u += Math.cos(a) * d;
        w += Math.sin(a) * d;
      }
      const p: Vec2 = [u, w];
      if (!pointInRing(p, local) || ringDist(p, local) < margin) continue;
      out.push(toSite(p));
      if (out.length > max) return null;
    }
  }

  if (!out.length) {
    // Too narrow for the lattice: try for one tree at the most interior of a
    // few sampled points — the vertex mean first, then a fine sweep.
    let best: Vec2 | null = null;
    let bestD = -Infinity;
    const consider = (p: Vec2) => {
      if (!pointInRing(p, local)) return;
      const d = ringDist(p, local);
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    };
    consider([local.reduce((a, p) => a + p[0], 0) / local.length, local.reduce((a, p) => a + p[1], 0) / local.length]);
    const N = 24;
    for (let i = 0; i <= N; i++)
      for (let j = 0; j <= N; j++)
        consider([minU + ((maxU - minU) * i) / N, minV + ((maxV - minV) * j) / N]);
    if (best && bestD >= margin && max >= 1) out.push(toSite(best));
  }
  return out;
}
