import { DEFAULT_TUNABLES, type Tunables } from '@/lib/build/tunables';
import { type SplitPolygon, unionPolygons, unionRings } from '@/lib/geo/boolean';
import { conformToTerrain } from '@/lib/geo/conform';
import { skirtInto } from '@/lib/geo/mesh';
import {
  clipPolyline,
  clipToBox,
  collapseNear,
  dedupe,
  ensureCCW,
  ringCentre,
} from '@/lib/geo/rings';
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

/**
 * Past this the browser, not the services, becomes the bottleneck.
 *
 * The hard ceiling, now that the panel can lower it: the build path reads
 * `tune.buildingCap` instead, and TUNE_RANGE pins that slider's maximum to this
 * number. The viewer's draw tool still reads this one directly, which is safe
 * precisely because a tunable can only ever sit at or under it.
 */
export const BUILDING_CAP = DEFAULT_TUNABLES.buildingCap;

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

/** Centreline vertices closer together than this are collapsed before anything
 *  reads a direction off them — see collapseNear in lib/geo/rings. */
const JOIN_TOL = 0.05;
/** How far a join's arc chord may fall short of the true offset arc, in metres.
 *  Fixing the tolerance rather than the step angle is what keeps a wide
 *  carriageway as smooth as a narrow one: a flat 30 deg step leaves 22 cm of
 *  scallop on a 13 m motorway and 5 cm on a 3 m alley, for the same vertex
 *  count. Solved for the angle instead, both come out at 5 cm. */
const JOIN_SAG = 0.05;
/** Joins whose mouth is narrower than this are below the millimetre weld in
 *  lib/geo/conform, so the ring would cost a boolean operand to close a seam
 *  nothing downstream can resolve. */
const JOIN_MIN = 1e-3;
/** Ceiling on arc segments per join, so a pathological half-width cannot turn
 *  one bend into hundreds of operands. */
const JOIN_STEPS = 16;
/** cos of the turn past which this is a way doubling back on itself rather than
 *  bending — roughly 170 deg. The two quads then lie on top of each other and
 *  the outer side is not a side, so a half-disc bulge would be invention. */
const JOIN_FLAT = -0.985;

/**
 * A centreline buffered into a carriageway: one quad per segment plus one
 * rounded wedge per bend, all cut to the site box and unioned into one clean
 * ribbon per road (or a handful, if the clip split the road into separate
 * runs), appended to the caller-owned `ribbons` collector rather than draped
 * or pushed into the scene directly.
 *
 * The wedges are the whole point. Offsetting each segment along its own normal
 * leaves consecutive quads meeting at a single centreline vertex, so the union
 * has nothing to merge on the outside of a bend and the ribbon comes back with
 * a sector of angle theta and radius m cut out of it — see `join` below for the
 * derivation and for why an arc rather than a miter. Every emitted point lies
 * within half a carriageway of a centreline vertex, so the ribbon is a subset
 * of the centreline's true buffer: it can fall short by the arc sagitta and
 * cannot bulge past the kerb.
 *
 * Unioning here, per road, keeps the batch handed to the boolean library small.
 * finishRoads below does one more union across every road's ribbon to merge
 * where distinct roads cross, but by then the input is a few dozen regions
 * instead of thousands of raw quads — cheaper, and far less likely to hit the
 * sweep line's failure modes on real-world geometry.
 *
 * Nothing here densifies. The centreline used to be split at 8 m so the drape
 * had stations, but the drape stopped happening at ring corners when roads
 * moved to conformToTerrain, which cuts the ribbon on the terrain's own lattice
 * and supplies far better stations than an arbitrary 8 m ever did. What the
 * densify still did was insert collinear midpoints, which added no outline
 * fidelity — a chord subdivided is the same chord — while doubling the operand
 * count and handing the sweep line pairs of exactly-collinear quads, which it
 * throws on.
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
 * half of its surface that is inside; only what survives is collapsed and
 * buffered. Doing it the other way round pays ~10000 proj4 inversions per long
 * way to produce a handful of quads.
 */
