import type { Provider, SurfaceLayer } from '@/lib/types';

/* =====================================================================
   Data-source licences — what the export has to carry, and what the page
   has to show.

   Both of this app's providers licence their data on condition that the credit
   travels with it. OSM's ODbL asks for "OpenStreetMap", a statement that the
   data is ODbL, and the copyright link; the OSMF guidelines are explicit that in
   a medium nobody browses — a downloaded file — that notice belongs "within the
   data or metadata", which is what ePset_License is for. IGN's Licence Ouverte
   2.0 asks for the source name AND the date of the last update of the
   information reused, which is why SiteMeta carries a fetch date at all.

   This is one table with two consumers, the IFC writer and the About panel, for
   the same reason VERTICAL_DATUMS in lib/geo/vertical is one table: the file and
   the screen must not be able to disagree about whose data this is.

   Nothing here is translated. These are dataset names, licence names and URLs —
   proper nouns, like PROVIDER_NAME in components/status-line — and an exported
   file's legal notice must not change with the page's language.

   The attribution lines use plain hyphens rather than the em dashes the rest of
   this codebase writes. They are the one string here that ends up in the STEP
   header, where every non-ASCII character is spelled \X24\X0\ — and a
   notice you cannot read without decoding it is not doing its job. The © and
   the ® stay: those carry meaning a hyphen does not, and in the property panel
   that is the real audience they decode correctly.
   ===================================================================== */

/** One licensed dataset. Not the same axis as Provider: a single build mixes
 *  them, since trees come from OSM even on the IGN path. */
export type DataSource = 'osm' | 'bdtopo' | 'rgealti' | 'pci' | 'terrarium';

export type SourceLicence = {
  /** The dataset, named as the file should credit it. */
  source: string;
  /** Licence short name and version. */
  licence: string;
  /** Where the licence text lives. */
  url: string;
  /** The notice the licence asks to be carried, verbatim. */
  attribution: string;
};

export const DATA_SOURCES: Record<DataSource, SourceLicence> = {
  osm: {
    source: 'OpenStreetMap',
    licence: 'ODbL 1.0',
    url: 'https://www.openstreetmap.org/copyright',
    attribution:
      '© OpenStreetMap contributors. Data available under the Open Database License (ODbL) 1.0.',
  },
  bdtopo: {
    source: 'IGN BD TOPO®',
    licence: 'Licence Ouverte / Open Licence 2.0 (Etalab)',
    url: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
    attribution: '© IGN - BD TOPO® - Licence Ouverte / Open Licence 2.0 (Etalab).',
  },
  rgealti: {
    source: 'IGN RGE ALTI®',
    licence: 'Licence Ouverte / Open Licence 2.0 (Etalab)',
    url: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
    attribution: '© IGN - RGE ALTI® - Licence Ouverte / Open Licence 2.0 (Etalab).',
  },
  pci: {
    // PARCELLAIRE EXPRESS is IGN's edition of the DGFiP cadastre, so both are
    // named: the Licence Ouverte asks for the source, and one half of it would
    // be an incomplete answer.
    source: 'IGN PARCELLAIRE EXPRESS',
    licence: 'Licence Ouverte / Open Licence 2.0 (Etalab)',
    url: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
    attribution:
      '© IGN / DGFiP - PARCELLAIRE EXPRESS - Licence Ouverte / Open Licence 2.0 (Etalab).',
  },
  terrarium: {
    // A mosaic of national models, so no one string is right everywhere: the
    // USGS sources dominate at global coverage, and the rest are enumerated
    // with the dataset rather than guessed at from a bounding box we would then
    // have to keep in step with whatever the tile server is serving that month.
    //
    // The registry page, deliberately, and not the credit table AWS's own
    // registry entry names in its License field —
    // github.com/tilezen/joerd/blob/master/docs/attribution.md. That document is
    // where the terms actually are, but it is a branch path in a repo last
    // touched in 2021, and this URL is embedded in files that outlive the app:
    // a rename or a repo move would leave a dead link in a legal notice. The
    // registry page is run by whoever is actually serving the tiles, and it
    // links onward to the same table. Do not "fix" this back.
    source: 'AWS Terrain Tiles (Terrarium)',
    licence: 'Public domain and open sources, per region',
    url: 'https://registry.opendata.aws/terrain-tiles/',
    attribution:
      'Elevation from AWS Terrain Tiles. SRTM and GMTED2010 data courtesy of the U.S. Geological Survey; other regions carry their own credits, listed with the dataset.',
  },
};

/**
 * What kind of thing is being credited.
 *
 * `vector` is the buildings/roads/railways group, which is the one that follows
 * the provider. Trees are their own kind precisely because they do not.
 */
export type SourceKind = 'terrain' | 'vector' | 'trees' | SurfaceLayer;

/**
 * Whose data a given element is, in one place rather than at each emit site.
 *
 * Trees are always OSM: BD TOPO stops at vegetation polygons, so lib/build/run
 * calls osmTrees under both providers. That is the whole reason this has to be
 * resolved per element and not once per file — an IGN export routinely carries
 * BD TOPO buildings and ODbL trees in the same model.
 *
 * The theme layers only ever exist on the IGN path (see the `themes` list in
 * lib/build/run), so they need no provider test: vegetation, hedges and water
 * are BD TOPO, and parcels are the cadastre.
 */
export function sourceOf(kind: SourceKind, provider: Provider): DataSource {
  const ign = provider === 'ign';
  switch (kind) {
    case 'terrain':
      return ign ? 'rgealti' : 'terrarium';
    case 'vector':
    // Only a hand-drawn road area is a Surface in this tier, and those are never
    // credited (see emitIFC) — but if one ever were, roads follow the provider.
    case 'roads':
      return ign ? 'bdtopo' : 'osm';
    case 'trees':
      return 'osm';
    case 'parcel':
      return 'pci';
    default:
      return 'bdtopo';
  }
}
