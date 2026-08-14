import * as THREE from 'three';

export type SkyPalette = {
  zenith: number;
  mid: number;
  horizon: number;
  ground: number;
  nadir: number;
};

/**
 * The sky palette — a near-white backdrop with only a faint cool cast at the
 * zenith, so the massing reads as a model on paper rather than as a scene under
 * a sky. Below the horizon it brightens to white rather than darkening, so
 * looking straight down stays a clean backdrop instead of a black void.
 *
 * The gradient is deliberately shallow. It is here to keep the dome from being
 * a flat fill, not to be noticed.
 *
 * The dark palette is the same idea with the values turned over: the backdrop
 * darkens toward the zenith and toward the nadir, and the horizon stays the
 * lightest band so it still reads as a horizon. It is deliberately not black —
 * a pure black dome would make the near-white terrain glare, and the shallow
 * gradient is what tells you the camera is tilting.
 */
export const SKY_THEMES: Record<'light' | 'dark', SkyPalette> = {
  light: {
    zenith: 0xe6ebf0,
    mid: 0xf1f4f6,
    horizon: 0xf8f9fa,
    ground: 0xfcfcfb,
    nadir: 0xffffff,
  },
  dark: {
    zenith: 0x0d1013,
    mid: 0x14181c,
    horizon: 0x1d2328,
    ground: 0x15191d,
    nadir: 0x0b0e10,
  },
};

/** The light palette, kept under its old name for the modules that import it. */
export const SKY = SKY_THEMES.light;

const VERT = /* glsl */ `
  varying vec3 vWorldPosition;
  void main() {
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The gradient is keyed on the world-space Z of the view ray, never on the
// mesh's own axes — that is what lets the dome ride along as a child of the
// camera without the horizon tilting when the camera does.
const FRAG = /* glsl */ `
  uniform vec3 zenith;
  uniform vec3 mid;
  uniform vec3 horizon;
  uniform vec3 ground;
  uniform vec3 nadir;
  varying vec3 vWorldPosition;

  void main() {
    float t = normalize(vWorldPosition - cameraPosition).z;
    vec3 c;
    if (t > 0.0) {
      // pow keeps the haze tight to the horizon instead of washing the whole dome
      c = mix(horizon, mid, pow(t, 0.45));
      c = mix(c, zenith, smoothstep(0.25, 1.0, t));
    } else {
      c = mix(horizon, ground, pow(-t, 0.35));
      c = mix(c, nadir, smoothstep(0.3, 1.0, -t));
    }
    gl_FragColor = vec4(c, 1.0);
  }
`;

/**
 * A unit sky dome. The caller scales it to sit inside the camera frustum and
 * parents it to the camera, so orbit distance and the far plane never clip it.
 */
export function createSkyDome(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      zenith: { value: new THREE.Color(SKY.zenith) },
      mid: { value: new THREE.Color(SKY.mid) },
      horizon: { value: new THREE.Color(SKY.horizon) },
      ground: { value: new THREE.Color(SKY.ground) },
      nadir: { value: new THREE.Color(SKY.nadir) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
  });

  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  dome.frustumCulled = false;
  dome.renderOrder = -1;
  return dome;
}

/**
 * Re-tint an existing dome in place.
 *
 * The uniforms are written rather than the material rebuilt: the dome is created
 * once and parented to the camera, which is also what scales it into the
 * frustum. Replacing it would mean redoing that, and a new ShaderMaterial would
 * recompile the program for a colour change.
 */
export function applySky(dome: THREE.Mesh, palette: SkyPalette): void {
  const mat = dome.material as THREE.ShaderMaterial;
  const u = mat.uniforms;
  (u.zenith.value as THREE.Color).setHex(palette.zenith);
  (u.mid.value as THREE.Color).setHex(palette.mid);
  (u.horizon.value as THREE.Color).setHex(palette.horizon);
  (u.ground.value as THREE.Color).setHex(palette.ground);
  (u.nadir.value as THREE.Color).setHex(palette.nadir);
}
