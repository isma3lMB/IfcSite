import { MAX_GRID_N } from '@/lib/geo/grid';
import { drape, triangulate } from '@/lib/geo/mesh';
import { clipToConvex, dedupe, ensureCCW, signedArea } from '@/lib/geo/rings';
import type { Grid, SampleZ, ToGeo, Vec2, Vec3 } from '@/lib/types';

/* =====================================================================
   Cutting a flat context layer onto the terrain it is draped over.

   Draping only ever looks up elevation AT VERTICES, and the triangulator is
   ear clipping — it returns index triples into the boundary and never adds an
   interior point. So a ring drapes at its own corners and nowhere else: a
   river or a forest spanning the site came back as a handful of enormous
   triangles stretched between a few boundary elevations, a tilted plane
   through the hillside and through every layer stacked on it. Metres of error,
   against the centimetre offsets in lib/scene/stack that are supposed to
   decide the stacking order.

   The fix is to cut the ring on the terrain's own triangles before draping.
   gridSampler interpolates barycentrically over exactly the triangles the
   terrain mesh draws (see lib/geo/grid), so a piece lying wholly inside one of
   them, draped through sampleZ, is planar exactly dz above the drawn ground —
   everywhere, not only at its corners. That is what puts the centimetre
   offsets back in charge.
   ===================================================================== */

/**
 * Block size in metres when the lattice is finer than a drape needs. The same
 * number as ROAD_STEP and VEG_STEP, so the whole scene states how closely
 * anything follows the ground once: two stations to a 15 m IGN cell is already
 * more than the DEM knows, and past it the pieces cost entities, not fidelity.
 */
const CONFORM_STEP = 8;

/** No ring may cut into more pieces than the densest terrain has cells. With
 *  the welding below that holds one ring to roughly one terrain mesh, which is
 *  the ceiling MAX_GRID_N was picked for: every vertex is another
 *  IfcCartesianPoint and every triangle another IfcIndexedPolygonalFace. */
const MAX_BLOCKS = MAX_GRID_N * MAX_GRID_N;

/** Below this a piece is a clip-line sliver or a Sutherland-Hodgman seam, not
 *  a surface. One test covers collinear output, seams and degenerate slivers,
 *  and keeps empty faces out of the deliverable. */
const MIN_AREA = 1e-4;

/** Index window padding, in cells. The lattice is regular in index space but
 *  its metre positions come from a projection, so the affine inverse below is
 *  off by the projection's departure from affine — well under a cell over a
 *  2 km site. Over-including costs an empty clip; under-including silently
 *  drops geometry, so pad generously. */
const PAD = 2;

/** A terrain face is covered enough to drop once this much of it is under an
 *  opaque layer. Clipping is exact enough that a fully covered triangle comes
 *  back at 1 to within rounding, so the slack is only for that. */
const FULLY_COVERED = 1 - 1e-6;

/**
 * Drape `ring` onto the terrain, cut on the terrain's own triangles, lifted by
 * `dz`. Returns the same vertex/face pair a Surface wants.
 *
 * Everything it needs about the lattice comes out of `terrain`, so there is no
 * way for it to disagree with the grid it is conforming to.
 *
 * `coverage`, if given, accumulates how much of each terrain face this ring
 * covered, keyed by that face's index in `terrain.faces`. The clip already
 * computes the area, so this costs a division — and it is what lets the caller
 * take the ground out from under an opaque layer instead of leaving two
 * surfaces a few centimetres apart to fight over the depth buffer.
 */
