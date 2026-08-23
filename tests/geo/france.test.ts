import { describe, expect, it } from 'vitest';
import { inFrance, rectInFrance } from '@/lib/geo/france';

/**
 * The polygon that replaced FR_BOUNDS, checked town by town.
 *
 * The two ways of being wrong are not worth the same, and the lists below are
 * ordered by that: excluding a French town breaks IGN for the people the tool
 * was built for, so `inside` is the half that must never fail. `outside` is
 * mostly about Spain, which is what the box got wrong — a Swiss or German town
 * slipping in only reproduces what the box already did.
 *
 * Border towns are the ones that actually exercise the shape; the interior
 * cities are here so that a badly wound ring fails loudly rather than subtly.
 */
const inside: [string, number, number][] = [
  // Channel and Atlantic coast — drawn offshore, so these must clear it.
  ['Dunkerque', 51.035, 2.377], ['Calais', 50.95, 1.86], ['Boulogne', 50.73, 1.61],
  ['Dieppe', 49.92, 1.08], ['Le Havre', 49.49, 0.11], ['Caen', 49.18, -0.37],
  ['Cherbourg', 49.64, -1.62], ['Granville', 48.84, -1.6], ['Saint-Malo', 48.65, -2.03],
  ['Brest', 48.39, -4.49], ['Quimper', 47.996, -4.1], ['Lorient', 47.75, -3.37],
  ['Vannes', 47.66, -2.76], ['Saint-Nazaire', 47.27, -2.21], ['Les Sables', 46.5, -1.78],
  ['La Rochelle', 46.16, -1.15], ['Royan', 45.63, -1.03], ['Arcachon', 44.66, -1.17],
  // Pyrenees — the frontier the whole rewrite is about.
  ['Biarritz', 43.48, -1.56], ['Hendaye', 43.36, -1.77], ['Pau', 43.3, -0.37],
  ['Tarbes', 43.23, 0.07], ['Foix', 42.96, 1.61], ['Perpignan', 42.7, 2.9],
  ['Céret', 42.49, 2.75], ['Banyuls', 42.48, 3.13],
  // Mediterranean coast and the Italian corner.
  ['Narbonne', 43.18, 3.0], ['Montpellier', 43.61, 3.88], ['Arles', 43.68, 4.63],
  ['Saintes-Maries', 43.45, 4.43], ['Marseille', 43.3, 5.37], ['Toulon', 43.12, 5.93],
  ['Hyères', 43.12, 6.13], ['Saint-Tropez', 43.27, 6.64], ['Cannes', 43.55, 7.02],
  ['Nice', 43.7, 7.27], ['Menton', 43.775, 7.5],
  // Alps, Lake Geneva and the Jura.
  ['Briançon', 44.9, 6.65], ['Chamonix', 45.92, 6.87], ['Annecy', 45.9, 6.13],
  ['Thonon', 46.37, 6.48], ['Évian', 46.4, 6.59], ['Gex', 46.33, 6.06],
  ['Annemasse', 46.19, 6.24], ['Pontarlier', 46.9, 6.35], ['Morteau', 47.06, 6.61],
  ['Besançon', 47.24, 6.02], ['Belfort', 47.64, 6.86],
  // Alsace and Lorraine, along the Rhine.
  ['Saint-Louis', 47.59, 7.56], ['Mulhouse', 47.75, 7.34], ['Colmar', 48.08, 7.36],
  ['Strasbourg', 48.58, 7.75], ['Haguenau', 48.82, 7.79], ['Wissembourg', 49.04, 7.94],
  ['Metz', 49.12, 6.18], ['Thionville', 49.36, 6.17],
  // The Belgian border, including the Givet salient.
  ['Givet', 50.14, 4.83], ['Maubeuge', 50.28, 3.97], ['Valenciennes', 50.36, 3.52],
  ['Lille', 50.63, 3.06], ['Bailleul', 50.74, 2.73],
  // Corsica.
  ['Ajaccio', 41.93, 8.74], ['Bastia', 42.7, 9.45], ['Bonifacio', 41.39, 9.16],
  ['Calvi', 42.57, 8.76], ['Corte', 42.31, 9.15], ['Porto-Vecchio', 41.59, 9.28],
  // Interior.
  ['Paris', 48.86, 2.35], ['Lyon', 45.76, 4.84], ['Toulouse', 43.6, 1.44],
  ['Bordeaux', 44.84, -0.58], ['Nantes', 47.22, -1.55], ['Rennes', 48.11, -1.68],
  ['Grenoble', 45.19, 5.72], ['Dijon', 47.32, 5.04],
];