export function pushRoadway(
  ribbons: SplitPolygon[],
  pts: Vec2[],
  w: number,
  site: Site,
): void {
  const { halfX, halfY } = site;
  const m = w / 2;
  const quads: Vec2[][] = [];
  const box = (r: Vec2[]): void => {
    const f = clipToBox(r, -halfX, -halfY, halfX, halfY);
    if (f.length >= 3) quads.push(f);
  };

  for (const run of clipPolyline(pts, -halfX - m, -halfY - m, halfX + m, halfY + m)) {
    const line = collapseNear(run, JOIN_TOL);
    if (line.length < 2) continue;

    // Directions and normals are computed once and shared by the quad and the
    // two joins that meet on it. That is not an optimisation: it is what makes
    // a join's rim land bit-for-bit on the quad corner it continues from, so
    // the two arrive at the union as a shared vertex rather than as two points
    // a rounding error apart, which is the sweep line's least favourite input.
    const ux: number[] = [];
    const uy: number[] = [];
    const nx: number[] = [];
    const ny: number[] = [];
    const live: number[] = [];
    for (let i = 0; i < line.length - 1; i++) {
      const [x1, y1] = line[i];
      const [x2, y2] = line[i + 1];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const L = Math.hypot(dx, dy);
      // Only a segment with no direction at all is skipped. The 0.5 m floor
      // that used to stand here deleted the quad outright, and OSM puts nodes
      // that close together at junctions and around roundabouts as a matter of
      // course — every one was a full-width hole in the carriageway.
      if (L < 1e-9) continue;
      ux[i] = dx / L;
      uy[i] = dy / L;
      nx[i] = (-dy / L) * m;
      ny[i] = (dx / L) * m;
      live.push(i);
      box([
        [x1 + nx[i], y1 + ny[i]],
        [x1 - nx[i], y1 - ny[i]],
        [x2 - nx[i], y2 - ny[i]],
        [x2 + nx[i], y2 + ny[i]],
      ]);
    }
    if (!live.length) continue;

    /**
     * The wedge one bend leaves between two butt-jointed quads. Quad `i` ends
     * on the perpendicular to its own direction at P and quad `j` starts on
     * the perpendicular to its own; inside the bend they overlap and the union
     * absorbs it, but outside they meet at P alone, leaving a sector of angle
     * |theta| and radius m missing all the way down to the centreline. Even a
     * one-degree bend on a dual carriageway opens a six-metre slit that way.
     *
     * Filling it with an arc rather than a miter is what makes this safe at
     * any angle: every point emitted here is at exactly m from a centreline
     * vertex, so the result stays a subset of the centreline's true buffer and
     * can only ever fall short — by the chord sagitta, which JOIN_SAG bounds.
     * A miter has no such ceiling (m/cos(theta/2) runs away on a hairpin),
     * which is the whole reason miter limits exist.
     */
    const join = (i: number, j: number, P: Vec2): void => {
      const dot = ux[i] * ux[j] + uy[i] * uy[j];
      if (dot < JOIN_FLAT) return;
      const theta = Math.atan2(ux[i] * uy[j] - uy[i] * ux[j], dot);
      if (2 * m * Math.abs(Math.sin(theta / 2)) < JOIN_MIN) return;
      const s = theta > 0 ? -1 : 1;
      const ax = P[0] + s * nx[i];
      const ay = P[1] + s * ny[i];
      const step = JOIN_SAG >= m ? Math.PI : 2 * Math.acos(1 - JOIN_SAG / m);
      const N = Math.min(JOIN_STEPS, Math.max(1, Math.ceil(Math.abs(theta) / step)));
      const vx = ax - P[0];
      const vy = ay - P[1];
      const arc: Vec2[] = [[ax, ay]];
      for (let k = 1; k < N; k++) {
        const t = (k / N) * theta;
        const c = Math.cos(t);
        const sn = Math.sin(t);
        arc.push([P[0] + vx * c - vy * sn, P[1] + vx * sn + vy * c]);
      }
      // Taken from the neighbour rather than from the rotation that lands on
      // the same place to within an ulp — the shared vertex above is the point.
      arc.push([P[0] + s * nx[j], P[1] + s * ny[j]]);
      // One convex ring per bend, not N triangles: it survives clipToBox's
      // Sutherland-Hodgman whole, and costs the union one operand instead of N.
      // A left turn sweeps counter-clockwise already; a right turn does not.
      box(theta > 0 ? [P, ...arc] : [P, ...arc.reverse()]);
    };

    for (let k = 1; k < live.length; k++) join(live[k - 1], live[k], line[live[k]]);
    // A closed way — a roundabout, or an island — has a bend at its seam like
    // any other vertex. densify and collapseNear both leave the endpoints
    // untouched, and OSM repeats the first node verbatim as the last, so this
    // is an exact test; a way that clipPolyline cut into runs simply fails it.
    const end = line[line.length - 1];
    if (
      line.length > 3 &&
      Math.hypot(line[0][0] - end[0], line[0][1] - end[1]) <= JOIN_TOL
    )
      join(live[live.length - 1], live[0], line[0]);
  }
  ribbons.push(...unionRings(quads));
}

