import * as THREE from 'three';

/** The site-boundary yellow, reused so an in-progress footprint reads as part of
 *  the same authoring vocabulary as the drawn site rectangle. */
const LINE = 0xf0fb29;
/** The first corner, highlighted: clicking it again is what closes a polygon. */
const FIRST = 0xffffff;

/** Corner marker radius, in metres. Small enough not to hide the ground under
 *  it at the scales a footprint is drawn at, big enough to aim for. */
const DOT_R = 0.45;

export type FootprintDraft = {
  group: THREE.Group;
  /**
   * Redraw from the corners placed so far. `closed` joins the last point back
   * to the first — true for a rectangle, which is complete the whole time it is
   * being dragged, and for the rubber-band leg of a polygon once it has three.
   */
  setPoints: (pts: THREE.Vector3[], closed: boolean) => void;
  clear: () => void;
  dispose: () => void;
};

/**
 * The in-progress footprint: a polyline through the corners placed so far, plus
 * a dot on each.
 *
 * Everything draws with depthTest off and a high renderOrder, for the same
 * reason the origin marker does — a draft you cannot see behind the building
 * you are drawing beside is no help. It is rebuilt on every pointermove, so the
 * geometry is reallocated rather than resized: at the handful of corners a
 * footprint has, that is cheaper than maintaining a growable buffer, and it
 * keeps `setPoints` a pure function of the point list.
 */
export function createFootprintDraft(): FootprintDraft {
  const group = new THREE.Group();
  group.renderOrder = 8;

  const lineMat = new THREE.LineBasicMaterial({
    color: LINE,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });
  const dotGeo = new THREE.SphereGeometry(DOT_R, 10, 8);
  const dotMat = new THREE.MeshBasicMaterial({ color: LINE, depthTest: false });
  const firstMat = new THREE.MeshBasicMaterial({ color: FIRST, depthTest: false });

  let line: THREE.Line | null = null;
  const dots: THREE.Mesh[] = [];

  const dropLine = (): void => {
    if (!line) return;
    group.remove(line);
    line.geometry.dispose();
    line = null;
  };

  const setPoints = (pts: THREE.Vector3[], closed: boolean): void => {
    dropLine();

    if (pts.length >= 2) {
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      line = closed ? new THREE.LineLoop(geo, lineMat) : new THREE.Line(geo, lineMat);
      line.renderOrder = 8;
      group.add(line);
    }

    // Grow the dot pool to match, then hide the tail rather than freeing it —
    // a gesture only ever adds corners, so the pool settles after a few moves.
    while (dots.length < pts.length) {
      const d = new THREE.Mesh(dotGeo, dotMat);
      d.renderOrder = 9;
      dots.push(d);
      group.add(d);
    }
    dots.forEach((d, i) => {
      d.visible = i < pts.length;
      if (d.visible) {
        d.position.copy(pts[i]);
        // The first corner is the polygon's close target, so it is the one that
        // has to be distinguishable from the corner the cursor is dragging.
        d.material = i === 0 && pts.length > 2 ? firstMat : dotMat;
      }
    });
  };

  return {
    group,
    setPoints,
    clear: () => setPoints([], false),
    dispose: () => {
      dropLine();
      for (const d of dots) group.remove(d);
      dots.length = 0;
      dotGeo.dispose();
      dotMat.dispose();
      firstMat.dispose();
      lineMat.dispose();
    },
  };
}
