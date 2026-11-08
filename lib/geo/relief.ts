import type { Vec3 } from '@/lib/types';

/* The terrain view's arithmetic: how high the ground is, where it crosses a
   given height, and what colour a height is. Pure, so the numbers can be tested
   without a renderer; the viewer only turns the results into buffers. */

type Mesh = { verts: readonly Vec3[]; faces: readonly (readonly number[])[] };

/** Lowest and highest z of a vertex list, or null when there is none. */
export function elevationRange(verts: readonly Vec3[]): { min: number; max: number } | null {
  if (!verts.length) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const v of verts) {
    if (v[2] < min) min = v[2];
    if (v[2] > max) max = v[2];
  }
  return { min, max };
}

/**
 * A contour interval that is a round number — 0.5, 1, 2, 5, 10 … — chosen so a
 * relief of `range` metres gets about `target` lines. A flat site gets 1 m
 * rather than a division by zero.
 */
export function niceInterval(range: number, target = 25): number {
  if (!(range > 0)) return 1;
  const raw = range / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

/** Every `MAJOR_EVERY`th contour is drawn heavier, as on a survey sheet. */
export const MAJOR_EVERY = 5;

export type Contours = {
  interval: number;
  /** Segment endpoints as flat x,y,z triples, two points a segment. */
  minor: number[];
  major: number[];
};

/**
 * The lines where the surface crosses each multiple of `interval`.
 *
 * Marching triangles: a triangle is crossed by a level when its corners fall on
 * both sides of it, which for a triangle is always exactly two edges. A corner
 * sitting exactly on a level counts as above it, so a level through a vertex
 * cuts the triangles around it consistently instead of doubling or dropping the
 * segment.
 */
export function contourSegments(mesh: Mesh, interval: number): Contours {
  const out: Contours = { interval, minor: [], major: [] };
  if (!(interval > 0)) return out;
  const { verts, faces } = mesh;

  for (const f of faces) {
    if (f.length !== 3) continue;
    const p = [verts[f[0]], verts[f[1]], verts[f[2]]];
    const lo = Math.min(p[0][2], p[1][2], p[2][2]);
    const hi = Math.max(p[0][2], p[1][2], p[2][2]);
    if (lo === hi) continue;

    for (let k = Math.ceil(lo / interval); k * interval <= hi; k++) {
      const level = k * interval;
      const pts: number[] = [];
      for (let e = 0; e < 3; e++) {
        const a = p[e];
        const b = p[(e + 1) % 3];
        if (a[2] >= level === b[2] >= level) continue;
        const t = (level - a[2]) / (b[2] - a[2]);
        pts.push(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, level);
      }
      // A level that only grazes a peak corner crosses two edges at the same
      // point: no line to draw.
      if (pts.length !== 6 || (pts[0] === pts[3] && pts[1] === pts[4])) continue;
      (k % MAJOR_EVERY === 0 ? out.major : out.minor).push(...pts);
    }
  }
  return out;
}

/** The heatmap: low to high, cold to hot. Stops are 0xRRGGBB at even spacing. */
export const HEAT_STOPS = [0x2a4bd7, 0x1ec8c8, 0x4fd04f, 0xf2d11a, 0xe0301e] as const;

/** The ramp at `t` in [0, 1] (clamped), as r,g,b each in [0, 1]. */
export function heatColor(t: number): [number, number, number] {
  const u = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (HEAT_STOPS.length - 1);
  const i = Math.min(HEAT_STOPS.length - 2, Math.floor(u));
  const f = u - i;
  const a = HEAT_STOPS[i];
  const b = HEAT_STOPS[i + 1];
  const ch = (shift: number): number =>
    (((a >> shift) & 255) * (1 - f) + ((b >> shift) & 255) * f) / 255;
  return [ch(16), ch(8), ch(0)];
}

/** The ramp as a CSS gradient, for the legend. */
export const heatGradientCss = (): string =>
  `linear-gradient(to right, ${HEAT_STOPS.map((c) => `#${c.toString(16).padStart(6, '0')}`).join(', ')})`;

/** The ways the terrain can be looked at while it is being edited. Independent
 *  of one another: x-ray with contours over a heatmap is a legitimate view. */
export type TerrainView = {
  /** See through the ground to what is under and in it. */
  xray: boolean;
  /** A dot on every vertex of the mesh as cut. */
  vertices: boolean;
  /** Elevation lines at a round interval. */
  contours: boolean;
  /** The ground tinted by height. */
  heatmap: boolean;
};

export const TERRAIN_VIEW_OFF: TerrainView = {
  xray: false,
  vertices: false,
  contours: false,
  heatmap: false,
};
