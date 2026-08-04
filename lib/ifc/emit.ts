import { treeProxy } from '@/lib/geo/mesh';
import { ContextModel } from '@/lib/ifc/writer';
import { TERRAIN_COLOR, layerOpacity } from '@/lib/scene/stack';
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

  // scene.roads keeps each segment's four corners, so the surface mesh the IFC
  // needs is reconstructible without storing it twice.
  let roadFaces = 0;
  if (scene.roads.length) {
    const verts: Vec3[] = [];
    const faces: number[][] = [];
    for (const q of scene.roads) {
      const b = verts.length;
      verts.push(q[0], q[1], q[2], q[3]);
      faces.push([b, b + 1, b + 2], [b, b + 2, b + 3]);
      roadFaces += 2;
    }
    model.addSurface(verts, faces, `Roads (${scene.vectorSource || 'OSM'})`, 'USERDEFINED');
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

  // One faceset for the lot. A dense quarter of Paris carries 1200 trees, and
  // 1200 separate elements would cost more than the buildings do.
  if (scene.trees.length) {
    const verts: Vec3[] = [];
    const faces: number[][] = [];
    for (const t of scene.trees) treeProxy(t, verts, faces);
    model.addSurface(verts, faces, 'Trees (OSM)', 'VEGETATION', 0x2e5e33);
  }

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
