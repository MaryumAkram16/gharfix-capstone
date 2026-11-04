import { beforeEach, describe, expect, it } from 'vitest';
import { RepositoryError } from '../../lib/booking/repository';
import { MapsUnavailableError, type GeocodeResult, type NearbySearch } from '../../lib/matching/directory';
import { areaFallback, handleProviderMatch, NO_PROVIDERS_TEXT, normaliseServices, type MatchDeps } from '../../lib/matching/handler';
import type { Place } from '../../lib/matching/types';
import { memoryLogger } from '../../lib/log';

// 2026-11-04 14:00 in Karachi: not a surge hour.
const AFTERNOON = new Date('2026-11-04T09:00:00Z');
const G13: GeocodeResult = { lat: 33.6557, lng: 73.0138, formatted_address: 'G-13, Islamabad, Pakistan', source: 'openstreetmap_nominatim' };

const place = (id: string, lat: number, lng: number, matchedServices: string[]): Place => ({
  id, name: `Provider ${id}`, lat, lng, address: '', matchedServices, sourceUrl: `https://www.openstreetmap.org/${id.slice(4)}`, source: 'openstreetmap',
});

let deps: MatchDeps & { log: ReturnType<typeof memoryLogger>; searches: NearbySearch[]; geocoded: string[]; capacityCalls: Array<[string, string[]]> };
let geoResult: GeocodeResult | null | Error;
let places: Place[] | Error;
let counts: Map<string, number> | Error;

beforeEach(() => {
  geoResult = G13;
  places = [
    place('osm:node/1', 33.657, 73.015, ['plumber']), // ~0.2 km
    place('osm:node/2', 33.68, 73.03, ['plumber', 'electrician']), // ~3 km
    place('osm:way/3', 33.66, 73.02, ['electrician']), // ~0.8 km
  ];
  counts = new Map();
  const searches: NearbySearch[] = [];
  const geocoded: string[] = [];
  const capacityCalls: Array<[string, string[]]> = [];
  deps = {
    searches, geocoded, capacityCalls,
    geocoder: { geocode: async (q) => { geocoded.push(q); if (geoResult instanceof Error) throw geoResult; return geoResult; } },
    directory: { searchNearby: async (s) => { searches.push(s); if (places instanceof Error) throw places; return places; } },
    capacity: { activeBookingCounts: async (d, ids) => { capacityCalls.push([d, ids]); if (counts instanceof Error) throw counts; return counts; } },
    now: () => AFTERNOON,
    log: memoryLogger(),
  };
});

const single = { services: ['plumber'], primary_service: 'plumber', service_type: 'plumber', location: 'G-13, Islamabad', job_complexity: 'basic', budget_sensitivity: 'medium' };

describe('khadmat-provider-match: success', () => {
  it('returns the WF3 shape with real OSM facts, nulls for what OSM lacks, and the data source', async () => {
    const res = await handleProviderMatch(single, deps);
    expect(res.status).toBe(200);
    const body = res.body as any;

    expect(body).toMatchObject({ status: 'success', workflow: 'WF3-Pricing', is_multi_service: false });
    expect(body.summary).toEqual({ total_services: 1, subtotal_pkr: body.services[0].pricing.total_pkr, multi_service_discount_pkr: 0, grand_total_pkr: body.services[0].pricing.total_pkr, location: 'G-13, Islamabad', job_complexity: 'basic' });

    const top = body.services[0].provider;
    expect(top).toMatchObject({ id: 'osm:node/1', rating: null, review_count: null, on_time_score: null, verified: false, distance_km: 0.2, source: 'openstreetmap' });
    expect(top.score_breakdown).toMatchObject({ review: null, reliability: null, cancellation: null });
    expect(body.services[0].pricing).toEqual({
      total_pkr: 910,
      breakdown: { base_rate: 900, complexity_extra: 0, surge_extra: 0, distance_extra: 10 },
      display: 'plumber: PKR 910 (Base: 900 + Complexity: 0 + Surge: 0 + Distance: 10)',
    });

    expect(body.data_source).toBe('openstreetmap');
    expect(body.data_notes).toMatchObject({ geocoder: 'openstreetmap_nominatim', distance: 'straight_line', capacity_checked: true });
    expect(body.data_notes.not_available).toEqual(expect.arrayContaining(['rating', 'review_count']));
    expect(body.data_notes.note).toMatch(/no ratings, reviews/);

    expect(deps.searches).toEqual([{ services: ['plumber'], center: { lat: 33.6557, lng: 73.0138 }, radiusM: 5000, limit: 20 }]);
    expect(deps.capacityCalls).toEqual([['2026-11-04', ['osm:node/1', 'osm:node/2', 'osm:way/3']]]);
  });

  it('a provider already at 4 bookings today drops in the ranking (real capacity)', async () => {
    counts = new Map([['osm:node/1', 4]]);
    const body = (await handleProviderMatch(single, deps)).body as any;
    expect(body.services[0].provider.id).toBe('osm:node/2');
    const full = body.services[0].alternatives.find((p: any) => p.id === 'osm:node/1');
    expect(full).toMatchObject({ at_capacity: true, availability_slots: [], score_breakdown: { availability: 0 } });
  });

  it('prices each service, applies the 10% multi-service discount, and scores only services a place offers', async () => {
    const body = (await handleProviderMatch({
      services: ['plumber', 'electrician'], primary_service: 'plumber', service_type: 'Multi-Service Package', is_multi_service: true,
      location: 'G-13, Islamabad', job_complexity: 'basic', budget_sensitivity: 'medium',
    }, deps)).body as any;

    expect(body.is_multi_service).toBe(true);
    expect(body.services.map((s: any) => [s.service, s.provider.id])).toEqual([['plumber', 'osm:node/1'], ['electrician', 'osm:way/3']]);
    const electricianTop = body.services[1].provider;
    expect(electricianTop.service_match).toBe(true);
    const plumberOnlyInElectricianList = [body.services[1].provider, ...body.services[1].alternatives].find((p: any) => p.id === 'osm:node/1');
    expect(plumberOnlyInElectricianList).toMatchObject({ service_match: false, score_breakdown: { specialization: 20 } });
    expect(body.summary.multi_service_discount_pkr).toBe(Math.round(body.summary.subtotal_pkr * 0.1));
  });

  it('applies surge pricing in Pakistan rush hours (09:30 PKT = 04:30 UTC)', async () => {
    deps.now = () => new Date('2026-11-04T04:30:00Z');
    const body = (await handleProviderMatch(single, deps)).body as any;
    expect(body.services[0].pricing.breakdown.surge_extra).toBe(180);
  });

  it('accepts the intent nested under `output`', async () => {
    const res = await handleProviderMatch({ output: single }, deps);
    expect((res.body as any).status).toBe('success');
  });
});

