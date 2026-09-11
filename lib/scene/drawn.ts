import { DEFAULT_TUNABLES } from '@/lib/build/tunables';
import { conformToTerrain } from '@/lib/geo/conform';
import { skirtInto } from '@/lib/geo/mesh';
import { ringCentre } from '@/lib/geo/rings';
import { DRAWN_TIER, LAYER_DZ, skirtDepth } from '@/lib/scene/stack';
import type {
  DrawnSpec,
  Grid,
  PropBag,
  SampleZ,
  Surface,
  ToGeo,
  Vec2,
  Vec3,
  Xf,
} from '@/lib/types';

/* =====================================================================
   A context surface drawn by hand in the 3D view.

   It goes down exactly the road a fetched one does — conformed onto the
   terrain's own triangles, lifted to its rung on the LAYER_DZ ladder, closed
   into a grounded slab by skirtInto — so a pond drawn here and a lake out of
   BD TOPO stack, render and export by the same rules. See fetchThemeLayer in
   lib/sources/ign, which this mirrors.
   ===================================================================== */

/** The draw layers that become a Surface. Building and void are the two that
 *  do not: one is a Building, the other a hole in the ground. */
export type DrawnSurfaceLayer = keyof typeof DRAWN_TIER;

/** The IFC PredefinedType each lands as — the same ones the IGN layers use, so
 *  a drawn and a fetched element of one layer are the same kind of thing in the
 *  file. Roads have no IfcGeographicElement type of their own, hence the merged
 *  ribbon's USERDEFINED. */
const IFC_TYPE: Record<DrawnSurfaceLayer, string> = {
  vegetation: 'VEGETATION',
  water: 'WATER',
  roads: 'USERDEFINED',
};

export type DrawnSurfaceOpts = {
  /** Follow the ground rather than sit level. */
  drape: boolean;
  /**
   * The roof the gesture was opened on, or null for the ground. A shape begun
   * on a roof is drawn on that roof's plane and stays there: draping it would
   * send it down through the building onto the terrain beneath.
   */
  roofZ: number | null;
  terrain: Grid | null;
  /** Local metres to lon/lat, for the drape's elevation lookups. Null when the
   *  scene has no projection to hand, which only ever holds the shape level. */
  toGeo: ToGeo | null;
  sampleZ: SampleZ;
};

/**
 * The corners of a drawn ring as a finished surface: skin, skirt and floor,
 * with the layer, type and properties a fetched one of its layer carries.
 *
 * Draped, every vertex sits its rung above the ground under it. Held level —
 * drape off, a roof, or no projection — the whole skin sits its rung above the
 * lowest corner, the rule a drawn building's base follows too: nothing floats
 * over the downhill side, and water, which is level, comes out right.
 *
 * Null when the ring encloses nothing a triangulator can fill.
 */
export function drawnSurface(
  pts: Vec3[],
  layer: DrawnSurfaceLayer,
  opts: DrawnSurfaceOpts,
): Pick<Surface, 'verts' | 'faces' | 'layer' | 'type' | 'props'> | null {
  if (pts.length < 3) return null;
  const ring = pts.map((p): Vec2 => [p[0], p[1]]);
  const tier = DRAWN_TIER[layer];
  const draped = opts.drape && opts.roofZ === null && opts.toGeo !== null;
  const level = opts.roofZ ?? Math.min(...pts.map((p) => p[2]));

  const { verts, faces } = conformToTerrain(
    ring,
    opts.terrain,
    opts.toGeo ?? ((x, y) => [x, y]),
    opts.sampleZ,
    LAYER_DZ[tier],
    [],
    DEFAULT_TUNABLES.conformStep,
    // A zAt takes conform's flat path, which is what holding a shape level is:
    // no lattice cut, every corner at one height.
    draped ? undefined : () => level,
  );
  if (!faces.length) return null;
  skirtInto(verts, faces, skirtDepth(tier));

  // Which way the elevation came out, as the IGN layers record it for a drape
  // turned off — otherwise a level shape on a slope reads as a broken drape.
  const props: PropBag = { Source: 'drawn' };
  if (!draped) props.z_source = 'level';
  return { verts, faces, layer, type: IFC_TYPE[layer], props };
}

/**
 * Where a drawn ring stands now: turned about its own centre by `xf.rot[2]`,
 * then offset by `xf.pos[0..1]`.
 *
 * About the ring's centre rather than the site origin for the reason a
 * building's ring is kept relative to its own: a turn is meant to spin the
 * shape in place, not swing it round a point hundreds of metres away. The
 * viewer puts the gizmo on exactly that centre, so the two agree.
 */
export function placeRing(ring: Vec2[], xf: Xf): Vec2[] {
  const [cx, cy] = ringCentre(ring);
  const c = Math.cos(xf.rot[2]);
  const s = Math.sin(xf.rot[2]);
  return ring.map(([x, y]): Vec2 => {
    const u = x - cx;
    const v = y - cy;
    return [cx + xf.pos[0] + u * c - v * s, cy + xf.pos[1] + u * s + v * c];
  });
}

/**
 * A drawn surface built wherever its recipe now puts it — the whole of what
 * drawing one and moving one both come to.
 *
 * The corners take their heights from `groundZ` at the place they have been
 * moved to, not from where they were first clicked, so "level at the lowest
 * corner" stays true after a move across a slope. On a roof the roof's plane
 * is the answer wherever it goes.
 */
export function buildDrawn(
  spec: DrawnSpec,
  layer: DrawnSurfaceLayer,
  ctx: Omit<DrawnSurfaceOpts, 'drape' | 'roofZ'> & { groundZ: (x: number, y: number) => number },
): Pick<Surface, 'verts' | 'faces' | 'layer' | 'type' | 'props'> | null {
  const pts = placeRing(spec.ring, spec.xf).map(
    ([x, y]): Vec3 => [x, y, spec.roofZ ?? ctx.groundZ(x, y)],
  );
  return drawnSurface(pts, layer, { ...ctx, drape: spec.drape, roofZ: spec.roofZ });
}
