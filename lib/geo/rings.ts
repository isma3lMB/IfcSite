import type { Vec2 } from '@/lib/types';

/**
 * Pure ring arithmetic. Deliberately free of any three.js import so that the
 * IFC serialiser can depend on it without pulling a renderer into its graph —
 * everything here is closed-form. Mesh work that genuinely needs three (earcut
 * triangulation, Euler decomposition) lives in ./mesh instead.
 */

/** Drop consecutive duplicate vertices, and the closing repeat of the first. */
export function dedupe(r: Vec2[]): Vec2[] {
  const o: Vec2[] = [];
  for (const p of r) {
    const l = o[o.length - 1];
    if (!l || Math.abs(l[0] - p[0]) > 1e-9 || Math.abs(l[1] - p[1]) > 1e-9) o.push(p);
  }
  if (o.length > 1) {
    const a = o[0];
    const b = o[o.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) o.pop();
  }
  return o;
}

export const signedArea = (r: Vec2[]): number => {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
};

/**
 * OSM footprints come in both directions. IFC profiles need counter-clockwise
 * outer curves, so every ring is checked by signed area and reversed if needed
 * — skip this and roughly half the buildings render inverted or vanish.
 */
export const ensureCCW = (r: Vec2[]): Vec2[] => (signedArea(r) < 0 ? r.slice().reverse() : r);

/**
 * One Sutherland-Hodgman pass: keep the half-plane `nx*x + ny*y <= c`, cutting
 * every edge that crosses the line. Split out of clipToBox so the same pass can
 * serve an arbitrary convex window — clipping a draped layer onto the terrain
 * triangle it sits on needs three sloping half-planes, not four square ones.
 *
 * On-the-line counts as inside, which is what stops a polygon sharing an edge
 * with the window from losing that edge to rounding. A subject vertex landing
 * exactly on the line can come back out twice, so callers dedupe before
 * triangulating — as they already did.
 */
function clipHalfPlane(ring: Vec2[], nx: number, ny: number, c: number): Vec2[] {
  const out: Vec2[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const cur = ring[i];
    const prev = ring[(i + n - 1) % n];
    const dc = nx * cur[0] + ny * cur[1] - c;
    const dp = nx * prev[0] + ny * prev[1] - c;
    if (dc <= 0) {
      if (dp > 0) {
        const t = dp / (dp - dc);
        out.push([prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])]);
      }
      out.push(cur);
    } else if (dp <= 0) {
      const t = dp / (dp - dc);
      out.push([prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])]);
    }
  }
  return out;
}

/**
 * Sutherland-Hodgman against the site square. National layers are cut to whole
 * forests and river systems: one BD TOPO vegetation polygon near Fontainebleau
 * is 3539 vertices spanning 4 km, against a site box of one or two. Without
 * this the triangulator chokes and the IFC carries kilometres of irrelevant
 * geometry. Concave input can leave zero-width seams along the box edge, which
 * is harmless for a draped context surface.
 *
 * The four half-planes below are the algebraic equal of the hand-rolled
 * arithmetic this used to carry, but not its bit-for-bit equal: the shared pass
 * forms the denominator as a difference of two signed distances rather than
 * subtracting the two coordinates directly, which lands within an ulp instead
 * of on it. Measured against the old code over random rings that is a worst
 * case of 1e-13 m with the vertex count unchanged on every one — nothing a
 * drape or a triangulator can see, and worth it for one clipper instead of two.
 */
export function clipToBox(
  ring: Vec2[],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Vec2[] {
  let out = ring;
  if (out.length) out = clipHalfPlane(out, -1, 0, -minX);
  if (out.length) out = clipHalfPlane(out, 1, 0, maxX);
  if (out.length) out = clipHalfPlane(out, 0, -1, -minY);
  if (out.length) out = clipHalfPlane(out, 0, 1, maxY);
  return out;
}

/**
 * Sutherland-Hodgman against an arbitrary CONVEX window given counter-clockwise
 * — the same machinery as clipToBox with one half-plane per window edge instead
 * of four axis-aligned ones. Convexity is the whole requirement, and a terrain
 * triangle is convex, which is all lib/geo/conform needs.
 *
 * Concave subjects leave zero-width seams along the window boundary exactly as
 * clipToBox does: every pass reconnects along its own clip line, so the seams
 * carry no area and a draped surface is unaffected.
 */
export function clipToConvex(ring: Vec2[], win: Vec2[]): Vec2[] {
  let out = ring;
  for (let k = 0; k < win.length && out.length; k++) {
    const a = win[k];
    const b = win[(k + 1) % win.length];
    // Inside is left of a->b: cross(b-a, p-a) >= 0, rearranged to nx*x+ny*y <= c.
    const nx = b[1] - a[1];
    const ny = a[0] - b[0];
    out = clipHalfPlane(out, nx, ny, nx * a[0] + ny * a[1]);
  }
  return out;
}

/**
 * Insert intermediate vertices so no edge is longer than maxLen. Draping only
 * ever looks up elevation *at vertices*, so a long edge is a straight line the
 * terrain is free to rise through: a 200 m BD TOPO road segment across a valley
 * dives clean under the ground however good the sampler is. Splitting first
 * gives the drape enough stations to follow the DEM.
 *
 * The cap is a safety valve, not a target — rings are clipped to the site box
 * before they get here, so growth is already bounded by the site size.
 */
const DENSIFY_CAP = 4000;

export function densify(pts: Vec2[], maxLen: number, closed = false): Vec2[] {
  if (pts.length < 2 || maxLen <= 0) return pts;
  const out: Vec2[] = [];
  const last = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    out.push(a);
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxLen);
    if (out.length + n > DENSIFY_CAP) continue;
    for (let k = 1; k < n; k++)
      out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  if (!closed) out.push(pts[pts.length - 1]);
  return out;
}

/** Area centroid stand-in: the vertex mean, which is what the original used. */
export const ringCentre = (r: Vec2[]): Vec2 => [
  r.reduce((s, p) => s + p[0], 0) / r.length,
  r.reduce((s, p) => s + p[1], 0) / r.length,
];
