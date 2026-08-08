import polygonClipping from 'polygon-clipping';
import type { MultiPolygon } from 'polygon-clipping';
import { dedupe } from '@/lib/geo/rings';
import type { Vec2 } from '@/lib/types';

// The package's ESM build exports only a default object (union/difference/...
// as properties) — its own .d.ts promises named exports that don't exist at
// this build's runtime, so these are pulled off the default instead.
const { union } = polygonClipping;

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

const fromMultiPolygon = (mp: MultiPolygon): SplitPolygon[] => {
  const out: SplitPolygon[] = [];
  for (const poly of mp) {
    if (!poly.length) continue;
    const [outerRaw, ...holesRaw] = poly;
    const outer = dedupe(outerRaw as Vec2[]);
    if (outer.length < 3) continue;
    const holes = holesRaw.map((h) => dedupe(h as Vec2[])).filter((h) => h.length >= 3);
    out.push({ outer, holes });
  }
  return out;
};

/**
 * Union of possibly-overlapping simple rings into the smallest set of simple
 * regions covering the same area. Used by lib/scene/push to collapse
 * overlapping or gapped road-segment quads at bends and junctions into one
 * clean ribbon per connected road cluster — holes are kept (a roundabout's
 * ribbon can legitimately encircle a paved-free island), not stripped.
 *
 * polygon-clipping's sweep line is not robust against every input a batch of
 * near-touching, near-collinear road quads can produce — it has been seen to
 * throw outright on otherwise unremarkable geometry. That failure is caught
 * here rather than left to crash the build: falling back to the un-unioned
 * rings is exactly the pre-fix behaviour (independent quads, no clean join),
 * so a pathological cluster degrades to what shipped before instead of
 * taking the whole export down with it.
 */
export function unionRings(rings: Vec2[][]): SplitPolygon[] {
  const clean = rings.filter((r) => r.length >= 3);
  if (!clean.length) return [];
  try {
    const polys = clean.map((r) => [close(r)]);
    const [first, ...rest] = polys;
    return fromMultiPolygon(union(first, ...rest));
  } catch {
    return clean.map((r) => ({ outer: dedupe(r), holes: [] }));
  }
}
