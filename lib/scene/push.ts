import { unionRings } from '@/lib/geo/boolean';
import { conformToTerrain } from '@/lib/geo/conform';
import { skirtInto } from '@/lib/geo/mesh';
import { clipPolyline, clipToBox, dedupe, densify, ensureCCW, ringCentre } from '@/lib/geo/rings';
import { LAYER_DZ, skirtDepth } from '@/lib/scene/stack';
import { newXf } from '@/lib/scene/xf';
import type {
  HeightSource,
  PropBag,
  SampleZ,
  SceneData,
  Site,
  ToGeo,
  Tree,
  Vec2,
  Vec3,
} from '@/lib/types';

/** Past this the browser, not the services, becomes the bottleneck. */
export const BUILDING_CAP = 4000;

/**
 * Shared by both providers: a footprint ring in local metres becomes a scene
 * record whose ring is relative to its own centroid, so rotation and scale
 * pivot on the building rather than on a site origin hundreds of metres away.
 */
export function pushBuilding(
  scene: SceneData,
  ring: Vec2[],
  h: number,
  src: HeightSource,
  baseZ: number,
  id: string,
  name: string,
  props: PropBag,
): boolean {
  const ccw = ensureCCW(dedupe(ring));
  if (ccw.length < 3) return false;
  const [cx, cy] = ringCentre(ccw);
  scene.buildings.push({
    id,
    name,
    props,
    ring: ccw.map((p): Vec2 => [p[0] - cx, p[1] - cy]),
    center: [cx, cy],
    h,
    baseZ,
    src,
    xf: newXf(),
  });
  return true;
}

/**
 * Crown/trunk radius for a tree of the given height, when nothing more
 * specific is known. Mirrors the OSM-tag fallback in lib/sources/overpass so
 * a hand-placed tree and an untagged fetched one read the same size.
 */
export function defaultTreeDims(h: number): { cr: number; tr: number } {
  return { cr: Math.max(Math.min(2.5, h * 0.32), 0.4), tr: 0.15 };
}

/** A single planted tree — fetched or hand-placed, both go through here. */
export function pushTree(
  scene: SceneData,
  x: number,
  y: number,
  z: number,
  h: number,
  cr: number,
  tr: number,
  id: string,
  name: string,
  props: PropBag,
  src: Tree['src'],
): void {
  scene.trees.push({ id, x, y, z, h, cr, tr, name, props, xf: newXf(), src });
}

/** Stations closer than this add vertices without adding fidelity: the IGN grid
 * is ~15 m, so two samples a cell is already more than the DEM knows. */
const ROAD_STEP = 8;

/**
 * One quad per centreline segment, cut to the site box, unioned into one (or
 * a handful, if the clip split the road into separate runs) clean ribbon per
 * road before it's appended to the caller-owned `rings` collector — rather
 * than drapped or pushed into the scene directly. Unioning here, per road,
 * fixes a single road's own bend/junction raggedness (each segment stops
 * being its own independent, unjoined quad) and keeps the batch handed to
 * the boolean library small: finishRoads below still does one more union
 * across every road's ribbon to merge where distinct roads cross, but by
 * then the input is a few dozen simple polygons instead of thousands of raw
 * quads, which is both cheaper and far less likely to hit the sweep line's
 * failure modes on real-world road geometry.
 *
 * The clip is not cosmetic. Overpass `out geom` and the IGN WFS BBOX are both
 * *intersects* filters, so a motorway that catches one corner of the site
 * arrives whole — tens of kilometres of it. Left uncut that ribbon runs off the
 * terrain grid, where sampleZ can only return the clamped edge elevation, and
 * carries every one of those vertices into the IFC. Vegetation and water have
 * been clipped since they were added (lib/sources/ign), and the hedge ribbon is
 * this same buffered quad with the same clipToBox on it; roads were the layer
 * the call was missing from.
 *
 * Order matters here. The centreline is filtered first, against the box grown
 * by half a carriageway so a road running just outside still contributes the
 * half of its surface that is inside; only what survives is densified and
 * buffered. Doing it the other way round pays ~10000 proj4 inversions per long
 * way to produce a handful of quads, and lets DENSIFY_CAP run out before
 * reaching the stretch that is actually on site.
 */
export function pushRoadway(rings: Vec2[][], pts: Vec2[], w: number, site: Site): void {
  const { halfX, halfY } = site;
  const m = w / 2;
  const quads: Vec2[][] = [];
  for (const run of clipPolyline(pts, -halfX - m, -halfY - m, halfX + m, halfY + m)) {
    const line = densify(run, ROAD_STEP);
    for (let i = 0; i < line.length - 1; i++) {
      const [x1, y1] = line[i];
      const [x2, y2] = line[i + 1];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const L = Math.hypot(dx, dy);
      if (L < 0.5) continue;
      const nx = (-dy / L) * m;
      const ny = (dx / L) * m;
      const face = clipToBox(
        [
          [x1 + nx, y1 + ny],
          [x1 - nx, y1 - ny],
          [x2 - nx, y2 - ny],
          [x2 + nx, y2 + ny],
        ],
        -halfX,
        -halfY,
        halfX,
        halfY,
      );
      if (face.length >= 3) quads.push(face);
    }
  }
  for (const { outer } of unionRings(quads)) rings.push(outer);
}

/**
 * The other half of what pushRoadway started. Every road's own ribbon,
 * collected across the whole build — both providers push into the same
 * array — is unioned once more here, which is what merges the overlap where
 * two distinct roads cross (the raggedness within a single road's own bends
 * was already resolved per-road, inside pushRoadway, before it got here).
 * A ribbon's holes are dropped: a road ribbon degenerating into a donut
 * (a roundabout fully encircling paved-free ground) is rare, and geoRings()
 * in lib/sources/ign already discards holes from every source polygon the
 * same way, so this is consistent with, not a regression from, the rest of
 * the pipeline.
 *
 * Each merged ribbon then goes through conformToTerrain exactly like a water
 * or vegetation ring — real terrain-conforming geometry instead of a flat
 * per-corner drape — and skirtInto closes it into a solid off that same
 * surface's own outline, so the wall cannot come apart from the skin it hangs
 * from. The skirt goes into `roadWalls`, kept separate from `roads` so the
 * viewer's EdgesGeometry outline pass — built off `roads` alone — doesn't pick
 * up the skirt's vertical and floor edges; `skirtInto`'s return index is what
 * splits the one faceset back into those two.
 */
export function finishRoads(
  scene: SceneData,
  rings: Vec2[][],
  toGeo: ToGeo,
  sampleZ: SampleZ,
): void {
  if (!rings.length) return;
  for (const { outer } of unionRings(rings)) {
    const { verts, faces } = conformToTerrain(outer, scene.terrain, toGeo, sampleZ, LAYER_DZ.road);
    if (!faces.length) continue;
    const skirt = skirtInto(verts, faces, skirtDepth('road'));
    const tri = (t: number[]): Vec3[] => [verts[t[0]], verts[t[1]], verts[t[2]]];
    for (let i = 0; i < skirt; i++) scene.roads.push(tri(faces[i]));
    for (let i = skirt; i < faces.length; i++) scene.roadWalls.push(tri(faces[i]));
  }
}
