import { pakistanDate } from '../booking/schedule.js';
import { fail, internalError, ok, validationError, type HttpResult } from '../http/errors.js';
import type { Logger } from '../log.js';
import { MapsUnavailableError, type CapacityReader, type GeocodeResult, type Geocoder, type ProviderDirectory } from './directory.js';
import { pakistanHour, priceServices } from './pricing.js';
import { DEMO_DATA_GAPS, OSM_DATA_GAPS, toProvider } from './providers.js';
import { scoreServices } from './scoring.js';
import type { MatchRequest, ProviderSource } from './types.js';

// khadmat-provider-match (WF2 + inline WF3) without n8n or Google Maps.
//   normalise services -> geocode -> nearby search -> today's capacity
//   -> provider schema -> score -> price
// Response shapes are WF3's. Additive: `data_source` ("openstreetmap" or
// "demo_seed") says where the providers came from; `data_notes` says what
// that source cannot provide.

export interface MatchDeps {
  geocoder: Geocoder;
  directory: ProviderDirectory;
  capacity: CapacityReader;
  now: () => Date;
  log: Logger;
}

export const SEARCH_RADIUS_M = 5000; // Places textsearch radius in WF2
export const MAX_PLACES = 20; // Google textsearch page size
export const MAX_SERVICES = 5;
const MULTI = 'Multi-Service Package';
export const NO_PROVIDERS_TEXT = 'Sorry, no providers found in your area for this service';

export const OSM_NOTE = 'OpenStreetMap lists businesses but has no ratings, reviews, prices or reliability history. Those fields are null, and scores count them as 0.';
export const DEMO_NOTE = 'DEMO DATA: OpenStreetMap had no providers near this location, so these are fictional sample providers from db/seed/demo_providers.json. They are not real businesses.';
export const DEMO_NOTE_UNAVAILABLE = 'DEMO DATA: OpenStreetMap could not be reached (timed out or failed), so these are fictional sample providers from db/seed/demo_providers.json. They are not real businesses.';

// WF2's geocode fallback: known Islamabad sector centres. Its default of
// "anything unknown is central Islamabad" is dropped: it sent Karachi and
// Lahore customers to Islamabad providers.
const AREA_FALLBACK: Record<string, { lat: number; lng: number }> = {
  'g-13': { lat: 33.6557, lng: 73.0138 },
  'g-14': { lat: 33.649, lng: 73.005 },
  'g-11': { lat: 33.6844, lng: 73.0066 },
  'f-10': { lat: 33.7076, lng: 73.0287 },
  'f-11': { lat: 33.7183, lng: 73.0234 },
  'i-8': { lat: 33.6715, lng: 73.0752 },
  'i-9': { lat: 33.6644, lng: 73.0848 },
  'e-11': { lat: 33.7386, lng: 73.0124 },
  islamabad: { lat: 33.6844, lng: 73.0479 },
};

export function areaFallback(location: string): GeocodeResult | null {
  const key = location.toLowerCase().replace(/\s+/g, '-');
  const matched = Object.keys(AREA_FALLBACK).find((k) => key.includes(k));
  return matched ? { ...AREA_FALLBACK[matched], formatted_address: `${location} (approximate: ${matched})`, source: 'area_name_fallback' } : null;
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** WF2 "Multi-Service Handler": real service names only, never the "Multi-Service Package" label. */
export function normaliseServices(intent: Record<string, unknown>): string[] {
  const raw = Array.isArray(intent.services) ? intent.services : [intent.primary_service ?? intent.service_type];
  const services = [...new Set(raw.map(str).filter((s): s is string => s !== null && s !== MULTI && s.length <= 80))];
  const primary = str(intent.primary_service);
  if (services.length === 0 && primary && primary !== MULTI) services.push(primary);
  return services.slice(0, MAX_SERVICES);
}

export async function handleProviderMatch(body: unknown, deps: MatchDeps): Promise<HttpResult<unknown>> {
  const outer = record(body);
  // The intent workflow sent { output: {...} } at times; WF2 read `body.output || body`.
  const intent = Object.keys(record(outer.output)).length ? record(outer.output) : outer;
  const services = normaliseServices(intent);
  const location = str(intent.location);

  if (services.length === 0) {
    // What n8n's pricing node answered when scoring found no valid services.
    return ok({
      status: 'error',
      message: 'No services found in match result',
      received: { status: 'invalid_intent', message: 'No valid services found in request', received_intent: intent, workflow: 'WF2-ProviderMatching' },
    });
  }
  if (!location) return validationError('Missing fields: location', ['location']);

  const request: MatchRequest = {
    services,
    service_type: str(intent.service_type),
    primary_service: str(intent.primary_service),
    is_multi_service: intent.is_multi_service === true || services.length > 1,
    location,
    job_complexity: str(intent.job_complexity),
    budget_sensitivity: str(intent.budget_sensitivity),
  };
  const log = deps.log.child({ services, location });

  try {
    const now = deps.now();
    const geocoded = (await deps.geocoder.geocode(location)) ?? areaFallback(location);
    if (!geocoded) {
      log.info('match.location_not_found');
      return ok({ status: 'location_not_found', message: `Could not find "${location}" on the map. Please add the area and city.`, location, workflow: 'WF2-ProviderMatching' });
    }
    const center = { lat: geocoded.lat, lng: geocoded.lng };

    const places = await deps.directory.searchNearby({ services, center, radiusM: SEARCH_RADIUS_M, limit: MAX_PLACES });
    if (places.length === 0) {
      log.info('match.no_places', { geocoder: geocoded.source });
      return { status: 200, body: NO_PROVIDERS_TEXT };
    }

    let activeBookings = new Map<string, number>();
    let capacityChecked = true;
    try {
      activeBookings = await deps.capacity.activeBookingCounts(pakistanDate(now), places.map((p) => p.id));
    } catch (err) {
      // Matching still helps without today's counts; the booking flow checks real slots anyway.
      capacityChecked = false;
      log.warn('match.capacity_unavailable', { error: err });
    }

    const providers = places.map((place) => toProvider(place, { request, center, activeBookings }));
    const matches = scoreServices(services, providers, request, now);
    const priced = priceServices(matches, { job_complexity: request.job_complexity, location }, pakistanHour(now));

    // A search returns one source only: demo places appear only when OpenStreetMap returned none.
    const source: ProviderSource = places.some((p) => p.source === 'demo_seed') ? 'demo_seed' : 'openstreetmap';
    const demoReason = source === 'demo_seed' ? (places[0].demoReason ?? 'osm_empty') : undefined;
    log.info('match.done', { places: places.length, data_source: source, geocoder: geocoded.source, capacity_checked: capacityChecked });
    return ok({
      ...priced,
      data_source: source,
      data_notes: {
        geocoder: geocoded.source,
        distance: 'straight_line',
        capacity_checked: capacityChecked,
        not_available: source === 'demo_seed' ? [...DEMO_DATA_GAPS] : [...OSM_DATA_GAPS],
        note: source === 'demo_seed' ? (demoReason === 'osm_unavailable' ? DEMO_NOTE_UNAVAILABLE : DEMO_NOTE) : OSM_NOTE,
        ...(demoReason ? { demo_reason: demoReason } : {}),
      },
    });
  } catch (err) {
    if (err instanceof MapsUnavailableError) {
      log.error('match.maps_unavailable', { service: err.service, http_status: err.httpStatus, error: err });
      return fail('service_unavailable', 'Provider search is temporarily unavailable. Please try again in a minute.', { retryable: true });
    }
    log.error('match.unhandled_error', { error: err });
    return internalError();
  }
}
