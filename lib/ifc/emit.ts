import { cutTerrain } from '@/lib/geo/voids';
import { cutRings, plinthOf } from '@/lib/scene/cut';
import { ContextModel } from '@/lib/ifc/writer';
import { layerAlpha, layerColor } from '@/lib/scene/layers';
import { sourceOf } from '@/lib/sources/licence';
import type { IfcStats, SceneData, SiteMeta, Vec3 } from '@/lib/types';

/**
 * Re-runnable, so post-build edits reach the download. The original wrote its
 * counters straight into the readout spans; here they come back as data and the
 * React layer renders them.
 */
export function emitIFC(
  scene: SceneData,
  meta: SiteMeta,
): { text: string; stats: IfcStats } {
  const model = new ContextModel(meta);

  if (scene.terrain) {
    // Styled rather than left bare: an element with no IfcStyledItem is one
    // every viewer is free to colour its own way, and the ground was the only
    // one in the file without one. layerColor is what the preview draws — the
    // model tree's override if there is one, the palette default otherwise — so
    // the export cannot disagree with it. Terrain takes no offset: it is not a
    // movable layer (see MOVABLE_LAYERS in lib/scene/layers).
    //
    // Cut by the same rings the viewer's ground mesh is — drawn voids and the
    // footprints of buildings set to cut — so the holes in the file are the
    // holes on screen. With none it hands the lattice back as is.
    const ground = cutTerrain(scene.terrain, cutRings(scene));
    model.addSurface(
      ground.verts,
      ground.faces,
      `Terrain (${scene.terrainSource || 'Terrarium DEM'})`,
      'TERRAIN',
      layerColor(scene, 'terrain'),
      undefined,
      1 - layerAlpha(scene, 'terrain'),
      // No offset: terrain is not a movable layer (see MOVABLE_LAYERS).
      undefined,
      // Whose elevation this is, for the licence property set. Resolved here
      // rather than in the writer because only this call site knows which of
      // the merged surfaces it is handing over.
      sourceOf('terrain', meta.provider),
    );
  }

  // A building set to cut the ground drops its base to the lowest ground under
  // it, the same depth the preview extends it by — see plinthOf.
  for (const b of scene.buildings) model.addBuilding(b, plinthOf(b, scene.terrain));

  // scene.roads keeps the road surface's own corners, so the mesh the IFC needs
  // is reconstructible without storing it twice. Since finishRoads started
  // routing roads through conformToTerrain every face has been a triangle, so
  // the fan below is a no-op that runs once — kept because it costs nothing and
  // is correct for any convex face, which is all this has ever been handed.
  // scene.roadWalls is the skirt that closes the ribbon into a solid (see
  // skirtDepth in lib/scene/stack) — folded into the same element rather than
  // exported as its own, since on screen and in the file it reads as one road.
  let roadFaces = 0;
  if (scene.roads.length || scene.roadWalls.length) {
    const verts: Vec3[] = [];
    const faces: number[][] = [];
    for (const q of [...scene.roads, ...scene.roadWalls]) {
      const b = verts.length;
      for (const p of q) verts.push(p);
      for (let k = 2; k < q.length; k++) faces.push([b, b + k - 1, b + k]);
      roadFaces += q.length - 2;
    }
    // Coloured rather than left bare, for the same reason the buildings are (see
    // addBuilding in lib/ifc/writer): an unstyled element is one the viewer
    // colours itself, and it always picks grey.
    model.addSurface(
      verts,
      faces,
      `Roads (${scene.vectorSource || 'OSM'})`,
      'USERDEFINED',
      layerColor(scene, 'roads'),
      undefined,
      1 - layerAlpha(scene, 'roads'),
      scene.layers.roads.offset,
      sourceOf('vector', meta.provider),
    );
  }

  // Same shape as the roads block above — railways get their own merged
  // element rather than being folded into roads, so the two read separately
  // on screen and in the file.
  if (scene.railways.length || scene.railwayWalls.length) {
    const verts: Vec3[] = [];
    const faces: number[][] = [];
    for (const q of [...scene.railways, ...scene.railwayWalls]) {
      const b = verts.length;
      for (const p of q) verts.push(p);
      for (let k = 2; k < q.length; k++) faces.push([b, b + k - 1, b + k]);
    }
    model.addSurface(
      verts,
      faces,
      `Railways (${scene.vectorSource || 'OSM'})`,
      'USERDEFINED',
      layerColor(scene, 'railways'),
      undefined,
      1 - layerAlpha(scene, 'railways'),
      scene.layers.railways.offset,
      sourceOf('vector', meta.provider),
    );
  }

  // The same opacity the preview draws, inverted into IFC's transparency, so a
  // layer that reads as a faint overlay on screen reads as one in the file too.
  //
  // s.color needs no layer fallback in the ordinary case: a tree recolour is
  // stamped straight into the record (see stampLayer in lib/viewer/Viewer),
  // which is the whole reason it stamps rather than shadows. Opacity and the
  // offset do have to be looked up — a Surface has never carried an opacity of
  // its own, and the offset belongs to the layer so all of its polygons move
  // together rather than each on its own.
  for (const s of scene.surfaces) {
    const layer = s.layer ?? 'parcel';
    model.addSurface(
      s.verts,
      s.faces,
      s.name,
      s.type,
      // `?? layerColor` rather than bare s.color: resetting a layer's colour
      // clears the record, and addSurface skips the style entirely for an
      // absent one — which would leave the element unstyled, and an unstyled
      // element is one the viewer colours itself. It always picks grey.
      s.color ?? layerColor(scene, layer),
      s.props,
      1 - layerAlpha(scene, layer),
      scene.layers[layer].offset,
      // The theme layers only exist on the IGN path, so the tier alone settles
      // it: parcels are the cadastre, the rest are BD TOPO. A surface drawn by
      // hand came out of no dataset and is credited to none — the rule a drawn
      // tree already follows in addTree.
      s.src === 'user' ? undefined : sourceOf(layer, meta.provider),
    );
  }

  // One element per tree, same as buildings — see addTree in lib/ifc/writer
  // for why this stopped being a single merged faceset.
  for (const t of scene.trees) model.addTree(t);

  const text = model.build();
  return {
    text,
    stats: {
      roadFaces,
      trees: scene.trees.length,
      layers: scene.surfaces.length,
      entities: model.f.count,
      bytes: new Blob([text]).size,
    },
  };
}
