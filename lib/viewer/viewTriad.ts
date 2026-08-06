import * as THREE from 'three';
import { AXIS } from '@/lib/viewer/originMarker';

/**
 * The orientation widget: three.js's ViewHelper, vendored and rewritten.
 *
 * What is kept from the original is the corner render pass — clear the depth
 * buffer, shrink the viewport, draw a second tiny scene, put the viewport back.
 * That part is sound and is the only reason to start from it rather than from
 * nothing.
 *
 * Everything else had to go, because the stock helper is Y-up in three places
 * at once: its snap targets are hard-coded Euler angles, its internal dummy
 * object keeps the default up of (0,1,0), and its labels are X/Y/Z. This scene
 * is Z-up and its axes have names — east, north, up — so the labels, the
 * colours and the whole snap path are ours. The camera animation is not here at
 * all: it belongs to whoever owns the camera and the orbit controls, which is
 * the Viewer.
 *
 * Interaction is split the same way. This module reports which axis the pointer
 * is over and never touches the camera, so the Viewer can apply its own
 * click-versus-orbit rules before anything moves.
 */

/** Which end of which axis. Names follow three's, not the scene's, because they
 *  are about the geometry rather than about the site. */
export type ViewAxis = 'posX' | 'negX' | 'posY' | 'negY' | 'posZ' | 'negZ';

/** Side of the square the widget draws into, in CSS pixels. */
export const TRIAD_PX = 112;

/**
 * Distance from the top of the viewport, in CSS pixels: the overlay's 12 px
 * padding, the 38 px utility chip, and the grid's 12 px gap. The widget sits
 * directly under that cluster, so it has to clear it.
 */
export const TRIAD_TOP = 62;

/**
 * How far off the pole a plan view sits, in radians.
 *
 * A camera exactly over its target has no defined orientation — lookAt falls
 * into a degenerate branch and OrbitControls' own makeSafe() nudges it anyway,
 * both of them arbitrarily. Choosing the nudge ourselves is what makes the plan
 * come out north-up rather than whichever way the last orbit left it.
 *
 * 1e-3 rad is 0.057°, invisible on screen, and three orders of magnitude above
 * the EPS that makeSafe() clamps to, so the controls leave it alone.
 */
const POLE_EPS = 1e-3;

/**
 * Where the eye goes for each axis, as a unit offset from the orbit target.
 *
 * The four elevations are exact. The two plan views are tilted a hair south,
 * which is the direction that reads correctly: walking Matrix4.lookAt with
 * up = (0,0,1) and an eye offset of (0, -e, d) gives a screen right of
 * normalize(up x _z) = (1,0,0) — east — and a screen up of _z x _x = (0,d,e) —
 * north. Tilt it the other way and the plan comes out upside down.
 */
const EYE: Record<ViewAxis, THREE.Vector3> = {
  posX: new THREE.Vector3(1, 0, 0),
  negX: new THREE.Vector3(-1, 0, 0),
  posY: new THREE.Vector3(0, 1, 0),
  negY: new THREE.Vector3(0, -1, 0),
  posZ: new THREE.Vector3(0, -Math.sin(POLE_EPS), Math.cos(POLE_EPS)),
  negZ: new THREE.Vector3(0, Math.sin(POLE_EPS), -Math.cos(POLE_EPS)),
};

/** Data is E/N/height, so the ends of the axes have compass names. Kept to two
 *  characters: the ball is ~32 px across on screen. */
const LABEL: Record<ViewAxis, string> = {
  posX: 'E',
  negX: 'W',
  posY: 'N',
  negY: 'S',
  posZ: 'UP',
  negZ: 'DN',
};

const COLOR: Record<ViewAxis, number> = {
  posX: AXIS.x,
  negX: AXIS.x,
  posY: AXIS.y,
  negY: AXIS.y,
  posZ: AXIS.z,
  negZ: AXIS.z,
};

/** The ink the rest of the chrome is drawn in; see --color-ink in globals.css.
 *  Hard-coded for the same reason SKY and AXIS are: this is a texture, not a
 *  stylesheet, and it cannot read a custom property. */
const INK = '#202020';

const ORDER: ViewAxis[] = ['posX', 'negX', 'posY', 'negY', 'posZ', 'negZ'];

