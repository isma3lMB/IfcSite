import * as THREE from 'three';
import { signedArea } from '@/lib/geo/rings';
import { type SnapKind, toScreen } from '@/lib/viewer/snap';
import type { Vec2 } from '@/lib/types';

/** A length between two points, or a region enclosed by a ring of them. */
export type MeasureKind = 'dist' | 'area';

export type Measure = { id: number; kind: MeasureKind; pts: THREE.Vector3[] };

/**
 * How a number becomes a string.
 *
 * Pushed down from React rather than built here, for the reason the i18n keys
 * file states: nothing under lib/viewer may compose user-facing text, and a
 * thousands separator is locale, not geometry.
 */
export type MeasureFormat = {
  length: (m: number) => string;
  area: (m2: number) => string;
};

export type MeasureLayer = {
  group: THREE.Group;
  /** The label container. The viewer appends it to its host and removes it on
   *  dispose — it is DOM, so it cannot live in the scene graph. */
  dom: HTMLElement;
  /** Held at a constant pixel size by the viewer, which is the only thing that
   *  knows the camera. Hidden whenever there is no live gesture. */
  snapCursor: THREE.Object3D;
  /**
   * The in-progress measurement: the points placed so far, plus the point under
   * the cursor as a provisional next one — the same convention as
   * Viewer.showDraft. An empty list clears it.
   */
  setLive: (kind: MeasureKind, pts: THREE.Vector3[], snap: SnapKind) => void;
  add: (m: Measure) => void;
  remove: (id: number) => void;
  clear: () => void;
  /** Re-anchor every label from the camera. Called once per frame. */
  sync: (camera: THREE.Camera, rect: { width: number; height: number }, fmt: MeasureFormat) => void;
  dispose: () => void;
};

/** The blue the footprint draft already uses, for the same reason: it has to
 *  survive a near-white ground and a near-white roof. */
const LIVE = 0x1f8ac0;
/** Committed measurements settle to a darker ink so the one being drawn stays
 *  the one that reads first. */
const DONE = 0x0d4f66;

/** Endpoint marker radius, in metres — the footprint draft's dot, which is
 *  sized for the same scenes. */
const DOT_R = 0.45;

/** What the snap cursor says it has caught. Kept apart from LIVE/DONE so the
 *  answer is legible without reading the number. */
const SNAP_COLOR: Record<SnapKind, number> = {
  vertex: 0xe8590c,
  midpoint: 0xd6a800,
  edge: 0x2f9e44,
  free: LIVE,
};

/**
 * The ring in the plane it best fits, as 2D coordinates.
 *
 * Newell's normal rather than a cross product of the first three points: a
 * footprint traced over a roof ridge is not exactly planar, and Newell averages
 * the whole ring instead of trusting whichever three corners came first. Null
 * when the ring is degenerate — collinear points, or fewer than three.
 */
function flatten(pts: THREE.Vector3[]): { coords: Vec2[]; normal: THREE.Vector3 } | null {
  if (pts.length < 3) return null;

  const n = new THREE.Vector3();
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  }
  if (n.lengthSq() < 1e-12) return null;
  n.normalize();

  // Any two axes in the plane will do — area and triangulation are both
  // invariant to the choice — so take the first edge as one of them.
  const u = new THREE.Vector3().subVectors(pts[1], pts[0]);
  u.addScaledVector(n, -u.dot(n));
  if (u.lengthSq() < 1e-12) return null;
  u.normalize();
  const v = new THREE.Vector3().crossVectors(n, u);

  const o = pts[0];
  const d = new THREE.Vector3();
  const coords = pts.map((p): Vec2 => {
    d.subVectors(p, o);
    return [d.dot(u), d.dot(v)];
  });
  return { coords, normal: n };
}

/** The area a ring encloses, measured in its own plane — so a ring traced over
 *  a pitched roof reports the roof, not its shadow on the ground. */
export function ringArea3(pts: THREE.Vector3[]): number {
  const flat = flatten(pts);
  return flat ? Math.abs(signedArea(flat.coords)) : 0;
}

/** Round the ring, closing leg included. */
function perimeter(pts: THREE.Vector3[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) sum += pts[i].distanceTo(pts[(i + 1) % pts.length]);
  return sum;
}

/**
 * A filled ring.
 *
 * Earcut through ShapeUtils rather than a fan from the centroid: a fan is only
 * right for a convex ring, and an L-shaped courtyard is exactly the shape
 * someone reaches for this tool to measure. The triangulation runs on the
 * flattened coordinates and indexes back into the original 3D points, so the
 * fill sits on the plane the ring was drawn on.
 */
