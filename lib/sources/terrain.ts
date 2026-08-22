import type { Tunables } from '@/lib/build/tunables';
import { AppError } from '@/lib/errors';
import { MAX_GRID_N, gridFrom, gridLattice, gridSize } from '@/lib/geo/grid';
import { TILE_MAX, memo, tileMemo, trimMemo } from '@/lib/sources/cache';
import type { Grid, Site, SiteRect, StatusFn, ToLocal } from '@/lib/types';
import { paint } from '@/lib/ui/yield';

/* =====================================================================
   Terrain — AWS Terrarium tiles, elevation packed into RGB
   ===================================================================== */

export function tileXY(lat: number, lon: number, z: number): { x: number; y: number; z: number } {
  const n = 2 ** z;
  const la = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n),
    z,
  };
}

/** Ground resolution of one tile pixel. 256px tiles, so the usual /2**z form. */
const mppAt = (z: number, lat: number): number =>
  (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

/** elevation-tiles-prod carries terrarium up to z15; below z12 is uselessly coarse. */
const Z_MIN = 12;
const Z_MAX = 15;
/** A site at maximum accuracy must not turn into a forty-tile download. */
const MAX_TILES = 9;

/**
 * Zoom for a target cell size: one pixel per cell is where asking for more
 * detail stops buying any. A site can still span several tiles at that zoom, so
 * step back down rather than fetch the whole mosaic.
 *
 * Pure and exported because the options dock predicts the resulting grid from it
 * — a readout that promised a density the fetch would not deliver would be worse
 * than no readout.
 */
export function pickZoom(rect: SiteRect, lat: number, cell: number): number {
  let z = Z_MIN;
  while (z < Z_MAX && mppAt(z, lat) > cell) z++;
  const tiles = (zz: number) => {
    const tl = tileXY(rect.maxLat, rect.minLon, zz);
    const br = tileXY(rect.minLat, rect.maxLon, zz);
    return (br.x - tl.x + 1) * (br.y - tl.y + 1);
  };
  while (z > Z_MIN && tiles(z) > MAX_TILES) z--;
  return z;
}

/**
 * Cells across the site, never finer than the pixels behind them: past that the
 * extra triangles carry interpolation, not terrain, and they are paid for again
 * in the IFC.
 */
export function terrariumN(
  rect: SiteRect,
  lat: number,
  span: number,
  cell: number,
  maxN: number = MAX_GRID_N,
): number {
  const mpp = mppAt(pickZoom(rect, lat, cell), lat);
  return gridSize(span, cell, Math.max(8, Math.min(maxN, Math.floor(span / mpp))));
}

/**
 * A decoded tile, kept for the session.
 *
 * The easy one of the caches: a tile is already a quantised rectangle, so it
 * gets area reuse for free with no bbox arithmetic at all — a twenty-metre nudge
 * lands on the same nine tiles, and a site inside a bigger one shares most of
 * them. The browser already HTTP-caches the PNG bytes; what this saves is the
 * decode, which is what the nine parallel loads below actually wait on. Holding
 * the promise rather than the image also means the same tile asked for twice in
 * one mosaic is fetched once.
 */
const loadTile = (z: number, x: number, y: number): Promise<HTMLImageElement> =>
  memo(tileMemo, `${z}/${x}/${y}`, () => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    return new Promise<HTMLImageElement>((ok, no) => {
      img.onload = () => {
        trimMemo(tileMemo, TILE_MAX);
        ok(img);
      };
      img.onerror = () => no(new AppError('err.terrainTileBlocked'));
      img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
    });
  }, false);

export async function terrariumGrid(
  site: Site,
  toLocal: ToLocal,
  cell: number,
  onStatus: StatusFn,
  tune: Tunables,
): Promise<Grid> {
  const z = pickZoom(site, site.lat, cell);
  const tl = tileXY(site.maxLat, site.minLon, z);
  const br = tileXY(site.minLat, site.maxLon, z);
  const nx = br.x - tl.x + 1;
  const ny = br.y - tl.y + 1;

  // The original read a single tile and clamped to its 256px edge, which left a
  // site straddling a tile boundary with a flat strip along it. Stitching the
  // tiles the rectangle actually covers is what removes that seam.
  //
  // They load in parallel, so the count is the order they land in rather than
  // the order they were asked for — which is what makes it a progress reading
  // and not a queue position. One tile has nothing to count, and the caller has
  // already said what is happening; the same guard rgeAltiGrid uses on chunks.
  const total = nx * ny;
  let done = 0;
  const tiles = await Promise.all(
    Array.from({ length: total }, (_, k) =>
      loadTile(z, tl.x + (k % nx), tl.y + Math.floor(k / nx)).then((img) => {
        done++;
        if (total > 1) onStatus('status.readingTerrainTiles', { done, total });
        return img;
      }),
    ),
  );

  // Stitching a 768² mosaic, reading it back out of the canvas and sampling a
  // lattice over it is all synchronous — the line above would otherwise be the
  // last thing painted before the page stops responding.
  onStatus('status.buildingTerrain');
  await paint();

  const W = nx * 256;
  const H = ny * 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  tiles.forEach((img, k) => g.drawImage(img, (k % nx) * 256, Math.floor(k / nx) * 256));
  const px = g.getImageData(0, 0, W, H).data;

  const n = 2 ** z;
  // Global pixel coordinates, then shifted into the mosaic.
  const lon2x = (L: number) => (((L + 180) / 360) * n - tl.x) * 256;
  const lat2y = (L: number) => {
    const a = (L * Math.PI) / 180;
    return (((1 - Math.log(Math.tan(a) + 1 / Math.cos(a)) / Math.PI) / 2) * n - tl.y) * 256;
  };
  const at = (x: number, y: number): number => {
    const i = (y * W + x) * 4;
    return px[i] * 256 + px[i + 1] + px[i + 2] / 256 - 32768;
  };
  // Bilinear, where the original took the nearest pixel. Nearest is invisible at
  // N=16 and terraces badly once the grid approaches the raster's own
  // resolution, which is exactly what the finer accuracy levels ask for. This is
  // not the bilinear that lib/geo/grid warns about: that one is over the mesh
  // lattice, and the warning is that it disagrees with the triangles actually
  // drawn. Here it only smooths the heights the lattice is built from — the mesh
  // and gridSampler stay barycentric and in step.
  const rasterZ = (la: number, lo: number): number => {
    const fx = Math.max(0, Math.min(W - 1, lon2x(lo)));
    const fy = Math.max(0, Math.min(H - 1, lat2y(la)));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(W - 1, x0 + 1);
    const y1 = Math.min(H - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const top = at(x0, y0) + tx * (at(x1, y0) - at(x0, y0));
    const bot = at(x0, y1) + tx * (at(x1, y1) - at(x0, y1));
    return top + ty * (bot - top);
  };

  const span = 2 * Math.max(site.halfX, site.halfY);
  const N = terrariumN(site, site.lat, span, cell, tune.maxGridN);

  const zn = gridLattice(site, N).map(([la, lo]) => rasterZ(la, lo));
  // Lookups interpolate the mesh rather than the raster it came from: the raster
  // is finer, so its answer routinely disagrees with the ground actually drawn
  // and everything draped on it sinks in. gridFrom is what guarantees the mesh
  // and the sampler come off the same lattice — see lib/geo/grid.
  return gridFrom(site, N, zn, toLocal);
}
