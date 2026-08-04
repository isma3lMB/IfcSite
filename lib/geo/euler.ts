import type { Vec3 } from '@/lib/types';

/**
 * An XYZ Euler (radians) as the local Z and X unit vectors IfcAxis2Placement3D
 * wants — the 3rd and 1st columns of the rotation matrix. Null when unrotated.
 *
 * The original called through THREE.Euler + Matrix4.makeRotationFromEuler. That
 * is expanded here so the IFC serialiser stays free of a renderer dependency;
 * the terms below are transcribed from three's own 'XYZ' branch, which matters
 * because the preview mesh is posed with `mesh.rotation.set(x, y, z, 'XYZ')`
 * and the written file must agree with what the user was shown.
 */
export function xfAxes(rot: Vec3): { axis: Vec3; refDir: Vec3 } | null {
  if (!rot || (!rot[0] && !rot[1] && !rot[2])) return null;

  const a = Math.cos(rot[0]);
  const b = Math.sin(rot[0]);
  const c = Math.cos(rot[1]);
  const d = Math.sin(rot[1]);
  const e = Math.cos(rot[2]);
  const f = Math.sin(rot[2]);

  const ae = a * e;
  const af = a * f;
  const be = b * e;
  const bf = b * f;

  // Column-major: first column is local X, third is local Z.
  return {
    refDir: [c * e, af + be * d, bf - ae * d],
    axis: [d, -b * c, a * c],
  };
}
