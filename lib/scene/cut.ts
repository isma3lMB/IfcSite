import { minGroundUnder } from '@/lib/geo/voids';
import { placeRing } from '@/lib/scene/drawn';
import { footprintOf } from '@/lib/scene/xf';
import type { Building, Grid, SceneData, Vec2 } from '@/lib/types';

/* =====================================================================
   What holes the terrain, in one place.

   Two things do: a void drawn in the 3D view, and a building set to cut the
   ground under it. Both are read here and nowhere else, by the viewer's
   ground mesh and by the IFC emitter, so the hole on screen and the hole in
   the file are the same hole.
   ===================================================================== */

/** The rings the terrain is cut by: every void where it has been moved to, and
 *  the footprint of every building set to cut. */
export function cutRings(scene: SceneData): Vec2[][] {
  if (!scene.terrain) return [];
  return [
    ...scene.voids.map((v) => placeRing(v.ring, v.xf)),
    ...scene.buildings.filter((b) => b.xf.cut).map(footprintOf),
  ];
}

/**
 * How far a cutting building's base has to drop, in metres, to reach the
 * lowest ground under its footprint. Zero for a building that does not cut,
 * for a flat scene, and for one whose base is already at or below that ground.
 *
 * The roof stays put; the building gains the depth at the bottom. Without it,
 * a building on a slope whose base sits above the ground on the downhill side
 * would hang over the hole it has just made.
 *
 * Derived, never stored: it depends on where the building stands and on the
 * ground there, and a moved building has to answer again. The viewer and the
 * writer both compute it from this one call.
 */
export function plinthOf(b: Building, terrain: Grid | null): number {
  if (!b.xf.cut || !terrain) return 0;
  const ground = minGroundUnder(terrain, footprintOf(b));
  if (ground === null) return 0;
  const base = (b.baseZ || 0) + b.xf.pos[2];
  return base > ground ? base - ground : 0;
}
