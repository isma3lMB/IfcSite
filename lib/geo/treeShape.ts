import * as THREE from 'three';
import type { Vec3 } from '@/lib/types';

/**
 * The one tree shape, shared by the live viewer (which builds three.js
 * meshes from it directly) and the IFC writer (which reads its vertices back
 * out via appendGeometry into its own flat buffers). Keeping both in one
 * place is what guarantees the exported tree looks like the one on screen.
 *
 * Both pieces are unit-sized, Z-up, based at the local origin — callers scale
 * and translate per tree the same way buildings scale their unit ring.
 *
 * Deliberately simple rather than an imported asset: a sculpted mesh reads
 * better on screen, but at one IfcBuildingElementProxy per tree (see addTree
 * in lib/ifc/writer) its triangle count multiplies by however many trees are
 * on site, and a few thousand trees at a few thousand triangles each is what
 * turned the export heavy. A handful of triangles a tree keeps the export
 * proportional to the tree count instead of to the tree count times a
 * model's detail level.
 */

/** Tapered trunk: base radius 1, top radius 0.6, height 1, base at z=0. */
export function treeTrunkGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.6, 1, 1, 6);
  geo.rotateX(Math.PI / 2); // three.js is Y-up, data is Z-up
  geo.translate(0, 0, 0.5);
  return geo;
}

/** Faceted canopy blob: unit icosahedron centred on the local origin — the
 *  low-poly look comes from detail level 0, left un-subdivided. */
export function treeCanopyGeometry(): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(1, 0);
}

/** Trunk rises to this fraction of total height before the canopy takes
 *  over, floored so a short sapling still shows a trunk. */
export function treeTrunkHeight(h: number): number {
  return Math.max(h * 0.35, 0.6);
}

/**
 * Append a transformed copy of a unit tree-part geometry into flat
 * verts/faces arrays, for consumers that build their own buffers (the IFC
 * writer) rather than three.js meshes (the viewer).
 */
export function appendGeometry(
  geo: THREE.BufferGeometry,
  m: THREE.Matrix4,
  verts: Vec3[],
  faces: number[][],
): void {
  const pos = geo.attributes.position;
  const base = verts.length;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m);
    verts.push([v.x, v.y, v.z]);
  }
  const index = geo.getIndex();
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      faces.push([base + index.getX(i), base + index.getX(i + 1), base + index.getX(i + 2)]);
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) faces.push([base + i, base + i + 1, base + i + 2]);
  }
}
