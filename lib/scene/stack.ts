import type { SurfaceLayer } from '@/lib/types';

/**
 * Drape clearance above the terrain, in metres, for the four FLAT layers.
 * Everything here rides on the same sampled ground, so these numbers are the
 * whole stacking order — keep them in one place or the layers silently trade
 * ranks. Bottom to top: terrain (0) - parcels - vegetation - water - roads.
 * The viewer and the exported IFC both read the z these produce rather than
 * re-deriving one, so the order is identical in the preview and in the
 * deliverable.
 *
 * These used to be centimetres, and could be, because the terrain was cut out
 * from under every opaque layer: a lake had no ground beneath it to argue
 * with, so `dz` only had to order the layers against each other, and two
 * layers rarely cover the same spot. That cut is gone (see lib/geo/conform,
 * which now only drapes), so every flat layer has real terrain directly under
 * it across its whole area and this number is the only thing holding the two
 * apart.
 *
 * What actually orders the stack, though, is not this number — it is
 * CONTAINMENT. Every layer here except parcels is built as a closed opaque
 * solid spanning [terrain - bite, terrain + dz] (see skirtDepth below and
 * skirtInto in lib/geo/mesh). Where two of them overlap in plan, the lower
 * one's top skin therefore lies strictly INSIDE the higher one's solid —
 * enclosed, not "a few centimetres below and hoping the depth buffer agrees".
 * That is exact at any positive rung and it survives into a viewer that has no
 * polygon offset and no render order to lean on, which is the whole problem
 * this file exists to solve. The rungs only have to be positive and ordered.
 *
 * So these are far smaller than the depth-precision argument alone would ask
 * for, and that is deliberate: the ladder is what sets how bulky the model
 * reads at street level, and containment lets it be thin. It is also the one
 * dial — the skirt depth is derived from it below, so lowering a rung thins
 * its slab automatically and a slab can never end up floating.
 *
 * PARCELS ARE THE EXCEPTION and the reason the ladder does not go lower still.
 * A cadastral overlay is a transparent tint meant to be read against the
 * ground, so it gets no skirt, so nothing contains it: its rung is the only
 * one still doing real depth-buffer work. It keeps a wider gap over the
 * terrain than its neighbour above it needs, while staying inside vegetation's
 * solid so a real surface still covers it.
 *
 * Trees and hedges are deliberately NOT on this ladder. Their number is the
 * base of a solid with real height, not the clearance of a flat skin, so
 * nothing of theirs is ever coplanar with the ground and they need no gap at
 * all — lifting them would only leave a tree visibly hovering over its own
 * shadow. They sit a few centimetres INTO the ground instead, so a base cap
 * never hangs in the air on a slope.
 */
export const LAYER_DZ = {
  parcel: 0.05,
  vegetation: 0.1,
  water: 0.2,
  road: 0.3,
  // A rail bed sits a little proud of the road surface it may cross, so it
  // takes the next rung up — same containment logic, one step higher.
  railway: 0.32,
  tree: -0.05,
  hedge: -0.05,
} as const;

/**
 * How far each flat layer's skirt reaches BELOW the terrain, in metres.
 *
 * Only the bite lives here; the depth itself is arithmetic (see skirtDepth).
 * There used to be a second table of absolute thicknesses beside LAYER_DZ, and
 * the two silently drifted apart until every slab's bottom sat above the
 * ground it was supposed to be buried in — the layers turned back into sheets
 * of paper hovering over the terrain, with open air underneath. A number that
 * has to be kept consistent with another number by hand eventually will not
 * be, so this one cannot be: the depth is computed, and the only way to make a
 * slab thinner is to lower its rung.
 *
 * The bite does NOT have to absorb terrain relief. conformToTerrain puts the
 * top skin exactly `dz` above the drawn ground at every vertex, and the skirt
 * drops each of those vertices by a constant, so the bottom is exactly `bite`
 * below the drawn ground everywhere — at any bite at all. What it does have to
 * cover is the coarse-lattice case: past MAX_GRID_N the conform walks in
 * blocks rather than cells (CONFORM_STEP in lib/geo/conform), and a block's
 * interior approximates by the terrain's sagitta across it. A decimetre or two
 * covers that on anything short of a cliff.
 *
 * They differ per layer so that two layers overlapping in plan do not put
 * their bottom caps on the same plane — the one coplanar pair containment
 * cannot arbitrate, since neither encloses the other.
 *
 * Parcels are absent on purpose: see the exception noted above.
 */
