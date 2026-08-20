import * as THREE from 'three';

/**
 * Set one material's translucency from an opacity in 0..1.
 *
 * The needsUpdate is not defensive — it is the whole point. three bakes
 * `transparent` into the shader program's cache key as `#define OPAQUE`, which
 * forces `diffuseColor.a = 1.0` in the fragment shader, and assigning the flag
 * does not bump material.version. So a material that was compiled while opaque
 * keeps reaching the screen solid no matter what opacity says afterwards, which
 * is exactly what an element created at 1 and then dragged down the slider
 * does. Flipping the flag has to invalidate the program or nothing happens.
 *
 * Gated on a real crossing so a drag inside the translucent range never
 * recompiles; each variant is cached after its first compile anyway, so the
 * cost is one shader link the first time an element is ghosted.
 *
 * A solid drawn below 1 must not write depth, or it hides what it is meant to
 * be seen through — including its own far side.
 */
export function setTranslucency(mat: THREE.Material, a: number): void {
  const t = a < 1;
  if (mat.transparent !== t) mat.needsUpdate = true;
  mat.transparent = t;
  mat.opacity = a;
  mat.depthWrite = !t;
}
