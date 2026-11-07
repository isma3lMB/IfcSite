import { groundAt } from '@/lib/geo/voids';
import type { Grid, LayerId, SceneData, Surface, Tree, Vec3 } from '@/lib/types';

/* =====================================================================
   Sculpting the terrain: editing the lattice's heights by hand, so the
   landscape design can be adjusted before the site goes out.

   Pure and free of three.js, like the rest of lib/scene. The viewer owns the
   pointer and the undo stack; this owns the arithmetic — which vertices a
   brush reaches, what a dab does to them, and how everything resting on the
   ground follows it.

   The lattice is edited in place (`Grid.verts[k][2]`), and that is the whole
   of what reaching the deliverable takes: the IFC and glTF writers, the draft
   and `Grid.sample` (see gridFrom in lib/geo/grid) all read the vertices, so a
   sculpted height is the height everywhere at once.
   ===================================================================== */

/** What a dab does to the vertices under the brush. */
export const SCULPT_MODES = ['raise', 'lower', 'flatten', 'smooth', 'set'] as const;
export type SculptMode = (typeof SCULPT_MODES)[number];

/** How the brush's effect fades from its centre to its rim. */
export const SCULPT_FALLOFFS = ['smooth', 'linear', 'flat'] as const;
export type SculptFalloff = (typeof SCULPT_FALLOFFS)[number];

export type SculptBrush = {
  mode: SculptMode;
  /** Brush radius in metres. Under half a lattice cell the brush is one vertex:
   *  the nearest, at full weight — which is how a single vertex is edited. */
  radius: number;
  /** Metres a raise or lower moves the centre by, per dab. */
  strength: number;
  falloff: SculptFalloff;
  /** The elevation 'set' moves the ground to, absolute model z. */
  target: number;
};

/** The bounds the panel and the viewer clamp brush settings to. Finiteness
 *  before the clamp, the order lib/build/tunables sets and for its reason. */
export const SCULPT_RANGE = {
  radius: [0, 500],
  strength: [0.01, 50],
} as const;

export const DEFAULT_BRUSH: SculptBrush = {
  mode: 'raise',
  radius: 20,
  strength: 0.5,
  falloff: 'smooth',
  target: 0,
};

const clamp = (v: number, [lo, hi]: readonly [number, number], dflt: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;

/** A brush with every number inside its range and finite. */
export function sanitizeBrush(b: SculptBrush): SculptBrush {
  return {
    mode: (SCULPT_MODES as readonly string[]).includes(b.mode) ? b.mode : DEFAULT_BRUSH.mode,
    falloff: (SCULPT_FALLOFFS as readonly string[]).includes(b.falloff)
      ? b.falloff
      : DEFAULT_BRUSH.falloff,
    radius: clamp(b.radius, SCULPT_RANGE.radius, DEFAULT_BRUSH.radius),
    strength: clamp(b.strength, SCULPT_RANGE.strength, DEFAULT_BRUSH.strength),
    target: Number.isFinite(b.target) ? b.target : DEFAULT_BRUSH.target,
  };
}

/** Weight at distance `d` from the centre of a brush of radius `r`, 0..1. */
export function falloffWeight(d: number, r: number, f: SculptFalloff): number {
  if (!(r > 0) || d >= r) return 0;
  const u = d / r;
  if (f === 'flat') return 1;
  if (f === 'linear') return 1 - u;
  // Cosine bell: flat at the centre, flat at the rim, so neither a mound's top
  // nor its foot comes out as a crease.
  return 0.5 * (1 + Math.cos(Math.PI * u));
}

/** The lattice's spacing in metres — the shorter of its two steps. Both
 *  providers lay the lattice out evenly in lat/lon, so in local metres it is
 *  as near to regular as a projection allows over one site. */
export function cellSize(g: Grid): number {
  const V = g.verts;
  const n = g.n;
  if (n < 1 || V.length < n + 2) return 1;
  const di = Math.hypot(V[1][0] - V[0][0], V[1][1] - V[0][1]);
  const dj = Math.hypot(V[n + 1][0] - V[0][0], V[n + 1][1] - V[0][1]);
  return Math.max(1e-3, Math.min(di, dj));
}

/** The lattice vertex nearest a local point, in plan. */
export function nearestVertex(g: Grid, x: number, y: number): number {
  let best = -1;
  let bd = Infinity;
  g.verts.forEach((v, k) => {
    const d = (v[0] - x) ** 2 + (v[1] - y) ** 2;
    if (d < bd) {
      bd = d;
      best = k;
    }
  });
  return best;
}

/**
 * The vertices a brush centred on (x, y) reaches, each with its weight.
 *
 * A radius under half a cell cannot be trusted to contain any vertex at all, so
 * it means "the nearest one, fully" — the precise, one-vertex edit.
 */
export function brushWeights(
  g: Grid,
  x: number,
  y: number,
  radius: number,
  falloff: SculptFalloff,
): { k: number; w: number }[] {
  if (radius < cellSize(g) / 2) {
    const k = nearestVertex(g, x, y);
    return k < 0 ? [] : [{ k, w: 1 }];
  }
  const out: { k: number; w: number }[] = [];
  const V = g.verts;
  for (let k = 0; k < V.length; k++) {
    const dx = V[k][0] - x;
    if (dx > radius || dx < -radius) continue;
    const dy = V[k][1] - y;
    if (dy > radius || dy < -radius) continue;
    const w = falloffWeight(Math.hypot(dx, dy), radius, falloff);
    if (w > 0) out.push({ k, w });
  }
  return out;
}

/** The mean height of a vertex's lattice neighbours — the eight round it, or
 *  as many of them as the edge leaves. */
function neighbourMean(g: Grid, k: number): number {
  const n1 = g.n + 1;
  const i = k % n1;
  const j = (k - i) / n1;
  let sum = 0;
  let cnt = 0;
  for (let dj = -1; dj <= 1; dj++)
    for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= n1 || b >= n1) continue;
      sum += g.verts[b * n1 + a][2];
      cnt++;
    }
  return cnt ? sum / cnt : g.verts[k][2];
}

