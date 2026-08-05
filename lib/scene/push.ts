import { clipPolyline, clipToBox, dedupe, densify, ensureCCW, ringCentre } from '@/lib/geo/rings';
import { LAYER_DZ } from '@/lib/scene/stack';
import { newXf } from '@/lib/scene/xf';
import type {
  HeightSource,
  PropBag,
  SampleZ,
  SceneData,
  Site,
  ToGeo,
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

/** Stations closer than this add vertices without adding fidelity: the IGN grid
 * is ~15 m, so two samples a cell is already more than the DEM knows. */
const ROAD_STEP = 8;

/**
 * One quad per centreline segment, cut to the site box. Crude at junctions, but
 * it needs no buffer/union library. For clean joins bring in turf or
 * polygon-clipping.
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
 * draped. Doing it the other way round pays ~10000 proj4 inversions per long
 * way to produce a handful of quads, and lets DENSIFY_CAP run out before
 * reaching the stretch that is actually on site.
 *
 * Elevation is looked up at every corner rather than at the centreline:
 * a carriageway is up to 13 m wide, so a quad held flat across its width cuts
 * into the hillside on any cross-slope and the road vanishes behind the ground.
 * Draping every corner banks the ribbon with the terrain — not how a road is
 * built, but at this level of detail a ribbon that never buries and never
 * floats beats a geometrically honest one that does both. Draping *after* the
 * clip is what makes the cut edge sit flush: the vertices the clip introduces on
 * the boundary get their own sample instead of one interpolated from off-site.
 */
export function pushRoadway(
  scene: SceneData,
  pts: Vec2[],
  w: number,
  toGeo: ToGeo,
  sampleZ: SampleZ,
  site: Site,
): void {
  const { halfX, halfY } = site;
  const m = w / 2;
  const z = (x: number, y: number): number => {
    const [lo, la] = toGeo(x, y);
    return sampleZ(la, lo) + LAYER_DZ.road;
  };
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
      if (face.length < 3) continue;
      scene.roads.push(face.map((p): Vec3 => [p[0], p[1], z(p[0], p[1])]));
    }
  }
}
