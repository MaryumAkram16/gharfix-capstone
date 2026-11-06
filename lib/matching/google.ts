import type { Logger } from '../log.js';
import { DEFAULT_GOOGLE_PLACES_TIMEOUT_MS } from './config.js';
import { MapsUnavailableError, type NearbySearch, type ProviderDirectory } from './directory.js';
import { haversineKm } from './providers.js';
import type { GooglePlaceFacts, Place } from './types.js';

export { DEFAULT_GOOGLE_PLACES_TIMEOUT_MS };

// Google Places API (New) Text Search: the provider source the original n8n
// workflow used (WF2 "Places Nearby Search1" called the legacy textsearch).
// Enabled only when GOOGLE_MAPS_API_KEY is set (lib/matching/deps.ts).
//   https://developers.google.com/maps/documentation/places/web-service/text-search
//
// One request per requested service, run in parallel, biased to a circle
// around the customer; results outside the radius are dropped. The field
// mask includes rating, userRatingCount, priceLevel and currentOpeningHours
// (what WF2's scoring and pricing used), which Google bills as the
// "Text Search Enterprise" SKU.

export const GOOGLE_PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';


export const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.businessStatus',
  'places.googleMapsUri',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.currentOpeningHours.openNow',
].join(',');

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface GooglePlacesOptions {
  apiKey: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  url?: string;
  log?: Logger;
}

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  businessStatus?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  currentOpeningHours?: { openNow?: boolean };
}

async function searchText(service: string, search: NearbySearch, opts: Required<Pick<GooglePlacesOptions, 'apiKey' | 'timeoutMs' | 'url'>> & { fetch: FetchLike }) {
  let res: Response;
  try {
    res = await opts.fetch(opts.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': opts.apiKey, 'X-Goog-FieldMask': FIELD_MASK },
      body: JSON.stringify({
        textQuery: service,
        locationBias: { circle: { center: { latitude: search.center.lat, longitude: search.center.lng }, radius: search.radiusM } },
        regionCode: 'PK',
        languageCode: 'en',
        pageSize: 20,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    throw new MapsUnavailableError('directory', `google places ${timedOut ? 'timed out' : 'network error'}`, null, timedOut);
  }
  // 400 bad request, 403 key/billing/API not enabled, 429 quota, 5xx outage: all mean "use the next directory".
  if (!res.ok) throw new MapsUnavailableError('directory', `google places answered HTTP ${res.status}`, res.status);
  try {
    const body = (await res.json()) as { places?: GooglePlace[] };
    return Array.isArray(body.places) ? body.places : [];
  } catch {
    throw new MapsUnavailableError('directory', 'google places returned a non-JSON body', res.status);
  }
}

function facts(p: GooglePlace): GooglePlaceFacts {
  return {
    rating: typeof p.rating === 'number' ? p.rating : null,
    reviewCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
    priceLevel: typeof p.priceLevel === 'string' ? p.priceLevel : null,
    businessStatus: typeof p.businessStatus === 'string' ? p.businessStatus : null,
    openNow: typeof p.currentOpeningHours?.openNow === 'boolean' ? p.currentOpeningHours.openNow : null,
    mapsUrl: typeof p.googleMapsUri === 'string' ? p.googleMapsUri : '',
  };
}

export function createGooglePlacesDirectory({ apiKey, fetch: fetchImpl = fetch, timeoutMs = DEFAULT_GOOGLE_PLACES_TIMEOUT_MS, url = GOOGLE_PLACES_URL, log }: GooglePlacesOptions): ProviderDirectory {
  return {
    async searchNearby(search: NearbySearch): Promise<Place[]> {
      const services = search.services.filter((s) => s.trim() !== '');
      if (services.length === 0) return [];
      const results = await Promise.all(services.map((s) => searchText(s, search, { apiKey, timeoutMs, url, fetch: fetchImpl })));

      const byId = new Map<string, Place & { d: number }>();
      results.forEach((places, i) => {
        for (const p of places) {
          const name = p.displayName?.text?.trim();
          const lat = p.location?.latitude;
          const lng = p.location?.longitude;
          if (!p.id || !name || typeof lat !== 'number' || typeof lng !== 'number') continue;
          if (p.businessStatus === 'CLOSED_PERMANENTLY') continue;
          const d = haversineKm(search.center, { lat, lng });
          if (d * 1000 > search.radiusM) continue; // locationBias is a preference, not a limit
          const id = `google:${p.id}`;
          const existing = byId.get(id);
          if (existing) {
            if (!existing.matchedServices.includes(services[i])) existing.matchedServices.push(services[i]);
            continue;
          }
          byId.set(id, {
            id, name, lat, lng, d,
            address: p.formattedAddress ?? '',
            matchedServices: [services[i]],
            sourceUrl: p.googleMapsUri ?? '',
            source: 'google_places',
            google: facts(p),
          });
        }
      });
      const places = [...byId.values()].sort((a, b) => a.d - b.d).slice(0, search.limit);
      log?.info('google.search', { services, results: places.length });
      return places.map(({ d: _d, ...p }) => p);
    },
  };
}
