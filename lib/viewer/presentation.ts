import * as THREE from 'three';

/**
 * The camera path presentation mode flies.
 *
 * Pure geometry, in the same spirit as snap.ts: no state, nothing to construct
 * and nothing to dispose. The Viewer owns the clock and the handshake with
 * OrbitControls; everything here answers one question — where is the eye at
 * phase p of the loop — so the path can be reasoned about without a scene.
 *
 * The orbit is deliberately not a turntable. A constant ring reads as a
 * screensaver after half a revolution, and it shows the model from exactly one
 * height forever. Elevation and distance therefore breathe once per revolution:
 * the loop opens high and wide, sinks and closes in on the far side, and comes
 * back out. The wide end of that breath is pinned to the distance the viewer
 * frames the whole site from, which is what makes "the whole site is in frame"
 * a guarantee rather than a hope.
 */

/**
 * Where the eye is, in the spherical frame the scene actually uses.
 *
 * Z-up (see the note on camera.up in Viewer): azimuth turns in the ground
 * plane from grid east, elevation lifts out of it. Deliberately not
 * THREE.Spherical, whose phi is measured from +Y — converting into and out of
 * that on every frame would be three sign errors waiting to happen.
 */
export type OrbitPose = { az: number; el: number; dist: number };

/** One full revolution. Slow enough to read as a camera move rather than a
 *  spin — a room has to be able to follow it while someone talks over it. */
export const CYCLE_MS = 36000;

/** How long the entry blend takes. Longer than an axis snap's 380 ms because it
 *  is travelling further: elevation, distance and the pivot all move, where a
 *  snap only turns. */
export const ENTRY_MS = 1200;

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** Elevation, as a midpoint and a swing about it. The floor is what keeps the
 *  eye off the ground: at 15° the camera still looks down on the site, and a
 *  lower pass would put terrain between it and the model. */
const EL_MID = 35 * DEG;
const EL_AMP = 20 * DEG;

/** Distance, as a fraction of the site's framing distance. The peak is exactly
 *  1, so the top of every cycle is the shot frameCamera would compose. */
const D_MID = 0.8;
const D_AMP = 0.2;

/**
 * Cubic in-out — the same curve the axis snap eases on.
 *
 * The ends matter more than the middle: a blend that starts abruptly reads as a
 * cut however long it then takes to finish.
 */
export function easeInOut(k: number): number {
  return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
}

/**
 * The scripted pose at phase p of the loop, where p runs 0..1 over one cycle.
 *
 * Elevation and distance share one cosine rather than having a phase of their
 * own, so they peak together: high and far at p = 0, low and near at p = 0.5.
 * Pairing them is what makes the loop read as an establishing shot followed by
 * a detail pass, instead of two unrelated wobbles.
 *
 * az0 is the azimuth the mode was entered at. Folding it in here rather than
 * rotating the result afterwards is what lets the sweep pick up from wherever
 * the user was looking with no turn of its own.
 */
export function orbitPose(phase: number, az0: number, fitDist: number): OrbitPose {
  const swing = Math.cos(phase * TAU);
  return {
    az: az0 + phase * TAU,
    el: EL_MID + EL_AMP * swing,
    dist: fitDist * (D_MID + D_AMP * swing),
  };
}

/** The pose an eye offset already describes — how the mode reads the camera it
 *  is handed. `off` is the eye minus the orbit target. */
export function poseOf(off: THREE.Vector3): OrbitPose {
  const dist = off.length();
  return {
    az: Math.atan2(off.y, off.x),
    // Guard the degenerate offset rather than let asin see NaN: a zero-length
    // offset means the eye is sitting on its own pivot, which nothing upstream
    // promises cannot happen.
    el: dist < 1e-6 ? EL_MID : Math.asin(THREE.MathUtils.clamp(off.z / dist, -1, 1)),
    dist,
  };
}

/** The eye that pose puts round that target. */
export function eyeOf(p: OrbitPose, target: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const c = Math.cos(p.el) * p.dist;
  return out.set(target.x + c * Math.cos(p.az), target.y + c * Math.sin(p.az), target.z + Math.sin(p.el) * p.dist);
}

/**
 * Blend two poses.
 *
 * Interpolating the spherical coordinates rather than the two eye positions is
 * the same choice stepSnap makes, and for the same reason: lerping positions
 * cuts the corner, swinging the camera in through the site and back out. Here
 * it would also collapse the distance to something shorter than either end.
 *
 * Azimuth is not wrapped, because the caller has already made the two agree —
 * the scripted azimuth is built from the entry azimuth, so at k = 0 they are
 * the same number and there is no long way round to take.
 */
export function lerpPose(a: OrbitPose, b: OrbitPose, k: number): OrbitPose {
  return {
    az: a.az + (b.az - a.az) * k,
    el: a.el + (b.el - a.el) * k,
    dist: a.dist + (b.dist - a.dist) * k,
  };
}