function fillGeometry(pts: THREE.Vector3[]): THREE.BufferGeometry | null {
  const flat = flatten(pts);
  if (!flat) return null;
  const contour = flat.coords.map(([x, y]) => new THREE.Vector2(x, y));
  const faces = THREE.ShapeUtils.triangulateShape(contour, []);
  if (!faces.length) return null;

  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  geo.setIndex(faces.flat());
  geo.computeVertexNormals();
  return geo;
}

type Entry = {
  kind: MeasureKind;
  pts: THREE.Vector3[];
  obj: THREE.Group;
  el: HTMLElement;
  anchor: THREE.Vector3;
  /** The formatted text, cached: it only changes when the points or the
   *  formatter do, and rewriting it every frame would touch the DOM sixty times
   *  a second for a string that has not moved. */
  text: string;
};

/**
 * Everything a measurement puts on screen: the geometry in the scene, and the
 * readout in a DOM layer over it.
 *
 * The geometry all draws with depthTest off and a high renderOrder, for the
 * reason the footprint draft does — a dimension you cannot see through the
 * building it spans is not a dimension. Rebuilt rather than resized on every
 * change, which at the handful of points a measurement has is cheaper than
 * maintaining growable buffers.
 *
 * The labels are plain absolutely-positioned divs rather than CSS2DRenderer
 * objects: they are styled from globals.css, so they follow the theme without
 * this module knowing a colour, and repositioning a handful of them from
 * `toScreen` costs less than a second full-scene traversal per frame.
 */