describe('khadmat-provider-match: no match paths', () => {
  it('answers like n8n when no services are valid', async () => {
    const res = await handleProviderMatch({ service_type: 'Multi-Service Package', location: 'G-13' }, deps);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'error', message: 'No services found in match result', received: { status: 'invalid_intent' } });
    expect(deps.geocoded).toEqual([]);
  });

  it('400 without a location', async () => {
    const res = await handleProviderMatch({ services: ['plumber'] }, deps);
    expect(res).toEqual({ status: 400, body: { status: 'validation_error', message: 'Missing fields: location', fields: ['location'] } });
  });

  it('uses the n8n sector table when the geocoder finds nothing, but never defaults to Islamabad', async () => {
    geoResult = null;
    const res = await handleProviderMatch(single, deps);
    expect((res.body as any).data_notes.geocoder).toBe('area_name_fallback');
    expect(deps.searches[0].center).toEqual({ lat: 33.6557, lng: 73.0138 });

    const karachi = await handleProviderMatch({ ...single, location: 'Clifton, Karachi' }, deps);
    expect(karachi.body).toEqual({
      status: 'location_not_found', message: 'Could not find "Clifton, Karachi" on the map. Please add the area and city.',
      location: 'Clifton, Karachi', workflow: 'WF2-ProviderMatching',
    });
    expect(deps.searches).toHaveLength(1);
  });

  it('returns n8n\'s text when nothing is found nearby', async () => {
    places = [];
    expect(await handleProviderMatch(single, deps)).toEqual({ status: 200, body: NO_PROVIDERS_TEXT });
  });
});

describe('khadmat-provider-match: failures', () => {
  it.each([
    ['geocoder', () => { geoResult = new MapsUnavailableError('geocoder', 'geocoder answered HTTP 429', 429); }],
    ['directory', () => { places = new MapsUnavailableError('directory', 'directory timed out'); }],
  ])('503 when the %s is down', async (service, breakIt) => {
    breakIt();
    const res = await handleProviderMatch(single, deps);
    expect(res).toEqual({
      status: 503,
      body: { retryable: true, status: 'service_unavailable', message: 'Provider search is temporarily unavailable. Please try again in a minute.' },
    });
    expect(deps.log.records.find((r) => r.event === 'match.maps_unavailable')).toMatchObject({ service });
  });

  it('still matches when Supabase capacity is down, and says capacity was not checked', async () => {
    counts = new RepositoryError('unavailable', 'Supabase GET network error');
    const res = await handleProviderMatch(single, deps);
    expect(res.status).toBe(200);
    expect((res.body as any).data_notes.capacity_checked).toBe(false);
    expect(deps.log.records.map((r) => r.event)).toContain('match.capacity_unavailable');
  });

  it('500 on an unexpected error', async () => {
    places = new Error('boom');
    expect((await handleProviderMatch(single, deps)).status).toBe(500);
  });
});

describe('normaliseServices / areaFallback', () => {
  it('drops the multi-service label, blanks and duplicates, and caps the list', () => {
    expect(normaliseServices({ services: ['plumber', 'Multi-Service Package', ' ', 'plumber', 'electrician'] })).toEqual(['plumber', 'electrician']);
    expect(normaliseServices({ service_type: 'Multi-Service Package', primary_service: 'AC repair' })).toEqual(['AC repair']);
    expect(normaliseServices({ services: ['a', 'b', 'c', 'd', 'e', 'f'] })).toHaveLength(5);
  });

  it('matches known sectors only', () => {
    expect(areaFallback('G 13 Islamabad')).toMatchObject({ lat: 33.6557, source: 'area_name_fallback' });
    expect(areaFallback('Johar Town, Lahore')).toBeNull();
  });
});
