import { ContextModel } from '@/lib/ifc/writer';
import { ROAD_COLOR, TERRAIN_COLOR, layerOpacity } from '@/lib/scene/stack';
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
    // one in the file without one. TERRAIN_COLOR is what the preview draws, so
    // the export cannot disagree with it.
    model.addSurface(
      scene.terrain.verts,
      scene.terrain.faces,
      `Terrain (${scene.terrainSource || 'Terrarium DEM'})`,
      'TERRAIN',
      TERRAIN_COLOR,
    );
  }

  for (const b of scene.buildings) model.addBuilding(b);

  // scene.roads keeps each segment's corners, so the surface mesh the IFC needs
  // is reconstructible without storing it twice. A face is a buffered quad after
  // the site clip has cut it, so three to five corners — but always convex, and
  // a fan off the first vertex triangulates a convex polygon exactly.
  let roadFaces = 0;
  if (scene.roads.length) {
    const verts: Vec3[] = [];
    const faces: number[][] = [];
    for (const q of scene.roads) {
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
      ROAD_COLOR,
    );
  }

  // The same opacity the preview draws, inverted into IFC's transparency, so a
  // layer that reads as a faint overlay on screen reads as one in the file too.
  for (const s of scene.surfaces)
    model.addSurface(
      s.verts,
      s.faces,
      s.name,
      s.type,
      s.color,
      s.props,
      1 - layerOpacity(s.layer),
    );

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
