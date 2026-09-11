import {
  RAILWAY_COLOR,
  ROAD_COLOR,
  SURFACE_COLOR,
  TERRAIN_COLOR,
  TREE_CANOPY_COLOR,
  layerOpacity,
} from '@/lib/scene/stack';
import type { LayerKey } from '@/lib/i18n/keys';
import type { LayerId, LayerXf, SceneData, Surface, Vec3, Xf } from '@/lib/types';

/* =====================================================================
   What a layer is, in one place.

   The taxonomy itself (LAYER_IDS) lives on lib/types beside the scene it
   describes; everything here is what the rest of the app needs to *do* with
   it — what it is called, whether it moves, what colour it is when nobody has
   said otherwise, and which records a recolour writes through to. The viewer,
   the IFC emitter and the model tree all read this rather than each deriving
   its own answer, which is the only thing keeping the preview and the
   deliverable saying the same thing about a layer.
   ===================================================================== */

/**
 * The tree's row labels. Dictionary keys rather than English: the viewer emits
 * these as a Selection.name and through the status line's {name} param, and
 * lib/i18n translates any param whose value is itself a key — the same trick
 * ORIGIN_NAME plays. See the rule at the head of lib/i18n/keys.
 */
export const LAYER_LABEL: Record<LayerId, LayerKey> = {
  terrain: 'layer.terrain',
  buildings: 'layer.buildings',
  roads: 'layer.roads',
  railways: 'layer.railways',
  trees: 'layer.trees',
  vegetation: 'layer.vegetation',
  hedge: 'layer.hedges',
  water: 'layer.water',
  parcel: 'layer.parcels',
};

/**
 * The linear and surface layers, which move as a whole.
 *
 * Terrain is deliberately not one of them: it is what pickGround raycasts a
 * drawn corner against, and what every other layer was draped onto by
 * conformToTerrain, so sliding it would break footprint authoring and leave the
 * entire stacking ladder describing ground that is no longer underneath it.
 *
 * Buildings and trees are not either, for the opposite reason — they are
 * individually selectable and each already carries its own Xf.pos, so a layer
 * offset would be a second, invisible transform stacked under the one the
 * element editor shows.
 */
export const MOVABLE_LAYERS: ReadonlySet<LayerId> = new Set<LayerId>([
  'roads',
  'railways',
  'vegetation',
  'hedge',
  'water',
  'parcel',
]);

export const newLayerXf = (): LayerXf => ({ color: null, opacity: null, offset: [0, 0, 0] });

export const cloneLayerXf = (l: LayerXf): LayerXf => ({
  color: l.color,
  opacity: l.opacity,
  offset: [...l.offset] as Vec3,
});

export const sameLayerXf = (a: LayerXf, b: LayerXf): boolean =>
  a.color === b.color &&
  a.opacity === b.opacity &&
  a.offset.every((v, i) => Math.abs(v - b.offset[i]) < 1e-9);

/**
 * What a layer draws as when nobody has recoloured it.
 *
 * Buildings answer with the sourced-massing wall colour rather than the blue a
 * hand-drawn one gets (see defaultColors in lib/scene/xf): the tree's swatch
 * shows one colour for the whole category, and the overwhelming majority of any
 * scene is sourced.
 */
export const defaultLayerColor = (id: LayerId): number => {
  switch (id) {
    case 'terrain':
      return TERRAIN_COLOR;
    case 'buildings':
      return 0xf4f1ec;
    case 'roads':
      return ROAD_COLOR;
    case 'railways':
      return RAILWAY_COLOR;
    case 'trees':
      return TREE_CANOPY_COLOR;
    default:
      return SURFACE_COLOR[id];
  }
};

/** The colour a layer actually draws: its override, or the palette default. */
export const layerColor = (scene: SceneData, id: LayerId): number =>
  scene.layers[id].color ?? defaultLayerColor(id);

