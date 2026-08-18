import * as THREE from 'three';
import type { Building, Xf } from '@/lib/types';

/** No mirroring: a negative scale would flip ring winding. */
export const MIN_SCALE = 0.05;

export const rnd = (v: number, d: number): number => (Math.abs(v) < 1e-9 ? 0 : +v.toFixed(d));

export const newXf = (): Xf => ({
  pos: [0, 0, 0],
  rot: [0, 0, 0],
  scale: [1, 1, 1],
  color: null,
  opacity: 1,
});

export const cloneXf = (x: Xf): Xf => ({
  pos: [...x.pos],
  rot: [...x.rot],
  scale: [...x.scale],
  color: x.color,
  opacity: x.opacity,
});

export function sameXf(a: Xf, b: Xf): boolean {
  return (
    a.color === b.color &&
    Math.abs(a.opacity - b.opacity) < 1e-9 &&
    (['pos', 'rot', 'scale'] as const).every((k) =>
      a[k].every((v, i) => Math.abs(v - b[k][i]) < 1e-9),
    )
  );
}

/** Absolute model z of a building's roof — the top of the prism applyXf and
 *  buildingGeometry produce together, transform included.
 *
 *  `baseZ || 0` rather than `baseZ` to match applyXf, readMeshInto and the IFC
 *  writer: they all collapse a null-ish base to the datum, and a roof computed
 *  on different terms than the mesh it describes would sit off it.
 *
 *  Exact under the Z-rotations the gizmo makes, which keep the cap horizontal.
 *  A building tipped about X or Y has no single roof elevation to give. */
export const roofZ = (b: Building): number =>
  (b.baseZ || 0) + b.xf.pos[2] + b.h * b.xf.scale[2];

/** off-white = sourced massing, blue = drawn here. Height source no longer tints
 *  the massing: tagged and estimated buildings read as one material, and the
 *  estimated count stays legible in the status line instead.
 *
 *  These are base colours, not screen colours. The hemisphere fill in
 *  lib/viewer/Viewer lands an up-facing surface at ~1.11 and a wall at ~0.74, so
 *  the off-white below is lifted to a white roof (#fffcf7) over walls around
 *  #d8d5d1 — the light supplies the whole roof/wall separation, which is why
 *  `cap` and `wall` can be the same value.
 *
 *  Off-white rather than pure white because this is also what the IFC carries
 *  (see addBuilding in lib/ifc/writer): white on screen is the light's doing, and
 *  a file claiming #ffffff would be claiming something the preview never had. */
export const defaultColors = (b: Building): { wall: number; cap: number } =>
  b.src === 'user'
    ? { wall: 0x4aa8d8, cap: 0x86c4e0 }
    : { wall: 0xf4f1ec, cap: 0xf4f1ec };

/** A colour lerped toward white by `t`. THREE.Color rather than a byte lerp on
 *  purpose: it interpolates in the renderer's working (linear) colour space, so
 *  this is the number the preview actually draws — and the IFC writer needs the
 *  same one, not one that merely rounds to it. */
export const lighten = (hex: number, t: number): number =>
  new THREE.Color(hex).lerp(new THREE.Color(0xffffff), t).getHex();

/**
 * A building's two colours: the sides, and the roof/floor caps.
 *
 * Read by the preview (paintMesh in lib/viewer/Viewer, which puts them on the
 * two ExtrudeGeometry material groups) and by the export (addBuilding in
 * lib/ifc/writer, which stacks two solids when they differ) — one expression, so
 * the file and the screen cannot disagree about which face is which colour.
 *
 * A user-picked colour is the wall, and the cap is derived from it, because that
 * is the direction the light works in: the preview lifts an up-facing surface
 * anyway, so a lightened roof reads as the same material catching more sky
 * rather than as a second colour choice the user did not make.
 */
export const buildingColors = (b: Building): { wall: number; cap: number } =>
  b.xf.color === null
    ? defaultColors(b)
    : { wall: b.xf.color, cap: lighten(b.xf.color, 0.35) };
