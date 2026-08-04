import { dedupe, densify, ensureCCW, ringCentre } from '@/lib/geo/rings';
import { LAYER_DZ } from '@/lib/scene/stack';
import { newXf } from '@/lib/scene/xf';
import type { HeightSource, PropBag, SampleZ, SceneData, ToGeo, Vec2 } from '@/lib/types';

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
 * One quad per centreline segment. Crude at junctions, but it needs no
 * buffer/union library. For clean joins bring in turf or polygon-clipping.
 *
 * Elevation is looked up at the four corners rather than at the centreline:
 * a carriageway is up to 13 m wide, so a quad held flat across its width cuts
 * into the hillside on any cross-slope and the road vanishes behind the ground.
 * Draping every corner banks the ribbon with the terrain — not how a road is
 * built, but at this level of detail a ribbon that never buries and never
 * floats beats a geometrically honest one that does both.
 */
export function pushRoadway(
  scene: SceneData,
  pts: Vec2[],
  w: number,
  toGeo: ToGeo,
  sampleZ: SampleZ,
): void {
  const line = densify(pts, ROAD_STEP);
  const z = (x: number, y: number): number => {
    const [lo, la] = toGeo(x, y);
    return sampleZ(la, lo) + LAYER_DZ.road;
  };
  for (let i = 0; i < line.length - 1; i++) {
    const [x1, y1] = line[i];
    const [x2, y2] = line[i + 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const L = Math.hypot(dx, dy);
    if (L < 0.5) continue;
    const nx = (-dy / L) * (w / 2);
    const ny = (dx / L) * (w / 2);
    const c0: Vec2 = [x1 + nx, y1 + ny];
    const c1: Vec2 = [x1 - nx, y1 - ny];
    const c2: Vec2 = [x2 - nx, y2 - ny];
    const c3: Vec2 = [x2 + nx, y2 + ny];
    scene.roads.push([
      [c0[0], c0[1], z(c0[0], c0[1])],
      [c1[0], c1[1], z(c1[0], c1[1])],
      [c2[0], c2[1], z(c2[0], c2[1])],
      [c3[0], c3[1], z(c3[0], c3[1])],
    ]);
  }
}
