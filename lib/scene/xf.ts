import type { Building, Xf } from '@/lib/types';

/** No mirroring: a negative scale would flip ring winding. */
export const MIN_SCALE = 0.05;

export const rnd = (v: number, d: number): number => (Math.abs(v) < 1e-9 ? 0 : +v.toFixed(d));

export const newXf = (): Xf => ({ pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], color: null });

export const cloneXf = (x: Xf): Xf => ({
  pos: [...x.pos],
  rot: [...x.rot],
  scale: [...x.scale],
  color: x.color,
});

export function sameXf(a: Xf, b: Xf): boolean {
  return (
    a.color === b.color &&
    (['pos', 'rot', 'scale'] as const).every((k) =>
      a[k].every((v, i) => Math.abs(v - b[k][i]) < 1e-9),
    )
  );
}

/** yellow = tagged height, grey = estimated. Read straight off the height source.
 *  `cap` is pre-lifted: roofs face the sun head-on and render at a ~1.23 Lambert
 *  factor, so these values land just under saturation. To retune, divide the
 *  colour you want on screen by 1.23. */
export const defaultColors = (b: Building): { wall: number; cap: number } =>
  b.src === 'fallback' ? { wall: 0x7a7a7a, cap: 0xa8a8a8 } : { wall: 0xf0fb29, cap: 0xccd457 };