/**
 * One dab of the brush at (x, y), written into the lattice.
 *
 * `level` is the height flatten levels to — the ground under the stroke's
 * first dab, so a stroke dragged across a slope cuts and fills to one plane
 * rather than chasing the slope down. 'set' levels to the brush's own target.
 * Every new height is worked out before any is written, so smoothing reads its
 * neighbours as they were rather than half-smoothed already.
 *
 * Returns each vertex that actually moved, with the height it had before.
 */
export function dab(
  g: Grid,
  x: number,
  y: number,
  brush: SculptBrush,
  level: number,
): { k: number; was: number }[] {
  const V = g.verts;
  const next = brushWeights(g, x, y, brush.radius, brush.falloff).map(({ k, w }) => {
    const z = V[k][2];
    switch (brush.mode) {
      case 'raise':
        return { k, z: z + brush.strength * w };
      case 'lower':
        return { k, z: z - brush.strength * w };
      case 'flatten':
        return { k, z: z + (level - z) * w };
      case 'set':
        return { k, z: z + (brush.target - z) * w };
      case 'smooth':
        return { k, z: z + (neighbourMean(g, k) - z) * w };
    }
  });
  const out: { k: number; was: number }[] = [];
  for (const { k, z } of next) {
    if (!Number.isFinite(z) || z === V[k][2]) continue;
    out.push({ k, was: V[k][2] });
    V[k][2] = z;
  }
  return out;
}

/** Keep the delivered heights, the first time anything edits them. */
export function keepOriginal(g: Grid): void {
  if (!g.z0) g.z0 = g.verts.map((v) => v[2]);
}

/** How many vertices stand somewhere other than where the DEM put them. */
export function editedCount(g: Grid | null): number {
  if (!g?.z0) return 0;
  let n = 0;
  for (let k = 0; k < g.verts.length; k++) if (g.verts[k][2] !== g.z0[k]) n++;
  return n;
}

/* ---- what rests on the ground ---------------------------------------- */

/**
 * How far off the ground a vertex or a tree's base may stand and still count as
 * resting on it. Roads sit their LAYER_DZ rung above it and their skirts a bite
 * below, both well inside this. A deck whose elevation came from the source
 * (drape turned off) can be metres clear — over a valley, a bridge — and is
 * left where it is: lowering the ground under a bridge must not take the
 * bridge down with it.
 */
export const FOLLOW_TOL = 1;

/**
 * One terrain edit's effect on everything that follows the ground, as data, so
 * an undo puts back exactly what it moved rather than deciding again — after
 * the edit the gaps are different, and deciding again could move a bridge.
 */
export type GroundShift = {
  /** Vertices of fetched surfaces and of the road and railway ribbons. Held by
   *  reference: ribbon faces share their corners, and each moves once. */
  verts: { v: Vec3; dz: number }[];
  trees: { t: Tree; dz: number }[];
  /** The fetched surfaces any of `verts` belong to, for the viewer to redraw. */
  surfaces: Surface[];
  roads: boolean;
  railways: boolean;
};

export const emptyShift = (): GroundShift => ({
  verts: [],
  trees: [],
  surfaces: [],
  roads: false,
  railways: false,
});