export function createMeasureLayer(): MeasureLayer {
  const group = new THREE.Group();
  group.renderOrder = 8;

  const dom = document.createElement('div');
  dom.className = 'measureLayer';

  const liveMat = new THREE.LineBasicMaterial({ color: LIVE, depthTest: false, transparent: true });
  const doneMat = new THREE.LineBasicMaterial({ color: DONE, depthTest: false, transparent: true });
  const liveDot = new THREE.MeshBasicMaterial({ color: LIVE, depthTest: false });
  const doneDot = new THREE.MeshBasicMaterial({ color: DONE, depthTest: false });
  const liveFill = new THREE.MeshBasicMaterial({
    color: LIVE,
    depthTest: false,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
  });
  const doneFill = new THREE.MeshBasicMaterial({
    color: DONE,
    depthTest: false,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
  });
  const dotGeo = new THREE.SphereGeometry(DOT_R, 10, 8);

  // A ring rather than a dot, so whatever it has latched onto stays visible
  // through it. Unit-sized: the viewer rescales it to a fixed pixel size every
  // frame, the same way it does the origin marker.
  const snapCursor = new THREE.Mesh(
    new THREE.RingGeometry(0.34, 0.5, 20),
    new THREE.MeshBasicMaterial({ color: LIVE, depthTest: false, side: THREE.DoubleSide }),
  );
  snapCursor.renderOrder = 11;
  snapCursor.visible = false;
  group.add(snapCursor);

  const entries = new Map<number, Entry>();
  /** The gesture in progress, held under a reserved id so it shares every code
   *  path with a committed one and can never be left behind by `clear`. */
  const LIVE_ID = -1;
  let lastFmt: MeasureFormat | null = null;

  const buildGeometry = (kind: MeasureKind, pts: THREE.Vector3[], live: boolean): THREE.Group => {
    const g = new THREE.Group();
    g.renderOrder = 8;
    const lineMat = live ? liveMat : doneMat;
    const dotMat = live ? liveDot : doneDot;

    if (pts.length >= 2) {
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      // A distance is one segment; a ring closes. While an area is still short
      // of three corners it is a polyline, so the leg being aimed reads as a
      // leg rather than as a sliver.
      const line =
        kind === 'area' && pts.length >= 3
          ? new THREE.LineLoop(geo, lineMat)
          : new THREE.Line(geo, lineMat);
      line.renderOrder = 9;
      g.add(line);
    }

    if (kind === 'area' && pts.length >= 3) {
      const geo = fillGeometry(pts);
      if (geo) {
        const fill = new THREE.Mesh(geo, live ? liveFill : doneFill);
        fill.renderOrder = 7;
        g.add(fill);
      }
    }

    for (const p of pts) {
      const d = new THREE.Mesh(dotGeo, dotMat);
      d.position.copy(p);
      d.renderOrder = 10;
      g.add(d);
    }
    return g;
  };

  const anchorOf = (kind: MeasureKind, pts: THREE.Vector3[]): THREE.Vector3 => {
    if (kind === 'dist' && pts.length >= 2)
      return new THREE.Vector3().addVectors(pts[0], pts[1]).multiplyScalar(0.5);
    const c = new THREE.Vector3();
    for (const p of pts) c.add(p);
    return pts.length ? c.multiplyScalar(1 / pts.length) : c;
  };

  const textOf = (kind: MeasureKind, pts: THREE.Vector3[], fmt: MeasureFormat): string => {
    if (kind === 'dist') {
      if (pts.length < 2) return '';
      const [a, b] = pts;
      const head = fmt.length(a.distanceTo(b));
      const tail = `ΔX ${fmt.length(Math.abs(b.x - a.x))}  ΔY ${fmt.length(
        Math.abs(b.y - a.y),
      )}  ΔZ ${fmt.length(Math.abs(b.z - a.z))}`;
      return `${head}\n${tail}`;
    }
    if (pts.length < 3) return '';
    return `${fmt.area(ringArea3(pts))}\n⌒ ${fmt.length(perimeter(pts))}`;
  };

  /** Two lines, the second dimmer. Written as elements rather than innerHTML so
   *  a formatter can never inject markup. */
  const paint = (el: HTMLElement, text: string): void => {
    el.textContent = '';
    if (!text) {
      el.hidden = true;
      return;
    }
    const [head, tail] = text.split('\n');
    const h = document.createElement('div');
    h.textContent = head;
    el.append(h);
    if (tail) {
      const t = document.createElement('div');
      t.className = 'delta';
      t.textContent = tail;
      el.append(t);
    }
    el.hidden = false;
  };

  const drop = (id: number): void => {
    const e = entries.get(id);
    if (!e) return;
    entries.delete(id);
    group.remove(e.obj);
    e.obj.traverse((o) => {
      // The shared dot sphere and every material outlive the entry; only the
      // per-measurement line and fill geometries are this entry's to free.
      if (o instanceof THREE.Line) o.geometry.dispose();
      else if (o instanceof THREE.Mesh && o.geometry !== dotGeo) o.geometry.dispose();
    });
    e.el.remove();
  };

  const put = (id: number, kind: MeasureKind, pts: THREE.Vector3[], live: boolean): void => {
    drop(id);
    if (!pts.length) return;
    const obj = buildGeometry(kind, pts, live);
    group.add(obj);
    const el = document.createElement('div');
    el.className = live ? 'measureLabel live' : 'measureLabel';
    el.hidden = true;
    dom.append(el);
    const held = pts.map((p) => p.clone());
    const entry: Entry = { kind, pts: held, obj, el, anchor: anchorOf(kind, held), text: '' };
    if (lastFmt) {
      entry.text = textOf(kind, held, lastFmt);
      paint(el, entry.text);
    }
    entries.set(id, entry);
  };

  return {
    group,
    dom,
    snapCursor,

    setLive: (kind, pts, snap) => {
      put(LIVE_ID, kind, pts, true);
      const tip = pts[pts.length - 1];
      snapCursor.visible = !!tip;
      if (tip) {
        snapCursor.position.copy(tip);
        (snapCursor.material as THREE.MeshBasicMaterial).color.setHex(SNAP_COLOR[snap]);
      }
    },

    add: (m) => put(m.id, m.kind, m.pts, false),
    remove: drop,

    clear: () => {
      for (const id of [...entries.keys()]) drop(id);
      snapCursor.visible = false;
    },

    sync: (camera, rect, fmt) => {
      // A language flip replaces the formatter object, which is the signal to
      // re-render every cached string. Nothing else touches the text.
      const refmt = fmt !== lastFmt;
      lastFmt = fmt;
      for (const [id, e] of entries) {
        // A committed measurement's text is fixed at the moment it is made, so
        // only the live one is re-derived per frame — and then only written if
        // it actually changed, which it does not while the pointer is still.
        if (refmt || id === LIVE_ID) {
          const next = textOf(e.kind, e.pts, fmt);
          if (next !== e.text) {
            e.text = next;
            paint(e.el, next);
          }
        }
        if (!e.text) continue;
        const s = toScreen(e.anchor, camera, rect);
        // Behind the camera a point still projects to a finite pair of
        // coordinates, mirrored through the centre of the screen — so the test
        // is the difference between a label that disappears when you orbit past
        // it and one that slides to the wrong side of the window.
        e.el.hidden = s.behind;
        if (s.behind) continue;
        e.el.style.transform = `translate(-50%, -50%) translate(${Math.round(s.x)}px, ${Math.round(
          s.y,
        )}px)`;
      }
    },

    dispose: () => {
      for (const id of [...entries.keys()]) drop(id);
      dom.remove();
      snapCursor.geometry.dispose();
      (snapCursor.material as THREE.Material).dispose();
      dotGeo.dispose();
      liveMat.dispose();
      doneMat.dispose();
      liveDot.dispose();
      doneDot.dispose();
      liveFill.dispose();
      doneFill.dispose();
    },
  };
}
