import { AppError } from '@/lib/errors';

export type Place = {
  display_name: string;
  lat: string;
  lon: string;
  /** [minLat, maxLat, minLon, maxLon] as strings, when Nominatim supplies one. */
  boundingbox?: [string, string, string, string];
};

/**
 * Place search is a convenience: drawing by hand must keep working regardless,
 * so the caller is expected to report a failure and carry on rather than abort.
 * Nominatim asks for restraint, hence the debounce on the calling side.
 */
export async function searchPlaces(q: string): Promise<Place[]> {
  const url =
    'https://nominatim.openstreetmap.org/search?format=json&limit=5&q=' + encodeURIComponent(q);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new AppError('err.nominatimStatus', { status: res.status });
  return (await res.json()) as Place[];
}