export const LAYER_BITE = {
  vegetation: 0.05,
  water: 0.05,
  road: 0.05,
  // Deeper than road's by a millimetre-scale margin on purpose: a level
  // crossing overlaps the two in plan, and an equal bite would put both slabs'
  // bottom caps on the same plane — the coplanar pair containment cannot
  // arbitrate. One rung deeper puts the road solid strictly inside the rail
  // one, which is what the ladder above is for.
  railway: 0.06,
} as const;

/** The layers built as solids rather than as a flat skin. */
export type SkirtLayer = keyof typeof LAYER_BITE;

/** How deep a layer's skirt hangs under its own conformed top surface. Reaches
 *  past the terrain by LAYER_BITE, which is what makes the containment above
 *  hold rather than merely being intended. */
export const skirtDepth = (layer: SkirtLayer): number => LAYER_DZ[layer] + LAYER_BITE[layer];

/**
 * How solid a context layer draws, 0..1. Parcels are a cadastral overlay rather
 * than anything physically on the ground, so they stay a faint tint; everything
 * else is a real surface and draws solid.
 *
 * Kept here beside the stacking order because it belongs to the same decision:
 * the viewer reads it as material opacity and the IFC writes `1 - it` into
 * IfcSurfaceStyleRendering.Transparency, so the preview and the deliverable
 * cannot drift apart on how a layer reads.
 */
const LAYER_OPACITY: Record<string, number> = { parcel: 0.12 };

export const layerOpacity = (layer?: string): number => LAYER_OPACITY[layer ?? ''] ?? 1;

/** The ground, in the preview and in the export. Here for the same reason as
 *  the opacities: one value, read by both, so they cannot drift.
 *
 *  This exact number is what the IFC carries — the writer states the palette
 *  verbatim. On screen it is also lifted by the hemisphere fill in
 *  lib/viewer/Viewer, about ×1.11 on a flat ground, which is where the
 *  near-white the preview reads as comes from; that lift is the light's doing
 *  and stays in the viewer. */
export const TERRAIN_COLOR = 0xe8e7e4;

/** Trees, for the same reason again: the preview draws its own low-poly
 *  meshes and the export bakes the same shape per element, so the canopy
 *  colour is not written out twice by hand. */
export const TREE_TRUNK_COLOR = 0x833e2f;
export const TREE_CANOPY_COLOR = 0x51a634;

/** Roads. Unlike everything else here this one is drawn unlit in the preview
 *  (MeshBasicMaterial, so it reaches the screen as written) but will be lit by
 *  whatever an IFC viewer does, so it reads a little darker in the file than on
 *  screen. Shared anyway — one value that is slightly differently lit beats two
 *  values that can drift apart. */
export const ROAD_COLOR = 0xb0b0b0;

/** Railways, for the same reason as roads — a ballast brown-grey, distinct
 *  enough from ROAD_COLOR to read as a different feature at a glance. */
export const RAILWAY_COLOR = 0x6b5b4a;

/**
 * The four context-surface tiers, keyed by Surface['layer'].
 *
 * These sat on IGN_LAYERS[*].color until the model tree needed to name a
 * layer's default colour without pulling the whole WFS client in behind it.
 * They belong beside the opacities and the stacking order anyway: which tier a
 * surface is decides its z, its draw order, its opacity and its hue, and those
 * four numbers only stay in step while they are read from one place. lib/sources/ign
 * still owns which WFS type feeds each tier — only the palette moved.
 */
export const SURFACE_COLOR: Record<SurfaceLayer, number> = {
  vegetation: 0xc0d4b6,
  hedge: 0x93c07e,
  water: 0xa3c1d2,
  parcel: 0x6b6252,
};
