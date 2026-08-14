import { DEFAULT_TUNABLES } from '@/lib/build/tunables';
import type { BuildOptions } from '@/lib/types';

/**
 * What a session starts with, and the shape a stored BuildOptions is read
 * against.
 *
 * It lived inside components/ifc-site until the draft loader needed it: sanitising
 * a saved form means walking the keys of the default — the same trick
 * sanitizeTunables plays, and for the same reason — and lib/io/draft cannot import
 * a 'use client' component to get at them. Sitting here it is importable from
 * either side, and there is still exactly one copy of these values.
 */
export const DEFAULT_FORM: BuildOptions = {
  epsg: '2154',
  defaultHeight: 9,
  provider: 'ign',
  buildings: true,
  roads: true,
  railways: false,
  terrain: false,
  terrainAccuracy: 'standard',
  trees: false,
  veg: false,
  water: false,
  parcels: false,
  tune: { ...DEFAULT_TUNABLES },
};
