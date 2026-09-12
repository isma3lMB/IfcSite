import proj4 from 'proj4';
import type { SiteMeta, ToGeo, Vec2 } from '@/lib/types';

/**
 * Local site metres back to lon/lat, through the definition the site was built
 * with.
 *
 * What a drape drawn in the 3D view needs: Grid.sample is keyed on lat/lon, and
 * the viewer has no projection of its own — it never imports proj4 and never
 * sees a CRS. Built from the meta rather than handed down from runBuild, so a
 * draft reopened offline gets one from the definition it carries, the same
 * source the writer inverts the origin marker through.
 *
 * The converter is built once: proj4(from, to) parses both definitions, and a
 * conform calls this once per unique vertex.
 *
 * Null when the definition will not parse — a hand-edited draft can carry one.
 * The caller then holds drawn shapes level rather than draping them.
 */
export function toGeoOf(meta: Pick<SiteMeta, 'crsDef' | 'origin'>): ToGeo | null {
  if (!meta.crsDef) return null;
  try {
    const conv = proj4(meta.crsDef, 'EPSG:4326');
    const [ox, oy] = meta.origin;
    const probe = conv.forward([ox, oy]) as Vec2;
    if (!Number.isFinite(probe[0]) || !Number.isFinite(probe[1])) return null;
    return (x, y) => conv.forward([x + ox, y + oy]) as Vec2;
  } catch {
    return null;
  }
}