/**
 * The other half of what pushRoadway started. Every road's own ribbon,
 * collected across the whole build — both providers push into the same
 * array — is unioned once more here, which is what merges the overlap where
 * two distinct roads cross (the raggedness within a single road's own bends
 * was already resolved per-road, inside pushRoadway, before it got here).
 * A ribbon's holes are carried through, not dropped: a roundabout buffered by
 * half a carriageway genuinely is a donut, and the island in the middle is not
 * road. Dropping it paved the island over, which the rounded kerb this layer
 * now gets only made more conspicuous. conformToTerrain takes the holes
 * alongside the outer and cuts both, and skirtInto already walls an island's
 * rim correctly — it classifies rim loops by signed area and a hole comes back
 * wound against its outer, so it needed no change.
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
/** Shared by finishRoads and finishRailways below — both are a centreline
 *  ribbon conformed to the terrain and skirted into a solid, differing only
 *  in which LAYER_DZ/skirtDepth rung and which scene arrays they land in. */
function finishRibbons(
  scene: SceneData,
  ribbons: SplitPolygon[],
  toGeo: ToGeo,
  sampleZ: SampleZ,
  layer: 'road' | 'railway',
  top: Vec3[][],
  walls: Vec3[][],
  tune: Tunables,
): void {
  if (!ribbons.length) return;
  for (const { outer, holes } of unionPolygons(ribbons)) {
    const { verts, faces } = conformToTerrain(
      outer,
      scene.terrain,
      toGeo,
      sampleZ,
      LAYER_DZ[layer],
      holes,
      tune.conformStep,
    );
    if (!faces.length) continue;
    const skirt = skirtInto(verts, faces, skirtDepth(layer));
    const tri = (t: number[]): Vec3[] => [verts[t[0]], verts[t[1]], verts[t[2]]];
    for (let i = 0; i < skirt; i++) top.push(tri(faces[i]));
    for (let i = skirt; i < faces.length; i++) walls.push(tri(faces[i]));
  }
}

export function finishRoads(
  scene: SceneData,
  ribbons: SplitPolygon[],
  toGeo: ToGeo,
  sampleZ: SampleZ,
  tune: Tunables,
): void {
  finishRibbons(scene, ribbons, toGeo, sampleZ, 'road', scene.roads, scene.roadWalls, tune);
}

export function finishRailways(
  scene: SceneData,
  ribbons: SplitPolygon[],
  toGeo: ToGeo,
  sampleZ: SampleZ,
  tune: Tunables,
): void {
  finishRibbons(
    scene,
    ribbons,
    toGeo,
    sampleZ,
    'railway',
    scene.railways,
    scene.railwayWalls,
    tune,
  );
}