const outside: [string, number, number][] = [
  // Spain — every one of these sat inside FR_BOUNDS.
  ['Barcelona', 41.39, 2.17], ['Girona', 41.98, 2.82], ['Figueres', 42.27, 2.96],
  ['Puigcerdà', 42.43, 1.93], ['Vielha', 42.7, 0.8], ['Jaca', 42.57, -0.55],
  ['Pamplona', 42.81, -1.64], ['San Sebastián', 43.32, -1.98], ['Bilbao', 43.26, -2.94],
  ['Zaragoza', 41.65, -0.89], ['Huesca', 42.13, -0.41], ['Lleida', 41.61, 0.63],
  ['Andorra la Vella', 42.51, 1.52],
  // Switzerland — the Lake Geneva and Jura frontiers.
  ['Geneva', 46.2, 6.14], ['Lausanne', 46.52, 6.63], ['Nyon', 46.38, 6.24],
  ['Vallorbe', 46.71, 6.38], ['Le Locle', 47.06, 6.75], ['Neuchâtel', 46.99, 6.93],
  ['Basel', 47.56, 7.59], ['Lugano', 46.01, 8.96],
  // Germany and Luxembourg.
  ['Freiburg', 47.99, 7.85], ['Karlsruhe', 49.01, 8.4], ['Saarbrücken', 49.24, 6.99],
  ['Trier', 49.76, 6.64], ['Luxembourg', 49.61, 6.13],
  // Belgium.
  ['Arlon', 49.68, 5.81], ['Bastogne', 50.0, 5.72], ['Charleroi', 50.41, 4.44],
  ['Mons', 50.45, 3.95], ['Tournai', 50.61, 3.39], ['Kortrijk', 50.83, 3.26],
  ['Ypres', 50.85, 2.89], ['De Panne', 51.1, 2.59],
  // Italy.
  ['Torino', 45.07, 7.69], ['Cuneo', 44.39, 7.55], ['Aosta', 45.74, 7.32],
  ['Ventimiglia', 43.79, 7.61], ['San Remo', 43.82, 7.78], ['Imperia', 43.89, 8.03],
  ['Sassari', 40.73, 8.56], ['Olbia', 40.92, 9.5],
  // Across water, where a box reaches and a shape does not.
  ['London', 51.51, -0.13], ['Dover', 51.13, 1.31], ['Jersey', 49.21, -2.13],
  ['Guernsey', 49.45, -2.58],
];

describe('inFrance', () => {
  describe('includes', () => {
    for (const [name, lat, lon] of inside)
      it(name, () => expect(inFrance(lat, lon)).toBe(true));
  });

  describe('excludes', () => {
    for (const [name, lat, lon] of outside)
      it(name, () => expect(inFrance(lat, lon)).toBe(false));
  });
});

/** A ~500 m site, the size the app actually draws. */
const site = (lat: number, lon: number) => ({
  minLat: lat - 0.0022, maxLat: lat + 0.0022,
  minLon: lon - 0.003, maxLon: lon + 0.003,
});

describe('rectInFrance', () => {
  it('keeps a site in Paris', () => expect(rectInFrance(site(48.8566, 2.3522))).toBe(true));

  it('keeps a site 25 km from the Spanish border', () =>
    expect(rectInFrance(site(42.7, 2.9))).toBe(true));

  it('rejects a site in Barcelona', () =>
    expect(rectInFrance(site(41.3874, 2.1686))).toBe(false));

  it('rejects a site in Bilbao', () =>
    expect(rectInFrance(site(43.263, -2.935))).toBe(false));

  /* The reason every corner is tested rather than the centre: a rectangle whose
     middle is French can still reach over the frontier, and IGN has no data on
     the far side of it. This one is centred near Céret and reaches into Spain. */
  it('rejects a rectangle whose centre is French but whose corner is Spanish', () => {
    const straddle = { minLat: 42.35, maxLat: 42.52, minLon: 2.7, maxLon: 2.8 };
    expect(inFrance(42.435, 2.75)).toBe(true);
    expect(rectInFrance(straddle)).toBe(false);
  });

  /* Documented limit, asserted so that a future refinement shows up here rather
     than silently changing behaviour: the Bidasoa is too narrow for this shape,
     so Irún reads as French. Harmless — IGN simply returns nothing there. */
  it('cannot separate Irún from Hendaye, and errs towards France', () =>
    expect(inFrance(43.34, -1.79)).toBe(true));
});
