import type { Provider } from '@/lib/types';

/**
 * The vertical datum, per elevation source.
 *
 * It belongs to whatever produced the heights, not to the horizontal grid — a
 * projected CRS is two-dimensional and EPSG publishes none for it — so this is
 * keyed on the provider rather than on where the site is. That is why a Spanish
 * site reports EGM96 and not Alicante height: Terrarium's numbers really are
 * EGM96-referenced, and relabelling them would be wrong by about half a metre
 * without a geoid model to shift them with.
 *
 * NGF-IGN69 is what IGN RGE ALTI publishes. EGM96 is the datum of Terrarium's
 * dominant source; those tiles are a mosaic, so read it as good to about a metre.
 *
 * The code is what the IFC header cites — see ContextModel in lib/ifc/writer,
 * where it sits in VerticalDatum beside the horizontal EPSG:nnnn in Name. The
 * name is for the UI, which has room for prose.
 */
export const VERTICAL_DATUMS: Record<Provider, { name: string; epsg: string }> = {
  ign: { name: 'NGF-IGN69', epsg: 'EPSG:5720' },
  osm: { name: 'EGM96', epsg: 'EPSG:5773' },
};

/** The code for a datum name. Only a draft reader needs this: drafts written
 *  before the code was stored carry the name alone, and an old one should still
 *  export a header that cites the registry. */
export const verticalEpsgFor = (name: string | null): string | null =>
  Object.values(VERTICAL_DATUMS).find((d) => d.name === name)?.epsg ?? null;
