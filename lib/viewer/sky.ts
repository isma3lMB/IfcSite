import * as THREE from 'three';

/**
 * The sky palette. Below the horizon the dome brightens to white rather than
 * darkening, so looking straight down reads as a clean backdrop behind the
 * site instead of a black void.
 */
export const SKY = {
  zenith: 0x4a7fb5,
  mid: 0x7fa8cf,
  horizon: 0xcfd9e0,
  ground: 0xe8ecef,
  nadir: 0xffffff,
} as const;

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
