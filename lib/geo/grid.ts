import { DEFAULT_TUNABLES } from '@/lib/build/tunables';
import type { SampleZ, SiteRect, TerrainAccuracy } from '@/lib/types';

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
