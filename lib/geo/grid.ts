import { DEFAULT_TUNABLES } from '@/lib/build/tunables';
import type { Grid, SampleZ, SiteRect, TerrainAccuracy, ToLocal, Vec2, Vec3 } from '@/lib/types';

/**
 * Target ground cell size, in metres, for each accuracy level.
 *
 * `max` names RGE ALTI's true 1 m resolution rather than what a given site can
 * afford: the providers clamp against their own budgets below, so a large site
 * degrades smoothly instead of the level lying about a ceiling it cannot reach.
 * Terrarium bottoms out around 3 m whatever is asked for — the tiles have no
 * more in them.
 */
export const ACCURACY_CELL: Record<TerrainAccuracy, number> = {
  coarse: 30,
  standard: 15,
  fine: 5,
  max: 1,
};

/**
 * The densest grid any provider may build: 212^2 = 44944 vertices.
 *
 * Two ceilings happen to meet at the same number. It is exactly what RGE ALTI's
 * 5000-posts-per-request buys across the nine requests lib/sources/ign is
 * willing to make, and it is about as much as the IFC writer can emit without
 * the deliverable becoming unopenable — every vertex is its own
 * IfcCartesianPoint. Terrarium is held to it too, for the second reason.
 *
 * It lives here rather than beside either fetch so the options panel can predict
 * the grid without importing the WFS module — and with it three.js, via the mesh
 * helpers — into the panel's chunk.
 *
 * The panel can now lower it per build (`tune.maxGridN`); this stays the ceiling
 * that lowering happens under, and MAX_BLOCKS in lib/geo/conform still sizes
 * itself off it. The number is not round because it cannot be: it is the largest
 * N with (N+1)^2 <= ALTI_MAX * ALTI_MAX_CHUNKS, which is why TUNE_RANGE pins the
 * slider's maximum here rather than anywhere convenient.
 */
export const MAX_GRID_N = DEFAULT_TUNABLES.maxGridN;

/**
 * Cells across the site for a target cell size, given whatever ceiling the
 * provider can afford. Both DEM paths and the options panel's cell readout go
 * through here, so what the panel promises cannot drift from what the builder
 * does.
 */
export const gridSize = (span: number, cell: number, maxN: number): number =>
  Math.min(maxN, Math.max(8, Math.round(span / cell)));

/**
 * An elevation lookup that agrees with the terrain mesh the viewer draws.
 *
 * Both DEM providers lay out an (N+1)^2 lattice in lat/lon and cut every cell
 * into `[a, c, b], [b, c, d]` — the split runs along the anti-diagonal. A
 * bilinear lookup over that same lattice is *not* the same surface: on a twisted
 * cell it sags below the two triangles by up to half the twist, which on a 15 m
 * IGN cell is easily tens of centimetres. Anything placed with the bilinear
 * value — a road, a hedge, a building base — then sinks into the rendered
 * ground. Interpolating barycentrically on the very triangles that get drawn
 * makes a sampled point land exactly on the visible surface, so a few
 * centimetres of dz is once again enough to sit on top of it.
 */
/**
 * The (N+1)^2 lattice the DEM is read on, as [lat, lon] pairs, row-major at
 * `j * (N + 1) + i` with i running west to east and j south to north.
 *
 * Both providers used to write this loop out themselves, and a draft reopening a
 * saved terrain would have been a third copy: the mesh is only reconstructible
 * because the lattice is a pure function of (box, N), and that is a promise three
 * separate loops cannot keep. See the Grid comment in lib/types, which says the
 * producers and it have to stay in step — this is what makes that structural.
 */
export function gridLattice(box: SiteRect, n: number): Vec2[] {
  const out: Vec2[] = [];
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++)
      out.push([
        box.minLat + ((box.maxLat - box.minLat) * j) / n,
        box.minLon + ((box.maxLon - box.minLon) * i) / n,
      ]);
  return out;
}

/**
 * That lattice's triangulation.
 *
 * Counter-clockwise in local metres, so the ground's normals point up like every
 * other surface in the scene; wound the other way the export is one inside-out
 * mesh among right-side-out ones, and a viewer that lights or culls by normal has
 * to guess. Every cell splits on the b-c anti-diagonal, which is the same halving
 * gridSampler below interpolates over — that agreement is what lets lib/geo/conform
 * clip a draped layer onto a triangle and land exactly on the drawn surface.
 */
export function gridFaces(n: number): number[][] {
  const out: number[][] = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      const b = a + 1;
      const c = a + n + 1;
      out.push([a, b, c], [b, c + 1, c]);
    }
  return out;
}

/**
 * A whole Grid from a column of heights.
 *
 * Both DEM providers and the draft loader end here, so a reopened terrain is the
 * mesh that was saved rather than one that merely resembles it: `verts[k][2]` is
 * `zn[k]`, `verts[k]`'s xy is the projection of `gridLattice`'s kth point, and
 * `faces` is a pure function of n. That is what lets a saved site carry the
 * (N+1)^2 lattice as just `{n, zn}` and rebuild the rest exactly — see lib/io/draft.
 */
export function gridFrom(box: SiteRect, n: number, zn: number[], toLocal: ToLocal): Grid {
  const verts: Vec3[] = gridLattice(box, n).map(([la, lo], k) => {
    const p = toLocal(lo, la);
    return [p[0], p[1], zn[k]];
  });
  return { n, verts, faces: gridFaces(n), sample: gridSampler(zn, n, box) };
}

export function gridSampler(zn: number[], N: number, box: SiteRect): SampleZ {
  const at = (a: number, b: number) => zn[b * (N + 1) + a];
  return (la, lo) => {
    const fx = Math.max(
      0,
      Math.min(N - 1e-6, ((lo - box.minLon) / (box.maxLon - box.minLon)) * N),
    );
    const fy = Math.max(
      0,
      Math.min(N - 1e-6, ((la - box.minLat) / (box.maxLat - box.minLat)) * N),
    );
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    // Lower-left triangle [a, c, b] holds tx + ty <= 1; the rest is [b, c, d].
    return tx + ty <= 1
      ? at(i, j) + tx * (at(i + 1, j) - at(i, j)) + ty * (at(i, j + 1) - at(i, j))
      : at(i + 1, j + 1) +
          (1 - tx) * (at(i, j + 1) - at(i + 1, j + 1)) +
          (1 - ty) * (at(i + 1, j) - at(i + 1, j + 1));
  };
}
