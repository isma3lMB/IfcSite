import polygonClipping from 'polygon-clipping';
import type { MultiPolygon } from 'polygon-clipping';
import { clipToBox, dedupe, signedArea } from '@/lib/geo/rings';
import type { Vec2 } from '@/lib/types';

// The package's ESM build exports only a default object (union/difference/...
// as properties) — its own .d.ts promises named exports that don't exist at
// this build's runtime, so these are pulled off the default instead.
const { difference, intersection, union } = polygonClipping;

/**
 * The one file that knows polygon-clipping's coordinate convention differs
 * from ours: its rings are CLOSED (first point repeated) where every ring in
 * this project is open (see dedupe() in ./rings), and it hands back outer +
 * hole rings per polygon rather than the single ring most callers here pass
 * in. Everything downstream — lib/geo/conform, lib/scene/push — deals only in
 * open Vec2 rings and { outer, holes } pieces, never in the library's own
 * types.
 */
export type SplitPolygon = { outer: Vec2[]; holes: Vec2[][] };

const close = (r: Vec2[]): Vec2[] => {
  if (r.length < 2) return r;
  const a = r[0];
  const b = r[r.length - 1];
  return Math.abs(a[0] - b[0]) > 1e-9 || Math.abs(a[1] - b[1]) > 1e-9 ? [...r, a] : r;
};

const real = (r: Vec2[]): boolean => r.length >= 3 && Math.abs(signedArea(r)) >= MIN_RING;

const fromMultiPolygon = (mp: MultiPolygon): SplitPolygon[] => {
  const out: SplitPolygon[] = [];
  for (const poly of mp) {
    if (!poly.length) continue;
    const [outerRaw, ...holesRaw] = poly;
    const outer = dedupe(outerRaw as Vec2[]);
    if (!real(outer)) continue;
    const holes = holesRaw.map((h) => dedupe(h as Vec2[])).filter(real);
    out.push({ outer, holes });
  }
  return out;
};

/**
 * Grids, in metres, that the sweep line's input is snapped to — tried in turn
 * until one of them survives. Ten micrometres up to a centimetre.
 *
 * polygon-clipping decides which of two segments comes first by comparing
 * coordinates it has computed, and two points that are the same point but
 * arrived at by different arithmetic — a quad corner reached by adding an
 * offset, the same corner reached by intersecting two edges — differ in the
 * last bits. The sweep line then orders them inconsistently, cannot close the
 * ring it opened, and throws: "Unable to complete output ring starting at
 * [-120, -3.9999999999999853]". That coordinate is -4, and the trailing 853 is
 * the entire bug. Snapping collapses the variants onto one value.
 *
 * How much snapping it takes is not predictable from the input, hence a ladder
 * rather than a constant. Measured over 591 randomised road networks — bends up
 * to 35 degrees a node, widths to 15 m, a fifth of the nodes under a metre
 * apart — a single 10 um snap still lost 5.6% of the per-road unions and the
 * ladder loses none. (The same measurement puts the un-snapped rate this code
 * used to run at 21.7%, which is what the ragged bends and unmerged junctions
 * in the old road layer actually were.)
 *
 * The coarse end is only ever reached after everything finer has failed, and
 * the alternative there is not a better union but no union at all. A centimetre
 * is invisible on a carriageway and the fallback is visibly broken geometry, so
 * the trade is not close.
 */
const SNAPS = [1e-5, 1e-4, 1e-3, 1e-2];

/** A ring below this is a rounding artefact of the sweep line, not a region:
 *  it cannot survive the millimetre weld in lib/geo/conform, and every one that
 *  gets through costs that module a boolean intersection on each terrain cell
 *  it touches. One square millimetre. */
const MIN_RING = 1e-6;

const snap = (r: Vec2[], q: number): Vec2[] =>
  r.map((p): Vec2 => [Math.round(p[0] / q) * q, Math.round(p[1] / q) * q]);

const toPoly = (p: SplitPolygon, q: number): Vec2[][] => [
  close(snap(p.outer, q)),
  ...p.holes.map((h) => close(snap(h, q))),
];

/**
 * Run `op` at each snap in turn, returning the first result that does not
 * throw. `null` means the whole ladder failed, which is the caller's cue to
 * degrade rather than to retry.
 */
function laddered(op: (q: number) => MultiPolygon): SplitPolygon[] | null {
  let last: unknown;
  for (const q of SNAPS) {
    try {
      return fromMultiPolygon(op(q));
    } catch (e) {
      last = e;
    }
  }
  console.warn(`polygon-clipping failed at every snap in [${SNAPS.join(', ')}]`, last);
  return null;
}

