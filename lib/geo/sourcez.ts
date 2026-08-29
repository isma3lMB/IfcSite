import type { Vec2, Vec3 } from '@/lib/types';

/**
 * Elevation taken from the source geometry instead of from the DEM.
 *
 * BD TOPO ships its road and rail centrelines as 3D linestrings — the Z is a
 * surveyed NGF altitude, the same datum RGE ALTI is in. Everything downstream
 * of ingest throws it away (`toLocal(c[0], c[1])` keeps X and Y only), which is
 * why a bridge deck ends up draped onto the ground it crosses. These two
 * helpers are what a layer with draping turned off reads instead.
 *
 * Both are pure and local-metre: no projection, no fetch, no terrain.
 */

/** Segments of every polyline, flattened, with the bucket grid they were indexed
 *  on. Built once per sampler; see polylineZAt below. */
type Seg = { ax: number; ay: number; az: number; bx: number; by: number; bz: number };

/**
 * Whether a source ordinate is an elevation at all.
 *
 * Being 3D is not the same as being populated. BD TOPO writes exactly -1000
 * into any position it has no altimetry for, and that value is perfectly
 * finite, so a plain isFinite check passes it straight through — one such
 * vertex in a road ribbon puts a corner 1160 m under a site at +160 m and hangs
 * a spike off the model down to it. Measured against the live WFS it is sparse
 * and clustered rather than uniform: 21 of 5077 road vertices around Lyon in one
 * feature, 18 of 1369 rail vertices in two, none at all around Paris or
 * Grenoble, which is why it shows up as a handful of spikes rather than a layer
 * that visibly collapses.
 *
 * The band is far wider than rejecting -1000 needs, on purpose. It has to catch
 * that value and any sibling sentinel without ever second-guessing a real
 * altitude, and a real altitude here CAN be negative: surface_hydrographique
 * genuinely returns -2.3 m near Bordeaux. Anything tighter — rejecting
 * negatives, or clamping to the terrain — would start deleting true data. The
 * floor sits far below France's lowest land (about -2 m, the Flanders polders)
 * and the ceiling above its highest (Mont Blanc, 4809 m).
 */
const Z_FLOOR = -500;
const Z_CEIL = 5000;
const plausibleZ = (z: number): boolean => Number.isFinite(z) && z > Z_FLOOR && z < Z_CEIL;

/**
 * Source positions -> local XY with their source Z, or null if there is no
 * usable Z here.
 *
 * This doubles as the "does this feature actually carry elevation" test, and it
 * has to, because the answer varies per layer and cannot be known before the
 * fetch: `troncon_de_route` is a 3D linestring, `zone_de_vegetation` is flat 2D
 * rings, and a 3D layer still leaves individual positions unpopulated. A caller
 * that gets null back drapes the feature the way it always did.
 *
 * Positions without a usable third ordinate are dropped rather than defaulted,
 * so a linestring missing one contributes its good vertices and lets the sampler
 * interpolate across the gap — a straight line in Z between the neighbours that
 * do have it, which is the right answer for a road. Defaulting instead would put
 * a real-looking elevation on a vertex that has none. Two survivors are the
 * minimum: one point defines no segment, and a sampler over it would return a
 * constant.
 */
export function zLineFrom(
  ring: number[][],
  toLocal: (lon: number, lat: number) => Vec2,
): Vec3[] | null {
  const out: Vec3[] = [];
  for (const c of ring) {
    if (c.length < 3 || !plausibleZ(c[2])) continue;
    const [x, y] = toLocal(c[0], c[1]);
    out.push([x, y, c[2]]);
  }
  return out.length >= 2 ? out : null;
}

/** Sampler cell target: enough buckets that a long motorway is not one cell,
 *  few enough that a short kerb ring does not allocate a grid. */
const TARGET_PER_CELL = 4;
const MAX_CELLS = 4096;

/**
 * Elevation at a local XY, read off the nearest point of `lines`.
 *
 * Nearest-point rather than per-vertex lookup because the ring being sampled is
 * NOT the polyline being sampled from. A carriageway's outline is offset half a
 * width sideways from its centreline, and `pushRoadway` invents vertices the
 * source never had — the arc points on every bend, and whatever `clipToBox`
 * cuts in at the site boundary. None of those can be matched back to a source
 * position by index or by identity, but all of them are within half a
 * carriageway of the centreline they came from, so the nearest segment is the
 * right one and interpolating along it gives the road's own longitudinal
 * profile.
 *
 * For an area layer the same call lofts the interior from its boundary: a lake
 * ring is level, so nearest-boundary Z is exact, and a forest on a slope gets a
 * reasonable interpolation rather than a plane.
 *
 * The segments are bucketed on a uniform grid because the caller is a ribbon
 * with thousands of vertices sampling a centreline with thousands of segments,
 * and the O(n*m) that falls out of the naive version is the whole build. Search
 * widens a ring of cells at a time and only stops once the best distance found
 * is inside the ring already searched — a segment two cells away can still beat
 * one in the centre cell, so stopping at the first hit would be wrong.
 */