/**
 * How solid a layer draws when nobody has changed it.
 *
 * Straight off the stack's own table, which is keyed on the same strings a
 * LayerId uses — parcels are a cadastral overlay meant to be read through and
 * come back 0.12; everything else is a real surface and comes back 1.
 */
export const defaultLayerOpacity = (id: LayerId): number => layerOpacity(id);

/** The opacity a layer actually draws at, 0..1. The viewer reads it as material
 *  opacity and the writer exports `1 - it` as transparency, so a layer that
 *  reads as a faint overlay on screen reads as one in the file too. */
export const layerAlpha = (scene: SceneData, id: LayerId): number =>
  scene.layers[id].opacity ?? defaultLayerOpacity(id);

/* ---- stamping -------------------------------------------------------
   Restyling a layer writes through to the records themselves wherever they
   have somewhere to keep the value, rather than leaving it on the layer for
   every reader to remember to fall back through. That is what makes the IFC
   export need no change for buildings, trees and surfaces: addBuilding,
   addTree and addSurface already read exactly these fields.

   What each record can hold differs, which is the whole reason Style carries
   nulls: a Building and a Tree keep both colour and opacity on their Xf, a
   Surface keeps only a colour and takes its opacity from the tier, and terrain,
   roads and railways keep neither — they are one merged element apiece, and
   both of their values stay on LayerXf for emitIFC to read.
   ------------------------------------------------------------------- */

/** A record that carries some of its own appearance. */
export type Styled = { xf: Xf } | Surface;

/** One record's appearance. A null means "this record has none of its own":
 *  colour is null on a Surface that has been reset to its layer's default,
 *  opacity is null on every Surface, which has never carried one. */
export type Style = { color: number | null; opacity: number | null };

const isXf = (r: Styled): r is { xf: Xf } => 'xf' in r;

export const readStyle = (r: Styled): Style =>
  isXf(r)
    ? { color: r.xf.color, opacity: r.xf.opacity }
    : { color: r.color ?? null, opacity: null };

/** Write back what readStyle produced, or stamp a layer's values over it. A
 *  null opacity is left alone rather than written, so stamping one onto a
 *  Surface is a no-op instead of inventing a field for it. */
export const writeStyle = (r: Styled, s: Style): void => {
  if (isXf(r)) {
    r.xf.color = s.color;
    if (s.opacity !== null) r.xf.opacity = s.opacity;
  } else r.color = s.color ?? undefined;
};

export const sameStyle = (a: Style, b: Style): boolean =>
  a.color === b.color && a.opacity === b.opacity;

/** Every record in one layer that carries part of its own appearance. Empty for
 *  the merged layers. */
export const styledOf = (scene: SceneData, id: LayerId): Styled[] => {
  if (id === 'buildings') return scene.buildings;
  if (id === 'trees') return scene.trees;
  if (id === 'terrain' || id === 'roads' || id === 'railways') return [];
  return scene.surfaces.filter((s) => s.layer === id);
};

/** How many things the tree reports under a layer. Counts the geometry that is
 *  there, so a layer that was never fetched reads as empty rather than absent. */
export const layerCount = (scene: SceneData, id: LayerId): number => {
  const surfacesIn = (l: LayerId): number =>
    scene.surfaces.reduce((n, s) => n + (s.layer === l ? 1 : 0), 0);
  switch (id) {
    // A void is listed under the ground it holes, which is where the tree shows
    // it and where deleting it puts the ground back.
    case 'terrain':
      return scene.terrain ? 1 + scene.voids.length : 0;
    case 'buildings':
      return scene.buildings.length;
    case 'trees':
      return scene.trees.length;
    // The merged ribbon counts once, and every road area drawn by hand beside
    // it counts as its own element — which is what each is in the file.
    case 'roads':
      return (scene.roads.length || scene.roadWalls.length ? 1 : 0) + surfacesIn('roads');
    case 'railways':
      return scene.railways.length || scene.railwayWalls.length ? 1 : 0;
    default:
      return surfacesIn(id);
  }
};
