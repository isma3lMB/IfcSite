import { pointInRing } from '@/lib/geo/rings';
import type { SiteRect, Vec2 } from '@/lib/types';

/**
 * Metropolitan France, as a shape rather than a rectangle.
 *
 * This used to be `FR_BOUNDS`, a min/max box in lib/sources/ign. A box drawn
 * around France contains Catalonia, Aragón, Navarra and Euskadi, so a site in
 * Barcelona read as French: the data source stayed on IGN, which pinned the CRS
 * to Lambert-93 and the vertical datum to NGF-IGN69, and then returned no
 * buildings because BD TOPO stops at the border. No amount of tightening fixes
 * that — the Pyrenees do not run along a parallel.
 *
 * The two ways of being wrong here are not worth the same. Cutting a real French
 * site out of IGN is a regression for the people this tool was built for; letting
 * Geneva or Basel read as French only preserves what the box already did, and the
 * build there simply comes back empty. So the coastline is drawn offshore and
 * generously, and the effort goes into the land borders — the Pyrenees above all,
 * where excluding Spain is the entire point.
 *
 * Coarse on purpose. It answers "which country is this site in", not "where
 * exactly does the frontier run", and a few hundred metres of slack costs
 * nothing at that question. Enclaves are ignored: Monaco reads as French, which
 * is what its surveyors use anyway.
 *
 * The known limit is the Bidasoa river mouth, where Hendaye and Irún are two
 * kilometres apart and both read as French. Separating them would need a vertex
 * spacing this shape does not have, and it fails the harmless way — a site in
 * Irún keeps IGN and comes back empty, exactly as it did under the box.
 */
const MAINLAND: Vec2[] = [
  // Channel coast, west from the Belgian border at Bray-Dunes.
  [2.56, 51.09], [1.45, 51.05], [0.20, 49.85], [-1.30, 49.80], [-2.05, 49.80],
  [-1.80, 48.78], [-3.10, 48.95], [-4.90, 48.55],
  // Atlantic.
  [-4.90, 47.75], [-2.60, 47.20], [-2.35, 46.60], [-1.60, 46.10], [-1.45, 45.30],
  [-1.40, 44.55], [-1.95, 43.30],
  // Pyrenees: the frontier, around the Val d'Aran and north of Andorra.
  [-1.78, 43.33], [-1.35, 43.06], [-0.73, 42.96], [-0.15, 42.79], [0.40, 42.72],
  [0.66, 42.84], [0.98, 42.83], [1.42, 42.63], [1.79, 42.58], [2.02, 42.50],
  [2.55, 42.38], [3.25, 42.42],
  // Mediterranean coast, offshore.
  [3.15, 43.05], [4.20, 43.20], [5.10, 42.98], [6.20, 42.95], [6.75, 43.02],
  [7.20, 43.55], [7.45, 43.70], [7.52, 43.72],
  // Alps: east of Menton, east of Chamonix, west of Aosta.
  [7.57, 43.90], [6.95, 44.25], [6.85, 45.15], [7.05, 45.65], [6.95, 45.95],
  // Chablais and the south shore of Lake Geneva, then around the Geneva canton —
  // Thonon and Évian are inside, Lausanne and Nyon are not.
  [6.80, 46.05], [6.90, 46.28], [6.85, 46.40], [6.40, 46.44], [6.17, 46.30],
  [6.28, 46.26], [6.20, 46.13], [6.06, 46.16], [6.10, 46.28],
  // Jura, up to the Rhine just north of Basel: Saint-Louis in, Basel out.
  [6.02, 46.40], [6.30, 46.71], [6.42, 46.90], [6.68, 47.06], [7.10, 47.49],
  [7.60, 47.585],
  // The Rhine, then west along the German border above Wissembourg.
  [8.23, 49.05], [7.45, 49.05], [6.85, 49.20],
  // Luxembourg, then Belgium — with the Givet salient, which pokes far enough
  // north that a straight edge would leave a French town out.
  [5.85, 49.60], [4.87, 49.79], [4.88, 50.10], [4.78, 50.20], [4.70, 50.10],
  [4.20, 50.05], [3.95, 50.36], [3.55, 50.48], [3.28, 50.58], [3.22, 50.72],
  [3.06, 50.75], [2.85, 50.78], [2.58, 50.95],
];

const CORSICA: Vec2[] = [
  [8.45, 42.80], [9.30, 43.10], [9.65, 42.60], [9.62, 41.80], [9.35, 41.28],
  [8.70, 41.45], [8.42, 42.30],
];

/** [lon, lat] rings, the order pointInRing expects — not the [lat, lon] the
 *  rest of the geo layer passes around. */
const FRANCE_RINGS: Vec2[][] = [MAINLAND, CORSICA];

/**
 * Is this point in metropolitan France?
 *
 * pointInRing is an even-odd ray cast and winding-agnostic, which is what the
 * Givet salient and the Geneva notch need — both are re-entrant.
 */
export const inFrance = (lat: number, lon: number): boolean =>
  FRANCE_RINGS.some((ring) => pointInRing([lon, lat], ring));

/** A rectangle can straddle the border, so every corner has to be inside. */
export const rectInFrance = (r: SiteRect): boolean =>
  inFrance(r.minLat, r.minLon) &&
  inFrance(r.minLat, r.maxLon) &&
  inFrance(r.maxLat, r.minLon) &&
  inFrance(r.maxLat, r.maxLon);
