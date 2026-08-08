import { differenceRings } from '@/lib/geo/boolean';
import { MAX_GRID_N } from '@/lib/geo/grid';
import { drape, triangulate } from '@/lib/geo/mesh';
import { clipToConvex, dedupe, densify, ensureCCW, signedArea } from '@/lib/geo/rings';
import type { CutAccumulator, Grid, SampleZ, ToGeo, Vec2, Vec3 } from '@/lib/types';

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

type LatticeFrame = {
  n: number;
  at: (i: number, j: number) => Vec2;
  toIndex: (p: Vec2) => Vec2;
  cell: number;
  ccw: boolean;
};

/**
 * The terrain lattice's local affine basis — how index space (i, j) maps to
 * world metres and back. Pulled out of conformToTerrain so touchedFaces can
 * walk the same lattice the same way; the two must never disagree about
 * where a cell actually sits.
 */
function latticeFrame(terrain: Grid | null): LatticeFrame | null {
  if (!terrain || terrain.n < 1) return null;
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
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;

  /**
   * The lattice continued past its own edge. halfX/halfY bound the *projected*
   * WGS84 rectangle while the lattice is that rectangle turned by convergence,
   * so the site box a ring was clipped to overhangs the lattice at the
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
  const toIndex = (p: Vec2): Vec2 => {
    const dx = p[0] - o[0];
    const dy = p[1] - o[1];
    return [(dx * ej[1] - dy * ej[0]) / det, (dy * ei[0] - dx * ei[1]) / det];
  };
  return { n, at, toIndex, cell: Math.hypot(ei[0], ei[1]), ccw: det > 0 };
}

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
  const frame = latticeFrame(terrain);
  if (r.length < 3 || !frame) return flat();
  const { n, at } = frame;

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
  const corners: Vec2[] = [
    [bx0, by0],
    [bx1, by0],
    [bx1, by1],
    [bx0, by1],
  ];
  for (const c of corners) {
    const [fi, fj] = frame.toIndex(c);
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
  let stride = Math.max(1, Math.round(CONFORM_STEP / Math.max(frame.cell, 1e-6)));
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
    const win = frame.ccw ? w : w.slice().reverse();
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
 * Real terrain faces (indices into terrain.faces, at the lattice's native
 * per-cell resolution — never coarsened by CONFORM_STEP/stride) whose
 * triangle is crossed by `ring`'s own boundary. Bounded by O(ring boundary
 * length / terrain cell size): only the edges are walked, never the ring's
 * interior or conformToTerrain's full index-space bbox, so this stays cheap
 * even on a large or complex ring.
 *
 * Densifying at half a cell keeps two consecutive samples from ever
 * straddling a whole cell, and marking the 2x2 block behind each sample
 * absorbs the same floating-point margin PAD exists for above: a sample
 * landing a hair on the wrong side of a lattice line still marks the cell it
 * was meant to.
 */
export function touchedFaces(ring: Vec2[], terrain: Grid | null): Set<number> {
  const out = new Set<number>();
  const frame = latticeFrame(terrain);
  const r = dedupe(ring);
  if (!frame || r.length < 2) return out;
  const { n, toIndex, cell } = frame;
  const step = Math.max(cell / 2, 1e-6);
  const mark = (fi: number, fj: number): void => {
    const ci = Math.floor(fi);
    const cj = Math.floor(fj);
    for (let dj = -1; dj <= 0; dj++) {
      const jj = cj + dj;
      if (jj < 0 || jj >= n) continue;
      for (let di = -1; di <= 0; di++) {
        const ii = ci + di;
        if (ii < 0 || ii >= n) continue;
        const base = 2 * (jj * n + ii);
        out.add(base);
        out.add(base + 1);
      }
    }
  };
  for (const p of densify(r, step, true)) {
    const [fi, fj] = toIndex(p);
    mark(fi, fj);
  }
  return out;
}

/** How many pieces one triangle split may produce before it's cheaper to
 *  keep the whole triangle than to trust the answer — a real cut resolves to
 *  a handful of pieces, so past this the rings crossing this triangle are
 *  pathological rather than more precision being available to extract. Same
 *  defensive posture as MIN_AREA/PAD above. */
const MAX_SPLIT_PIECES = 16;

/**
 * Cut the terrain triangle-by-triangle instead of leaving a partly-covered
 * one whole.
 *
 * Two surfaces a few centimetres apart and exactly parallel — which is what
 * conforming makes them — is the worst case a depth buffer can be handed, and
 * zoomed out a viewer resolves decimetres. The preview papers over it with
 * polygon offset and render order; IFC has no such thing, so the file has to
 * not contain the argument in the first place. Ground nobody can see is ground
 * worth leaving out.
 *
 * `coverage`'s fraction is still the fast path: fully covered drops outright,
 * and untouched-or-uncovered stays exactly as drawn. Only a face that is both
 * partly covered AND named in `touched` pays for an exact split — re-clipping
 * `rings` against just that one triangle, which is cheap precisely because
 * `touched` bounded the candidates to the cutting features' own boundaries.
 * A face terrain.faces[k]'s corners are already CCW in local metres (see the
 * comment where ign.ts/terrain.ts build them), so the triangle needs no
 * winding correction the way conformToTerrain's generic window does.
 */
export function cutAndSplitCovered(terrain: Grid, cut: CutAccumulator, toGeo: ToGeo): Grid {
  const { coverage, touched, rings } = cut;
  if (!coverage.size) return terrain;

  const verts: Vec3[] = terrain.verts.slice();
  const faces: number[][] = [];
  const seen = new Map<string, number>();
  const pushVert = (p: Vec2): number => {
    const k = `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
    const hit = seen.get(k);
    if (hit !== undefined) return hit;
    const [lonv, latv] = toGeo(p[0], p[1]);
    const idx = verts.length;
    verts.push([p[0], p[1], terrain.sample(latv, lonv)]);
    seen.set(k, idx);
    return idx;
  };

  let changed = false;
  for (let k = 0; k < terrain.faces.length; k++) {
    const face = terrain.faces[k];
    const cov = coverage.get(k) ?? 0;
    if (cov >= FULLY_COVERED) {
      changed = true;
      continue;
    }
    if (cov <= 0 || !touched.has(k)) {
      faces.push(face);
      continue;
    }

    const [ia, ib, ic] = face;
    const tri: Vec2[] = [verts[ia], verts[ib], verts[ic]].map(([x, y]): Vec2 => [x, y]);
    let tx0 = Infinity;
    let ty0 = Infinity;
    let tx1 = -Infinity;
    let ty1 = -Infinity;
    for (const [x, y] of tri) {
      if (x < tx0) tx0 = x;
      if (x > tx1) tx1 = x;
      if (y < ty0) ty0 = y;
      if (y > ty1) ty1 = y;
    }

    const clippedPieces: Vec2[][] = [];
    for (const ring of rings) {
      let rx0 = Infinity;
      let ry0 = Infinity;
      let rx1 = -Infinity;
      let ry1 = -Infinity;
      for (const [x, y] of ring) {
        if (x < rx0) rx0 = x;
        if (x > rx1) rx1 = x;
        if (y < ry0) ry0 = y;
        if (y > ry1) ry1 = y;
      }
      if (rx1 < tx0 || rx0 > tx1 || ry1 < ty0 || ry0 > ty1) continue;
      const piece = dedupe(clipToConvex(ring, tri));
      if (piece.length < 3 || Math.abs(signedArea(piece)) < MIN_AREA) continue;
      clippedPieces.push(piece);
    }
    if (!clippedPieces.length) {
      faces.push(face);
      continue;
    }

    const remaining = differenceRings(tri, clippedPieces);
    if (!remaining.length) {
      changed = true;
      continue;
    }
    if (remaining.length > MAX_SPLIT_PIECES) {
      faces.push(face);
      continue;
    }

    changed = true;
    for (const { outer, holes } of remaining) {
      const oIdx = outer.map(pushVert);
      const hIdx = holes.map((h) => h.map(pushVert));
      const allIdx = [...oIdx, ...hIdx.flat()];
      for (const t of triangulate(outer, holes)) faces.push([allIdx[t[0]], allIdx[t[1]], allIdx[t[2]]]);
    }
  }

  return changed ? { ...terrain, verts, faces } : terrain;
}
