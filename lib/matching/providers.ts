import type { Complexity, GeoPoint, MatchRequest, Place, Provider } from './types.js';

// Port of WF2 "Map Places → Provider Schema", with OpenStreetMap places
// instead of Google Places.
//
// The n8n node filled every gap with invented numbers: rating 4.0, 10
// reviews, "last reviewed today", and on-time and cancellation rates
// derived from that fake rating. OSM has none of these, and they are not
// made up here: they are null and listed in data_gaps.
//
// Kept from n8n because they are GharFix policy, not provider facts:
// - complexity levels per service type (same table)
// - the daily capacity limit (4) and the default booking windows
// - the default base rate, PKR 900 (what n8n used when Google had no
//   price_level), marked base_rate_source: "gharfix_default"

export const MAX_DAILY_BOOKINGS = 4;
export const DEFAULT_BASE_RATE_PKR = 900;

const COMPLEXITY_KEYWORDS: Record<string, Complexity> = {
  'AC installation': 'complex',
  'AC repair': 'intermediate',
  'AC gas refill': 'basic',
  plumber: 'basic',
  electrician: 'intermediate',
  carpenter: 'intermediate',
  painter: 'basic',
  tutor: 'basic',
  beautician: 'basic',
  'generator mechanic': 'intermediate',
};

const COMPLEXITY_LEVELS: Record<Complexity, Complexity[]> = {
  basic: ['basic'],
  intermediate: ['basic', 'intermediate'],
  complex: ['basic', 'intermediate', 'complex'],
};

/** Every field OSM cannot supply, so every provider from it carries this list. */
export const OSM_DATA_GAPS = [
  'rating',
  'review_count',
  'last_review_date',
  'on_time_score',
  'cancellation_rate',
  'reputation_score',
  'price (base_rate_pkr is the GharFix default)',
  'opening hours (not evaluated)',
  'business status (verified is false)',
  'road distance (distance_km is straight-line)',
  'photos',
] as const;

/** Demo providers lack the same fields, and are not real businesses at all. */
export const DEMO_DATA_GAPS = ['not a real business (demo data from db/seed/demo_providers.json)', ...OSM_DATA_GAPS] as const;

/** Great-circle distance in km. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface ProviderContext {
  request: MatchRequest;
  center: GeoPoint;
  activeBookings: Map<string, number>;
}

export function toProvider(place: Place, { request, center, activeBookings }: ProviderContext): Provider {
  const isDemo = place.source === 'demo_seed';
  const distanceKm = parseFloat(haversineKm(center, { lat: place.lat, lng: place.lng }).toFixed(1));

  // Real active bookings today from Supabase, as in n8n.
  const active = activeBookings.get(place.id) || 0;
  const isAtCapacity = active >= MAX_DAILY_BOOKINGS;
  // n8n gave open places four windows and others two. OSM opening_hours are
  // not evaluated, so "open now" is unknown and treated as not open, exactly
  // as n8n did when Google had no opening_hours.
  const availabilitySlots = isAtCapacity ? [] : ['09:00', '11:00'];

  const base = COMPLEXITY_KEYWORDS[request.service_type ?? ''] || 'basic';

  return {
    id: place.id,
    name: place.name,
    owner: place.name,
    // n8n tagged every place with all requested services. Here a place only
    // lists the services it actually matched in OSM (tag or name).
    services: place.matchedServices,
    complexity_levels: COMPLEXITY_LEVELS[base],
    areas: [request.location],
    coordinates: { lat: place.lat, lng: place.lng },
    address: place.address,
    base_rate_pkr: DEFAULT_BASE_RATE_PKR,
    base_rate_source: 'gharfix_default',
    rating: null,
    review_count: null,
    last_review_date: null,
    on_time_score: null,
    cancellation_rate: null,
    availability_slots: availabilitySlots,
    active_bookings: active,
    max_daily_bookings: MAX_DAILY_BOOKINGS,
    at_capacity: isAtCapacity,
    distance_km: distanceKm,
    distance_type: 'straight_line',
    verified: false,
    reputation_score: null,
    // A demo provider's coordinates are only near a real area centre: no map link that would point at a real address.
    google_maps_url: isDemo ? '' : `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`,
    osm_url: isDemo ? '' : place.sourceUrl,
    place_id: place.id,
    photos: [],
    source: place.source,
    data_gaps: isDemo ? [...DEMO_DATA_GAPS] : [...OSM_DATA_GAPS],
  };
}