/**
 * Carry everything resting on the ground through a change of its heights.
 *
 * `before` holds the old height of every lattice vertex the edit moved; the
 * lattice itself already carries the new ones. The change in ground height is
 * the lattice of differences interpolated on the terrain's own triangles —
 * which is exact for a draped layer, whose every vertex lies on one of those
 * triangles (see conformToTerrain in lib/geo/conform): it moves by the same
 * linear function its triangle moved by, and lands on the new ground at the
 * same clearance it had over the old.
 *
 * What follows:
 * - fetched context surfaces (vegetation, water, parcels, hedges), whole —
 *   all of their vertices, because a hedge's top has to rise with its base.
 *   Not one whose elevation came from the source (`z_source: 'source'`);
 * - the road and railway ribbons and their skirts, vertex by vertex, where a
 *   vertex was resting on the ground (see FOLLOW_TOL);
 * - trees whose base was resting on the ground.
 *
 * What does not:
 * - buildings — they are the fixed points a landscape is graded around. One set
 *   to cut the ground has its plinth re-measured by the caller (plinthOf), as
 *   on every other change to the ground under it;
 * - drawn surfaces and voids, which the caller rebuilds from their recipe the
 *   way a move does, so "level at the lowest corner" still holds.
 *
 * Nothing is moved here: the result is applied with applyShift.
 */
export function followGround(scene: SceneData, before: Map<number, number>): GroundShift {
  const g = scene.terrain;
  const out = emptyShift();
  if (!g || !before.size) return out;

  // Where the ground could have moved at all: a cell's reach round every edited
  // vertex. Everything outside is skipped before any triangle lookup.
  const pad = cellSize(g) * 1.5;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const k of before.keys()) {
    const v = g.verts[k];
    if (v[0] < x0) x0 = v[0];
    if (v[0] > x1) x1 = v[0];
    if (v[1] < y0) y0 = v[1];
    if (v[1] > y1) y1 = v[1];
  }
  x0 -= pad;
  y0 -= pad;
  x1 += pad;
  y1 += pad;
  const inside = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

  // The lattice of differences on the same faces array, which is what the face
  // index in lib/geo/voids is keyed on — the index is plan-only, so it is the
  // terrain's own and is not built again.
  const delta = {
    verts: g.verts.map((v, k): Vec3 => [v[0], v[1], before.has(k) ? v[2] - before.get(k)! : 0]),
    faces: g.faces,
  };
  const dzAt = (x: number, y: number): number => (inside(x, y) ? (groundAt(delta, x, y) ?? 0) : 0);

  const off = (id: LayerId): Vec3 => scene.layers[id]?.offset ?? [0, 0, 0];

  /** Each vertex of a set of ribbon faces that was resting on the ground. */
  const ribbon = (faces: Vec3[][], id: LayerId, seen: Set<Vec3>): boolean => {
    const [ox, oy, oz] = off(id);
    let any = false;
    for (const f of faces)
      for (const v of f) {
        if (seen.has(v)) continue;
        seen.add(v);
        const x = v[0] + ox;
        const y = v[1] + oy;
        const dz = dzAt(x, y);
        if (!dz) continue;
        const now = groundAt(g, x, y);
        if (now === null) continue;
        if (Math.abs(v[2] + oz - (now - dz)) > FOLLOW_TOL) continue;
        out.verts.push({ v, dz });
        any = true;
      }
    return any;
  };
  // One `seen` across a ribbon's top and its skirt: skirtInto hangs the wall
  // off the very vertices the top's rim is made of.
  const seen = new Set<Vec3>();
  const roadTop = ribbon(scene.roads, 'roads', seen);
  const roadWall = ribbon(scene.roadWalls, 'roads', seen);
  out.roads = roadTop || roadWall;
  const railTop = ribbon(scene.railways, 'railways', seen);
  const railWall = ribbon(scene.railwayWalls, 'railways', seen);
  out.railways = railTop || railWall;

  for (const s of scene.surfaces) {
    if (s.drawn || s.props?.z_source === 'source') continue;
    const [ox, oy] = off(s.layer ?? 'parcel');
    let any = false;
    for (const v of s.verts) {
      const dz = dzAt(v[0] + ox, v[1] + oy);
      if (!dz) continue;
      out.verts.push({ v, dz });
      any = true;
    }
    if (any) out.surfaces.push(s);
  }

  const [tx, ty, tz] = off('trees');
  for (const t of scene.trees) {
    const x = t.x + t.xf.pos[0] + tx;
    const y = t.y + t.xf.pos[1] + ty;
    const dz = dzAt(x, y);
    if (!dz) continue;
    const now = groundAt(g, x, y);
    if (now === null) continue;
    if (Math.abs(t.z + t.xf.pos[2] + tz - (now - dz)) > FOLLOW_TOL) continue;
    out.trees.push({ t, dz });
  }
  return out;
}

/** Move what a GroundShift names: forward with +1, back with -1. */
export function applyShift(s: GroundShift, sign: 1 | -1): void {
  for (const { v, dz } of s.verts) v[2] += sign * dz;
  for (const { t, dz } of s.trees) t.z += sign * dz;
}

/** Write a set of lattice heights. */
export function setHeights(g: Grid, idx: readonly number[], z: readonly number[]): void {
  for (let i = 0; i < idx.length; i++) g.verts[idx[i]][2] = z[i];
}