export function polylineZAt(lines: Vec3[][]): (x: number, y: number) => number {
  const segs: Seg[] = [];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i];
      const b = line[i + 1];
      segs.push({ ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2] });
      x0 = Math.min(x0, a[0], b[0]);
      y0 = Math.min(y0, a[1], b[1]);
      x1 = Math.max(x1, a[0], b[0]);
      y1 = Math.max(y1, a[1], b[1]);
    }
  }
  // No segment at all means no opinion. A constant 0 would be a silent lie, but
  // the callers all check zLineFrom first, so this is unreachable in practice
  // and only here so the returned function is total.
  if (!segs.length) return () => 0;

  /** Distance squared from (px,py) to one segment, and the Z there. */
  const probe = (s: Seg, px: number, py: number): { d2: number; z: number } => {
    const dx = s.bx - s.ax;
    const dy = s.by - s.ay;
    const L2 = dx * dx + dy * dy;
    // Clamped, so a point past either end takes that endpoint's elevation
    // rather than an extrapolation off the end of the road.
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - s.ax) * dx + (py - s.ay) * dy) / L2)) : 0;
    const cx = s.ax + dx * t;
    const cy = s.ay + dy * t;
    return { d2: (px - cx) * (px - cx) + (py - cy) * (py - cy), z: s.az + (s.bz - s.az) * t };
  };

  const w = Math.max(x1 - x0, 1e-6);
  const h = Math.max(y1 - y0, 1e-6);
  const want = Math.max(1, Math.min(MAX_CELLS, Math.ceil(segs.length / TARGET_PER_CELL)));
  // Cells sized so the grid is roughly `want` of them over the segments' own
  // bbox, keeping them square rather than stretching one axis of a long ribbon.
  const cell = Math.max(Math.sqrt((w * h) / want), 1e-6);
  const nx = Math.max(1, Math.min(1024, Math.ceil(w / cell)));
  const ny = Math.max(1, Math.min(1024, Math.ceil(h / cell)));
  const cx = w / nx;
  const cy = h / ny;
  const buckets: Seg[][] = Array.from({ length: nx * ny }, () => []);
  const col = (x: number): number => Math.max(0, Math.min(nx - 1, Math.floor((x - x0) / cx)));
  const row = (y: number): number => Math.max(0, Math.min(ny - 1, Math.floor((y - y0) / cy)));
  for (const s of segs) {
    // A segment goes into every cell of its own bbox. Conservative — a diagonal
    // claims cells it does not cross — but the alternative is a rasteriser, and
    // the cost of an extra probe is a dozen flops.
    const i0 = col(Math.min(s.ax, s.bx));
    const i1 = col(Math.max(s.ax, s.bx));
    const j0 = row(Math.min(s.ay, s.by));
    const j1 = row(Math.max(s.ay, s.by));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) buckets[j * nx + i].push(s);
  }

  const maxRing = Math.max(nx, ny);
  return (px: number, py: number): number => {
    const ci = col(px);
    const cj = row(py);
    let best = Infinity;
    let bz = 0;
    for (let r = 0; r <= maxRing; r++) {
      const i0 = Math.max(0, ci - r);
      const i1 = Math.min(nx - 1, ci + r);
      const j0 = Math.max(0, cj - r);
      const j1 = Math.min(ny - 1, cj + r);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          // Only the rim of the square is new on rings after the first.
          if (r > 0 && i > ci - r && i < ci + r && j > cj - r && j < cj + r) continue;
          for (const s of buckets[j * nx + i]) {
            const { d2, z } = probe(s, px, py);
            if (d2 < best) {
              best = d2;
              bz = z;
            }
          }
        }
      }
      // The ring just searched covers everything within r cells. Anything closer
      // than that is already found, so a further ring cannot improve on it.
      if (best < Infinity) {
        const reach = r * Math.min(cx, cy);
        if (best <= reach * reach) break;
      }
    }
    return bz;
  };
}
