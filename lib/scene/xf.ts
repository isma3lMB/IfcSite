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

/** off-white = tagged height, a cooler grey = estimated, blue = drawn here. Read
 *  straight off the height source.
 *
 *  These are base colours, not screen colours. The hemisphere fill in
 *  lib/viewer/Viewer lands an up-facing surface at ~1.11 and a wall at ~0.74, so
 *  the off-white below is lifted to a white roof (#fffcf7) over walls around
 *  #d8d5d1 — the light supplies the whole roof/wall separation, which is why
 *  `cap` and `wall` can be the same value.
 *
 *  Off-white rather than pure white because this is also what the IFC carries
 *  (see addBuilding in lib/ifc/writer): white on screen is the light's doing, and
 *  a file claiming #ffffff would be claiming something the preview never had. The
 *  estimated grey is kept cool against it — that contrast, not lightness alone,
 *  is what keeps the two legible side by side. */
export const defaultColors = (b: Building): { wall: number; cap: number } => {
  if (b.src === 'user') return { wall: 0x4aa8d8, cap: 0x86c4e0 };
  return b.src === 'fallback'
    ? { wall: 0xdfe3e5, cap: 0xdfe3e5 }
    : { wall: 0xf4f1ec, cap: 0xf4f1ec };
};