/** A labelled disc on a canvas, as a sprite material. */
const ballMaterial = (axis: ViewAxis): THREE.SpriteMaterial => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  ctx.beginPath();
  ctx.arc(32, 32, 16, 0, 2 * Math.PI);
  ctx.closePath();
  ctx.fillStyle = new THREE.Color(COLOR[axis]).getStyle();
  ctx.fill();

  const text = LABEL[axis];
  // A two-letter cap at the one-letter size overflows the disc it sits in.
  ctx.font = `600 ${text.length > 1 ? 20 : 26}px ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = INK;
  ctx.fillText(text, 32, 33);

  const texture = new THREE.CanvasTexture(canvas);
  // transparent carries two things at once: the corners of the square texture
  // outside the disc, and the half-opacity the render pass fades the away-
  // facing ends to. Without it the balls are squares and the fade does nothing.
  return new THREE.SpriteMaterial({ map: texture, toneMapped: false, transparent: true });
};

export type ViewTriad = {
  /**
   * Draw into the corner of the renderer's canvas. Call after the main render:
   * this clears the depth buffer so the widget is never buried in the scene.
   */
  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera, rightInset: number): void;
  /** The axis under the pointer, or null when the event missed the widget. */
  pick(
    e: { clientX: number; clientY: number },
    dom: HTMLCanvasElement,
    rightInset: number,
  ): ViewAxis | null;
  dispose(): void;
};

export function createViewTriad(): ViewTriad {
  const root = new THREE.Object3D();

  // The arms. One geometry, shared: a bar running from the origin along +X,
  // turned onto each axis in turn.
  const armGeo = new THREE.BoxGeometry(0.8, 0.05, 0.05).translate(0.4, 0, 0);
  const armMats = [AXIS.x, AXIS.y, AXIS.z].map(
    (c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false }),
  );
  const arms = armMats.map((m) => new THREE.Mesh(armGeo, m));
  arms[1].rotation.z = Math.PI / 2;
  arms[2].rotation.y = -Math.PI / 2;
  root.add(...arms);

  const balls = ORDER.map((axis) => {
    const s = new THREE.Sprite(ballMaterial(axis));
    s.position.copy(EYE[axis]).normalize();
    // The away-facing ends read as further off, which is the only depth cue a
    // sprite has.
    if (axis === 'negX' || axis === 'negY' || axis === 'negZ') s.scale.setScalar(0.8);
    s.userData.axis = axis;
    root.add(s);
    return s;
  });

  // ±1.6 leaves room for the balls at ±1 plus their own half-width.
  const cam = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0, 4);
  cam.position.set(0, 0, 2);

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const savedViewport = new THREE.Vector4();
  const facing = new THREE.Vector3();

  /**
   * The widget's box inside the canvas, in CSS pixels.
   *
   * Returns the WebGL rectangle, whose origin is the bottom-left — the one
   * place in this file where the y axis is not the DOM's.
   */
  const box = (w: number, h: number, rightInset: number) => ({
    x: w - TRIAD_PX - rightInset,
    y: h - TRIAD_PX - TRIAD_TOP,
  });

  return {
    render(renderer, camera, rightInset) {
      const w = renderer.domElement.clientWidth;
      const h = renderer.domElement.clientHeight;
      if (w < TRIAD_PX || h < TRIAD_PX + TRIAD_TOP) return;

      // Undo the camera's rotation and the widget's axes land on the world's,
      // seen from wherever the camera is. No up-vector fixups: the same
      // quaternion carries both, whatever up happens to be.
      root.quaternion.copy(camera.quaternion).invert();
      root.updateMatrixWorld();

      // Which end of each axis is toward the viewer. +Z in camera space is the
      // direction the camera looks out from, so this is up-agnostic.
      facing.set(0, 0, 1).applyQuaternion(camera.quaternion);
      const toward = [facing.x, facing.y, facing.z];
      balls.forEach((s, i) => {
        const near = toward[i >> 1] >= 0;
        s.material.opacity = (i % 2 === 0) === near ? 1 : 0.5;
      });

      const r = box(w, h, rightInset);
      renderer.getViewport(savedViewport);
      // render() clears the whole colour buffer unless this is off — a viewport
      // narrows what is drawn, not what is cleared, which needs the scissor
      // test. Left alone, this second pass wipes the scene behind it.
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.setViewport(r.x, r.y, TRIAD_PX, TRIAD_PX);
      renderer.render(root, cam);
      renderer.setViewport(savedViewport);
      renderer.autoClear = true;
    },

    pick(e, dom, rightInset) {
      const rect = dom.getBoundingClientRect();
      const r = box(rect.width, rect.height, rightInset);
      const x = e.clientX - rect.left - r.x;
      const y = e.clientY - rect.top - TRIAD_TOP;
      if (x < 0 || y < 0 || x > TRIAD_PX || y > TRIAD_PX) return null;

      ndc.set((x / TRIAD_PX) * 2 - 1, -(y / TRIAD_PX) * 2 + 1);
      raycaster.setFromCamera(ndc, cam);
      const hit = raycaster.intersectObjects(balls, false)[0];
      return hit ? (hit.object.userData.axis as ViewAxis) : null;
    },

    dispose() {
      armGeo.dispose();
      armMats.forEach((m) => m.dispose());
      balls.forEach((s) => {
        s.material.map?.dispose();
        s.material.dispose();
      });
    },
  };
}

/** The unit offset from the orbit target that puts the camera on this axis. */
export const axisEye = (axis: ViewAxis): THREE.Vector3 => EYE[axis].clone();
