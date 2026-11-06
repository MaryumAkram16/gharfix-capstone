import type { Logger } from '../log.js';
import type { GeoPoint, Place } from './types.js';

// The swappable boundary that replaced the Google Maps APIs. lib/matching/osm.ts
// implements it with OpenStreetMap (Nominatim + Overpass); a Supabase
// providers table or a paid API can implement it later without touching
// the matcher.

export interface GeocodeResult extends GeoPoint {
  formatted_address: string;
  source: string;
}

export interface Geocoder {
  /** null when the place is not found; throws MapsUnavailableError when the service cannot answer. */
  geocode(query: string): Promise<GeocodeResult | null>;
}

export interface NearbySearch {
  services: string[];
  center: GeoPoint;
  radiusM: number;
  limit: number;
}

export interface ProviderDirectory {
  /** Named businesses near `center` that match at least one requested service, nearest first. */
  searchNearby(search: NearbySearch): Promise<Place[]>;
}

export type { CapacityReader } from '../booking/repository.js';

/** The map/directory service did not answer (network, timeout, 429, 5xx). Worth retrying later. */
export class MapsUnavailableError extends Error {
  readonly name = 'MapsUnavailableError';
  constructor(readonly service: 'geocoder' | 'directory', message: string, readonly httpStatus: number | null = null, readonly timedOut = false) {
    super(message);
  }
}

/**
 * Ask `primary`; if it throws, ask `secondary` instead. Zero results from
 * `primary` are an answer and are returned as they are. Wrap `primary` with
 * lib/resilience first, so its failure is recorded before it is covered here.
 */
export function withDirectoryFallback(primary: ProviderDirectory, secondary: ProviderDirectory, log?: Logger): ProviderDirectory {
  return {
    async searchNearby(search) {
      try {
        return await primary.searchNearby(search);
      } catch (err) {
        log?.warn('match.directory_fallback_used', { services: search.services, error: err });
        return secondary.searchNearby(search);
      }
    },
  };
}