export function conformToTerrain(
  ring: Vec2[],
  terrain: Grid | null,
  toGeo: ToGeo,
  sampleZ: SampleZ,
  dz: number,
  coverage?: Map<number, number>,
): { verts: Vec3[]; faces: number[][] } {
  const r = ensureCCW(dedupe(ring));
  // Ear clipping preserves nothing about orientation on its own, so squaring
  // the subject away up front is what makes every piece — and every exported
  // face normal — come out the same way up.
  const flat = (): { verts: Vec3[]; faces: number[][] } => ({
    verts: drape(r, toGeo, sampleZ, dz),
    faces: triangulate(r),
  });
  // No terrain means sampleZ is a constant — either the flat datum or the IGN
  // single post — so a boundary-only drape is already exact and there is
  // nothing to conform to. This is the cheap path this module replaced.
  if (r.length < 3 || !terrain || terrain.n < 1) return flat();

  const n = terrain.n;
  const V = terrain.verts;
  const o = V[0];
  const pi = V[n];
  const pj = V[n * (n + 1)];
  // One cell along each lattice axis. Taking these off the lattice itself
  // absorbs grid convergence exactly: the rows are turned by a few degrees
  // against the site box, and this is that turn.
  const ei: Vec2 = [(pi[0] - o[0]) / n, (pi[1] - o[1]) / n];
  const ej: Vec2 = [(pj[0] - o[0]) / n, (pj[1] - o[1]) / n];
  const det = ei[0] * ej[1] - ei[1] * ej[0];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return flat();

  /**
   * The lattice continued past its own edge. halfX/halfY bound the *projected*
   * WGS84 rectangle while the lattice is that rectangle turned by convergence,
   * so the site box the ring was clipped to overhangs the lattice at the
   * corners — up to ~15 m on a 600 m site. Extrapolating affinely gives those
   * corners somewhere to land; sampleZ already clamps out there, so they get
   * the edge elevation, which is exactly what the un-conformed path gave the
   * whole polygon. Without this they would simply be dropped.
   */
  const at = (i: number, j: number): Vec2 => {
    const ci = i < 0 ? 0 : i > n ? n : i;
    const cj = j < 0 ? 0 : j > n ? n : j;
    const p = V[cj * (n + 1) + ci];
    const di = i - ci;
    const dj = j - cj;
    return [p[0] + di * ei[0] + dj * ej[0], p[1] + di * ei[1] + dj * ej[1]];
  };

  // Ring bbox -> index window. An affine map takes a rectangle's corners to the
  // image parallelogram's corners, so the four corners bound it exactly.
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  for (const p of r) {
    if (p[0] < bx0) bx0 = p[0];
    if (p[0] > bx1) bx1 = p[0];
    if (p[1] < by0) by0 = p[1];
    if (p[1] > by1) by1 = p[1];
  }
  let i0 = Infinity;
  let j0 = Infinity;
  let i1 = -Infinity;
  let j1 = -Infinity;
  for (const [x, y] of [
    [bx0, by0],
    [bx1, by0],
    [bx1, by1],
    [bx0, by1],
  ]) {
    const dx = x - o[0];
    const dy = y - o[1];
    const fi = (dx * ej[1] - dy * ej[0]) / det;
    const fj = (dy * ei[0] - dx * ei[1]) / det;
    if (fi < i0) i0 = fi;
    if (fi > i1) i1 = fi;
    if (fj < j0) j0 = fj;
    if (fj > j1) j1 = fj;
  }
  // Clamp to a sanity range so a stray ring cannot walk the whole plane.
  const lo = -n;
  const hi = 2 * n;
  i0 = Math.max(lo, Math.floor(i0) - PAD);
  j0 = Math.max(lo, Math.floor(j0) - PAD);
  i1 = Math.min(hi, Math.ceil(i1) + PAD);
  j1 = Math.min(hi, Math.ceil(j1) + PAD);
  if (i1 <= i0 || j1 <= j0) return flat();

  // A lattice finer than CONFORM_STEP is subdivided in blocks rather than
  // cells. Block corners are still draped through sampleZ and so still exact;
  // only a block's interior approximates, by the margin ROAD_STEP already
  // accepts everywhere else.
  const cell = Math.hypot(ei[0], ei[1]);
  let stride = Math.max(1, Math.round(CONFORM_STEP / Math.max(cell, 1e-6)));
  const blocks = (): number =>
    Math.ceil((i1 - i0) / stride) * Math.ceil((j1 - j0) / stride);
  while (blocks() > MAX_BLOCKS) stride++;

  const verts: Vec3[] = [];
  const faces: number[][] = [];
  // Pieces meet on shared corners and shared clip intersections computed from
  // identical numbers, so exact hits are the rule and welding collapses the
  // four copies of every interior corner into one — which is also what keeps
  // proj4 to one call per unique point rather than one per piece vertex. Per
  // ring only: welding across features would fuse neighbouring parcels.
  const seen = new Map<string, number>();
  const push = (p: Vec2): number => {
    const k = `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
    const hit = seen.get(k);
    if (hit !== undefined) return hit;
    const [lonv, latv] = toGeo(p[0], p[1]);
    verts.push([p[0], p[1], sampleZ(latv, lonv) + dz]);
    seen.set(k, verts.length - 1);
    return verts.length - 1;
  };

  /**
   * The faces of `terrain.faces` a window covers, in the order they were built
   * (see lib/sources/ign): cell (i,j) is face 2*(j*n+i) for the half gridSampler
   * takes when tx+ty <= 1, and the next index for the other. Only cells on the
   * lattice count — the walk is padded and can run outside it, where there is
   * no real terrain to take away.
   */
  const facesOf = (i: number, j: number, inx: number, jn: number, half: number): number[] => {
    const out: number[] = [];
    for (let jj = Math.max(j, 0); jj < Math.min(jn, n); jj++)
      for (let ii = Math.max(i, 0); ii < Math.min(inx, n); ii++) {
        const base = 2 * (jj * n + ii);
        if (half < 0) out.push(base, base + 1);
        else out.push(base + half);
      }
    return out;
  };

  // Walking +i then +j comes out counter-clockwise in every projection that
  // puts east on +x and north on +y, which is all of them here — but a clip
  // window wound the wrong way keeps the complement and returns nothing, so
  // the sign is taken off the lattice rather than assumed.
  const emit = (w: Vec2[], covers: number[]): void => {
    const win = det > 0 ? w : w.slice().reverse();
    const piece = dedupe(clipToConvex(r, win));
    const area = Math.abs(signedArea(piece));
    if (coverage && covers.length) {
      // The fraction of the window the ring took. A block stands for every cell
      // in it, so a fully covered block means every one of them is covered too.
      const whole = Math.abs(signedArea(win));
      const f = whole > 0 ? area / whole : 0;
      for (const k of covers) coverage.set(k, (coverage.get(k) ?? 0) + f);
    }
    if (piece.length < 3 || area < MIN_AREA) return;
    const idx = piece.map(push);
    for (const t of triangulate(piece)) faces.push([idx[t[0]], idx[t[1]], idx[t[2]]]);
  };

  for (let j = j0; j < j1; j += stride) {
    const jn = Math.min(j + stride, j1);
    for (let i = i0; i < i1; i += stride) {
      const inx = Math.min(i + stride, i1);
      const a = at(i, j);
      const b = at(inx, j);
      const c = at(inx, jn);
      const d = at(i, jn);
      if (stride === 1) {
        // The two real terrain triangles, built from indices rather than read
        // out of terrain.faces so the window's winding is known here rather
        // than inherited. These are the same halves gridSampler splits on,
        // which is the whole reason a piece inside one lands exactly on the
        // drawn surface.
        emit([a, b, d], facesOf(i, j, inx, jn, 0));
        emit([b, c, d], facesOf(i, j, inx, jn, 1));
      } else {
        // A block's diagonal is not a real fold, so splitting it would double
        // the pieces for the same answer.
        emit([a, b, c, d], facesOf(i, j, inx, jn, -1));
      }
    }
  }

  // Entirely off the lattice, or nothing but slivers: fall back rather than
  // return an empty layer, so this is never worse than the path it replaced.
  return faces.length ? { verts, faces } : flat();
}

/**
 * Drop the terrain faces an opaque layer has completely buried.
 *
 * Two surfaces a few centimetres apart and exactly parallel — which is what
 * conforming makes them — is the worst case a depth buffer can be handed, and
 * zoomed out a viewer resolves decimetres. The preview papers over it with
 * polygon offset and render order; IFC has no such thing, so the file has to
 * not contain the argument in the first place. Ground nobody can see is ground
 * worth leaving out.
 *
 * Only *fully* covered faces go. A partly covered one is still visible at the
 * layer's edge, and keeping it guarantees the layer overlaps what remains
 * rather than leaving a hole along the boundary. Orphaned vertices stay put:
 * they cost a handful of points and keep every face index meaning what it did.
 */
export function cutCovered(terrain: Grid, coverage: Map<number, number>): Grid {
  if (!coverage.size) return terrain;
  const faces = terrain.faces.filter((_, k) => (coverage.get(k) ?? 0) < FULLY_COVERED);
  return faces.length === terrain.faces.length ? terrain : { ...terrain, faces };
}
