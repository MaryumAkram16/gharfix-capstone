import { describe, expect, it } from 'vitest';
import { handleProviderMatch, normaliseServices, type MatchDeps } from '../../lib/matching/handler';
import { complexityFor, toProvider } from '../../lib/matching/providers';
import type { MatchRequest, Place } from '../../lib/matching/types';
import { memoryLogger } from '../../lib/log';

// Production logs, 2026-11-06: Gemini returned services ["Plumber"]. The
// complexity table is keyed "plumber", "electrician", "AC installation"...,
// so a capitalised name fell through to "basic".

describe('complexityFor', () => {
  it.each([
    ['electrician', 'intermediate'], ['Electrician', 'intermediate'], [' ELECTRICIAN ', 'intermediate'],
    ['AC installation', 'complex'], ['ac installation', 'complex'], ['AC Installation', 'complex'],
    ['AC Repair', 'intermediate'], ['Generator Mechanic', 'intermediate'], ['Plumber', 'basic'],
    ['kite flying', 'basic'], ['', 'basic'], [null, 'basic'], [undefined, 'basic'],
  ])('%j -> %s', (name, tier) => {
    expect(complexityFor(name)).toBe(tier);
  });

  it('toProvider gives a capitalised request the same complexity levels as the lowercase one', () => {
    const place: Place = { id: 'osm:node/1', name: 'X', lat: 33.657, lng: 73.015, address: '', matchedServices: ['Electrician'], sourceUrl: '', source: 'openstreetmap' };
    const ctx = (service_type: string) => ({ request: { services: [service_type], service_type, location: 'G-13', job_complexity: 'intermediate' } as MatchRequest, center: { lat: 33.6557, lng: 73.0138 }, activeBookings: new Map() });
    expect(toProvider(place, ctx('Electrician')).complexity_levels).toEqual(['basic', 'intermediate']);
    expect(toProvider(place, ctx('Electrician')).complexity_levels).toEqual(toProvider(place, ctx('electrician')).complexity_levels);
  });
});

describe('normaliseServices', () => {
  it('treats spellings that differ only in case as one service, keeping the first', () => {
    expect(normaliseServices({ services: ['Plumber', 'plumber', 'PLUMBER', 'Electrician'] })).toEqual(['Plumber', 'Electrician']);
  });
});

describe('khadmat-provider-match: capitalised service from Gemini', () => {
  const run = async (service: string) => {
    const deps: MatchDeps = {
      geocoder: { geocode: async () => ({ lat: 33.6557, lng: 73.0138, formatted_address: 'G-13, Islamabad', source: 'openstreetmap_nominatim' }) },
      directory: { searchNearby: async ({ services }) => [{ id: 'osm:node/1', name: 'Sparks Electric', lat: 33.657, lng: 73.015, address: '', matchedServices: services, sourceUrl: '', source: 'openstreetmap' }] },
      capacity: { activeBookingCounts: async () => new Map() },
      now: () => new Date('2026-11-04T09:00:00Z'),
      log: memoryLogger(),
    };
    const res = await handleProviderMatch({ services: [service], service_type: service, location: 'G-13, Islamabad', job_complexity: 'intermediate', budget_sensitivity: 'medium' }, deps);
    return res.body as any;
  };

  it('"Electrician" is scored and priced exactly like "electrician"', async () => {
    const upper = await run('Electrician');
    const lower = await run('electrician');
    const strip = (b: any) => JSON.parse(JSON.stringify(b).replace(/Electrician/g, 'electrician'));
    expect(upper.services[0].provider.complexity_levels).toEqual(['basic', 'intermediate']);
    expect(strip(upper)).toEqual(lower);
  });
});
