import { describe, expect, it } from 'vitest';
import { DEFAULT_BASE_RATE_PKR, haversineKm, OSM_DATA_GAPS, toProvider } from '../../lib/matching/providers';
import type { MatchRequest, Place } from '../../lib/matching/types';

const request: MatchRequest = {
  services: ['plumber'], service_type: 'plumber', primary_service: 'plumber', is_multi_service: false,
  location: 'G-13, Islamabad', job_complexity: 'basic', budget_sensitivity: 'medium',
};
const center = { lat: 33.6557, lng: 73.0138 };
const place: Place = {
  id: 'osm:node/111', name: 'Ali Plumbing Works', lat: 33.6600, lng: 73.0200,
  address: 'Street 5, G-13/1', matchedServices: ['plumber'], sourceUrl: 'https://www.openstreetmap.org/node/111',
};

describe('haversineKm', () => {
  it('matches known distances', () => {
    expect(haversineKm(center, center)).toBe(0);
    // Islamabad G-13 to Lahore (Minar-e-Pakistan) is about 270 km in a straight line.
    expect(haversineKm(center, { lat: 31.5925, lng: 74.3095 })).toBeGreaterThan(255);
    expect(haversineKm(center, { lat: 31.5925, lng: 74.3095 })).toBeLessThan(275);
  });
});

describe('toProvider', () => {
  it('keeps real OSM facts and leaves everything else null instead of inventing it', () => {
    const p = toProvider(place, { request, center, activeBookings: new Map() });
    expect(p).toMatchObject({
      id: 'osm:node/111', place_id: 'osm:node/111', name: 'Ali Plumbing Works', owner: 'Ali Plumbing Works',
      services: ['plumber'], complexity_levels: ['basic'], areas: ['G-13, Islamabad'],
      coordinates: { lat: 33.66, lng: 73.02 }, address: 'Street 5, G-13/1',
      distance_km: 0.7, distance_type: 'straight_line',
      rating: null, review_count: null, last_review_date: null, on_time_score: null, cancellation_rate: null, reputation_score: null,
      verified: false, photos: [], source: 'openstreetmap',
      base_rate_pkr: DEFAULT_BASE_RATE_PKR, base_rate_source: 'gharfix_default',
      availability_slots: ['09:00', '11:00'], active_bookings: 0, max_daily_bookings: 4, at_capacity: false,
      osm_url: 'https://www.openstreetmap.org/node/111',
      google_maps_url: 'https://www.google.com/maps/search/?api=1&query=33.66,73.02',
    });
    expect(p.data_gaps).toEqual([...OSM_DATA_GAPS]);
    expect(p.data_gaps).toEqual(expect.arrayContaining(['rating', 'review_count']));
  });

  it('uses real booking counts: a provider at capacity gets no slots', () => {
    const p = toProvider(place, { request, center, activeBookings: new Map([['osm:node/111', 4]]) });
    expect(p).toMatchObject({ active_bookings: 4, at_capacity: true, availability_slots: [] });
  });

  it('keeps the n8n complexity table, keyed on service_type', () => {
    expect(toProvider(place, { request: { ...request, service_type: 'AC installation' }, center, activeBookings: new Map() }).complexity_levels)
      .toEqual(['basic', 'intermediate', 'complex']);
    expect(toProvider(place, { request: { ...request, service_type: 'Multi-Service Package' }, center, activeBookings: new Map() }).complexity_levels)
      .toEqual(['basic']);
  });

  it('lists only the services the place actually matched', () => {
    const p = toProvider({ ...place, matchedServices: ['electrician'] }, { request: { ...request, services: ['plumber', 'electrician'] }, center, activeBookings: new Map() });
    expect(p.services).toEqual(['electrician']);
  });
});
