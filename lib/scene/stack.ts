/**
 * Drape clearance above the terrain, in metres. Everything here rides on the
 * same sampled ground, so these numbers are the whole stacking order — keep them
 * in one place or the layers silently trade ranks.
 *
 * Bottom to top: terrain (0) - parcels - vegetation - water - roads - trees -
 * hedges. The viewer and the exported IFC both read the z these produce
 * rather than re-deriving one, so the order is identical in the preview and
 * in the deliverable.
 *
 * Small numbers are enough for the geometry: the sampler agrees with the
 * rendered ground (see lib/geo/grid.ts) and the flat layers are cut onto the
 * terrain's own triangles (see lib/geo/conform.ts), so a layer only has to
 * clear the one below it, not the error between two different readings of the
 * same hillside. Trees and hedges keep the widest gap not because they need it
 * for the sampler's sake but because they're the top of the stack by
 * definition — everything else drapes flat, these two rise from their base
 * with their own real height.
 *
 * What the geometry does not decide is depth-buffer precision. Zoomed out, an
 * IFC viewer pushes its far plane out and a couple of centimetres stops
 * surviving the round trip, so the whole ladder carries 5 cm of clearance over
 * the ground it would not otherwise need. It costs nothing at any viewing angle
 * a site model is read at, and it is the one number to raise if a viewer still
 * flickers.
 */
export const LAYER_DZ = {
  parcel: 0.07,
  vegetation: 0.1,
  water: 0.15,
  road: 0.25,
  tree: 0.33,
  hedge: 0.37,
} as const;

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
 *  the opacities: one value, read by both, so they cannot drift. */
export const TERRAIN_COLOR = 0x3a3e36;
