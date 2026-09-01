import { cloneXf } from '@/lib/scene/xf';
import type { Building, Tree, Vec2 } from '@/lib/types';

/**
 * A duplicate of a scene record, ready to be inserted.
 *
 * The copy lands exactly where the original is — same footprint, same
 * transform — so nothing about the pair's position is invented. The viewer
 * selects it, which is what makes the coincidence usable: the gizmo is already
 * on the copy, so the first drag moves it off.
 *
 * `src` becomes 'user' whatever the original was. A copy is hand-made work —
 * drawnCount reads exactly this flag to decide whether a rebuild is about to
 * destroy something, and a copy that inherited 'tag:height' would be discarded
 * without the warning ever mentioning it. The visible cost is that a copy of an
 * untinted sourced building draws in the drawn-here blue (see defaultColors);
 * one the user has recoloured keeps its colour, because that rides on the xf.
 *
 * Nothing mutable is shared with the original: ring, centre, props and xf are
 * all copied out, or a gizmo drag on one would move both.
 */
export function duplicateBuilding(b: Building, id: string, name: string): Building {
  return {
    id,
    name,
    // The source's own osm_id or cleabs rides along deliberately: it is the only
    // record of where the copy came from, and Source says plainly that this one
    // was made here rather than fetched.
    props: { ...b.props, Source: 'drawn' },
    ring: b.ring.map((p): Vec2 => [p[0], p[1]]),
    center: [b.center[0], b.center[1]],
    h: b.h,
    baseZ: b.baseZ,
    src: 'user',
    xf: cloneXf(b.xf),
  };
}

export function duplicateTree(t: Tree, id: string, name: string): Tree {
  return {
    id,
    name,
    props: { ...t.props, Source: 'drawn' },
    x: t.x,
    y: t.y,
    z: t.z,
    h: t.h,
    cr: t.cr,
    tr: t.tr,
    src: 'user',
    xf: cloneXf(t.xf),
  };
}
