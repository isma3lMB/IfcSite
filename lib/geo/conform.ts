import { DEFAULT_TUNABLES } from '@/lib/build/tunables';
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

/* Block size in metres when the lattice is finer than a drape needs is now
   `tune.conformStep` — one number for the whole scene, which is what the old
   CONFORM_STEP and VEG_STEP were already trying to be. Two stations to a 15 m
   IGN cell is already more than the DEM knows, and past it the pieces cost
   entities, not fidelity.

   Roads used to pre-split their centrelines to the same number before
   buffering. They no longer do — the cut below gives them stations off the
   terrain's own lattice, which is strictly better than any fixed span, and the
   pre-split was feeding the boolean layer collinear quad pairs it throws on.
   See pushRoadway in lib/scene/push. */

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

type LatticeFrame = {
  n: number;
  at: (i: number, j: number) => Vec2;
  toIndex: (p: Vec2) => Vec2;
  cell: number;
  ccw: boolean;
};

/**
 * The terrain lattice's local affine basis — how index space (i, j) maps to
 * world metres and back.
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
 */
export function conformToTerrain(
  ring: Vec2[],
  terrain: Grid | null,
  toGeo: ToGeo,
  sampleZ: SampleZ,
  dz: number,
  ringHoles: Vec2[][] = [],
  step: number = DEFAULT_TUNABLES.conformStep,
): { verts: Vec3[]; faces: number[][] } {
  const r = ensureCCW(dedupe(ring));
  // Wound against the outer, which is what triangulate and skirtInto both read
  // to tell an island from a surface. Defaulted empty, so every caller that
  // never had holes — vegetation, water, parcels — is untouched.
  //
  // MIN_AREA is doing real work in that filter, not tidying. Ear clipping does
  // not cut a hole out, it bridges to it, and a hole with no interior to aim at
  // gives it nothing to bridge against. Measured: of 346 holes across 133 real
  // merged road regions, 318 were under a square centimetre — union noise where
  // two ribbons run near-tangent, not islands — and one region carrying two
  // three-vertex slivers came back over-covered by 27%, filling ground it never
  // occupied. Above a square centimetre no such case appeared, and a hole below
  // it could not survive the millimetre weld below in any event.
  //
  // A sliver on its own is not enough to provoke it: the same holes dropped into
  // a plain square triangulate correctly. It takes a concave outer as well, so
  // treat the threshold as the empirical guard it is rather than as a theory.
  const hs = ringHoles
    .map(dedupe)
    .filter((h) => h.length >= 3 && Math.abs(signedArea(h)) >= MIN_AREA)
    .map((h) => (signedArea(h) > 0 ? h.slice().reverse() : h));
  // Ear clipping preserves nothing about orientation on its own, so squaring
  // the subject away up front is what makes every piece — and every exported
  // face normal — come out the same way up.
  const flat = (): { verts: Vec3[]; faces: number[][] } => ({
    // Concatenation order is triangulate's index convention: the ring, then
    // each hole in turn. See its doc comment in ./mesh.
    verts: [r, ...hs].flatMap((p) => drape(p, toGeo, sampleZ, dz)),
    faces: triangulate(r, hs),
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

  // A lattice finer than `step` is subdivided in blocks rather than cells.
  // Block corners are still draped through sampleZ and so still exact; only a
  // block's interior approximates, by the margin `step` sets.
  let stride = Math.max(1, Math.round(step / Math.max(frame.cell, 1e-6)));
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
   * One cut piece into the faceset. Every piece reaching here is a triangle
   * intersected with a convex block, so it is convex, and a fan off vertex 0
   * triangulates a convex polygon exactly — no ear clipping, and no way to
   * emit a triangle the piece does not cover.
   *
   * The two guards are for degeneracies the fan would otherwise pass through:
   * a clip leaves collinear corners, and `push` welds at a millimetre so two
   * corners of a sliver can come back as one index. Both make zero-area faces,
   * which draw nothing but do corrupt skirtInto's edge parity — it counts an
   * edge's uses to decide what is boundary, and a degenerate face votes twice.
   */
  const add = (piece: Vec2[]): void => {
    if (piece.length < 3 || Math.abs(signedArea(piece)) < MIN_AREA) return;
    const idx = piece.map(push);
    for (let k = 2; k < piece.length; k++) {
      const [u, v, w] = [idx[0], idx[k - 1], idx[k]];
      if (u === v || v === w || u === w) continue;
      const [ax, ay] = piece[0];
      const [bx, by] = piece[k - 1];
      const [cx, cy] = piece[k];
      if (Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) < 1e-9) continue;
      faces.push([u, v, w]);
    }
  };

  // Walking +i then +j comes out counter-clockwise in every projection that
  // puts east on +x and north on +y, which is all of them here — but a clip
  // window wound the wrong way keeps the complement and returns nothing, so
  // the sign is taken off the lattice rather than assumed.
  const window = (w: Vec2[]): Vec2[] => (frame.ccw ? w : w.slice().reverse());

  /* ---------------------------------------------------------------------
     Triangulate first, cut second — and never the other way round.

     clipToConvex is Sutherland-Hodgman, and its return type is one ring. When
     a window severs a concave subject into disjoint pieces it cannot say so:
     it hands back the pieces strung together by connector edges that run along
     the clip line and are walked twice in opposite directions. The area is
     right, which is what ./rings used to claim made it harmless. It isn't,
     because the consumer is ear clipping, and ear clipping cannot see that the
     ring overlaps itself: when its ear loop stalls on a connector it deletes
     the collinear vertices, links the two lobes directly, and fills the gap
     between them. That is a triangle spanning open ground — a road stitched to
     the road on the far side of the street.

     Cutting triangles instead removes the failure rather than guarding against
     it. A triangle is convex, a block is convex, and the intersection of two
     convex sets is one convex set, so Sutherland-Hodgman is exact here and
     there is no second component for it to lose. Ear clipping runs once per
     region, on the whole simple polygon with its real holes, which is the one
     input it is reliable on.

     It is also the cheaper order. Clipping the ring per block was O(blocks x
     ring vertices) — 45 s on a site once roads genuinely merged into one region
     of several thousand vertices. This is O(triangles x blocks each covers)
     with a three-vertex subject.
     --------------------------------------------------------------------- */

  // Ear clipping indexes into the ring followed by each hole in turn — the
  // convention triangulate documents and flat() above already depends on.
  const src = [r, ...hs].flat();
  for (const t of triangulate(r, hs)) {
    const tri = [src[t[0]], src[t[1]], src[t[2]]];

    // The blocks this triangle can reach. An affine map takes a rectangle's
    // corners to the image parallelogram's corners, so the bbox corners bound
    // the index window exactly; snapping outward to stride keeps the blocks
    // aligned with the ones the whole-ring loop used to visit.
    let tx0 = Infinity;
    let ty0 = Infinity;
    let tx1 = -Infinity;
    let ty1 = -Infinity;
    for (const p of tri) {
      if (p[0] < tx0) tx0 = p[0];
      if (p[0] > tx1) tx1 = p[0];
      if (p[1] < ty0) ty0 = p[1];
      if (p[1] > ty1) ty1 = p[1];
    }
    let ti0 = Infinity;
    let tj0 = Infinity;
    let ti1 = -Infinity;
    let tj1 = -Infinity;
    for (const c of [
      [tx0, ty0],
      [tx1, ty0],
      [tx1, ty1],
      [tx0, ty1],
    ] as Vec2[]) {
      const [fi, fj] = frame.toIndex(c);
      if (fi < ti0) ti0 = fi;
      if (fi > ti1) ti1 = fi;
      if (fj < tj0) tj0 = fj;
      if (fj > tj1) tj1 = fj;
    }
    const snap = (v: number, up: boolean): number => {
      const k = (up ? Math.ceil : Math.floor)((v - i0) / stride);
      return i0 + k * stride;
    };
    const snapJ = (v: number, up: boolean): number => {
      const k = (up ? Math.ceil : Math.floor)((v - j0) / stride);
      return j0 + k * stride;
    };
    const ai = Math.max(i0, snap(Math.floor(ti0) - PAD, false));
    const aj = Math.max(j0, snapJ(Math.floor(tj0) - PAD, false));
    const bi = Math.min(i1, snap(Math.ceil(ti1) + PAD, true));
    const bj = Math.min(j1, snapJ(Math.ceil(tj1) + PAD, true));

    for (let j = aj; j < bj; j += stride) {
      const jn = Math.min(j + stride, j1);
      for (let i = ai; i < bi; i += stride) {
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
          add(dedupe(clipToConvex(tri, window([a, b, d]))));
          add(dedupe(clipToConvex(tri, window([b, c, d]))));
        } else {
          // A block's diagonal is not a real fold, so splitting it would double
          // the pieces for the same answer.
          add(dedupe(clipToConvex(tri, window([a, b, c, d]))));
        }
      }
    }
  }

  // Entirely off the lattice, or nothing but slivers: fall back rather than
  // return an empty layer, so this is never worse than the path it replaced.
  return faces.length ? { verts, faces } : flat();
}