/**
 * Union of possibly-overlapping regions into the smallest set of simple ones
 * covering the same area. Used by lib/scene/push to collapse the buffered
 * quads and join fans of a road centreline into one clean ribbon, and then to
 * merge every road's ribbon where they cross.
 *
 * Holes survive both passes and are the caller's to keep or drop: a roundabout
 * buffered by half a carriageway genuinely is a donut, and the island in the
 * middle is not road.
 *
 * polygon-clipping's sweep line is not robust against every input a batch of
 * near-touching, near-collinear road quads can produce, which is what SNAPS
 * above is for. If even the coarsest snap throws, the failure is caught rather
 * than left to crash the build: falling back to the un-unioned operands is
 * exactly the pre-union behaviour, so a pathological cluster degrades to ragged
 * instead of taking the whole export down with it.
 */
export function unionPolygons(polys: SplitPolygon[]): SplitPolygon[] {
  const clean = polys.filter((p) => p.outer.length >= 3);
  if (!clean.length) return [];
  const out = laddered((q) => {
    const [first, ...rest] = clean.map((p) => toPoly(p, q));
    return union(first, ...rest);
  });
  if (out) return out;
  console.warn(`unionPolygons: ${clean.length} regions left un-unioned`);
  return clean.map((p) => ({ outer: dedupe(p.outer), holes: p.holes.map(dedupe) }));
}

/** The hole-free case, which is every caller that starts from raw rings. */
export const unionRings = (rings: Vec2[][]): SplitPolygon[] =>
  unionPolygons(rings.map((outer) => ({ outer, holes: [] })));

/**
 * A region AND ITS HOLES cut to the site rectangle.
 *
 * clipToBox in ./rings is the cheaper tool and stays the right one for a bare
 * ring, but it clips one ring at a time — and an outer and its holes clipped
 * independently are not the same shape as the pair clipped together. An island
 * straddling the site edge comes back sharing a segment with the clipped outer,
 * and ear clipping does not cut a hole out, it BRIDGES to it: a hole touching
 * the boundary is the one input it cannot be trusted on. A real intersection
 * has no such case — the straddling island comes back as a notch in the outer
 * ring, with no hole left to bridge to.
 *
 * It also returns one entry per component, so a river severed into two by the
 * box comes back as the two regions it really is rather than as the single
 * self-overlapping ring Sutherland-Hodgman can only hand back (the caveat
 * clipToBox spells out).
 *
 * A caller with no holes should stay on clipToBox: this runs a sweep line where
 * that runs four half-planes, and nothing above can arise without a hole.
 */
export function clipPolygonToRect(
  poly: SplitPolygon,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): SplitPolygon[] {
  if (poly.outer.length < 3) return [];
  const rect: Vec2[] = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
  const out = laddered((q) => intersection(toPoly(poly, q), [close(snap(rect, q))]));
  if (out) return out;
  // Degrading the way unionPolygons does: the alternative to a caveated clip is
  // no clip at all, and an unclipped BD TOPO river carries kilometres of
  // geometry into the export. Per-ring, caveat and all, beats that.
  console.warn('clipPolygonToRect: fell back to per-ring clipping');
  const outer = clipToBox(poly.outer, minX, minY, maxX, maxY);
  if (outer.length < 3) return [];
  return [
    {
      outer,
      holes: poly.holes.map((h) => clipToBox(h, minX, minY, maxX, maxY)).filter((h) => h.length >= 3),
    },
  ];
}

/**
 * `subject` with every one of `clips` taken out of it — what cutting a terrain
 * triangle around a drawn void comes down to (see lib/geo/voids).
 *
 * Null when the whole snap ladder failed, rather than the subject back
 * unchanged: for a void the honest degradation is the caller's to choose, and
 * "the hole silently did not happen" is not one a caller should get by default.
 */
export function differencePolygons(subject: SplitPolygon, clips: SplitPolygon[]): SplitPolygon[] | null {
  if (subject.outer.length < 3) return [];
  const cs = clips.filter((c) => c.outer.length >= 3);
  if (!cs.length) return [subject];
  return laddered((q) => difference(toPoly(subject, q), ...cs.map((c) => toPoly(c, q))));
}

// There was an intersectPolygon here, for cutting a region with holes against
// one terrain cell. lib/geo/conform no longer needs a general clipper: it
// triangulates a region once and cuts the triangles, and a convex subject
// against a convex window is what Sutherland-Hodgman is exactly right for.
