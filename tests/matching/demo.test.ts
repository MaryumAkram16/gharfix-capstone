import { describe, expect, it, vi } from 'vitest';
import { createDemoDirectory, loadDemoDataset, validateDemoDataset, withDemoFallback, type DemoDataset } from '../../lib/matching/demo';
import { MapsUnavailableError, type NearbySearch, type ProviderDirectory } from '../../lib/matching/directory';
import { DEMO_NOTE, handleProviderMatch, type MatchDeps } from '../../lib/matching/handler';
import { ruleFor, SERVICE_RULES } from '../../lib/matching/osmServices';
import type { Place } from '../../lib/matching/types';
import { memoryLogger } from '../../lib/log';

const G13 = { lat: 33.6557, lng: 73.0138 };
const JOHAR = { lat: 31.4697, lng: 74.2728 };
const CLIFTON_KARACHI = { lat: 24.8138, lng: 67.0300 };
const search = (over: Partial<NearbySearch> = {}): NearbySearch => ({ services: ['plumber'], center: G13, radiusM: 5000, limit: 20, ...over });

describe('db/seed/demo_providers.json', () => {
  it('loads, validates and is unmistakably demo data', async () => {
    const data = await loadDemoDataset();
    expect(data._notice).toMatch(/^DEMO DATA - fictional sample providers\. These are NOT real businesses/);
    expect(data.providers.length).toBeGreaterThanOrEqual(16);
    expect(new Set(data.providers.map((p) => p.city))).toEqual(new Set(['Lahore', 'Islamabad']));
    for (const p of data.providers) {
      expect(p.id).toMatch(/^demo:(lhr|isb)-/);
      expect(p.name).toMatch(/^\[DEMO\] /);
      expect(p.address).toMatch(/^Demo listing, /);
      expect(Object.keys(p).sort()).toEqual(['address', 'area', 'city', 'id', 'lat', 'lng', 'name', 'services']);
      // Every service is one the OSM rule table knows, so requests find it the same way.
      for (const s of p.services) expect(SERVICE_RULES).toContain(ruleFor(s));
    }
  });
});

describe('validateDemoDataset', () => {
  const ok = (): DemoDataset => ({
    _notice: 'DEMO DATA - test', dataset: 'gharfix-demo-providers', version: 1,
    providers: [{ id: 'demo:isb-x', name: '[DEMO] X', city: 'Islamabad', area: 'G-13', lat: 33.66, lng: 73.01, services: ['plumber'], address: 'Demo listing' }],
  });
  const withProvider = (patch: Record<string, unknown>) => ({ ...ok(), providers: [{ ...ok().providers[0], ...patch }] });

  it('accepts a well-formed dataset', () => {
    expect(validateDemoDataset(ok())).toEqual(ok());
  });

  it.each([
    ['no DEMO DATA notice', { ...ok(), _notice: 'sample providers' }, 'missing DEMO DATA notice'],
    ['a real-looking id', withProvider({ id: 'osm:node/1' }), 'start with "demo:"'],
    ['an unlabelled name', withProvider({ name: 'Ali Plumbers' }), 'name must start with "[DEMO] "'],
    ['another city', withProvider({ city: 'Karachi' }), 'Lahore or Islamabad'],
    ['coordinates outside the city', withProvider({ lat: 24.86, lng: 67.0 }), 'coordinates outside Islamabad'],
    ['an invented rating', withProvider({ rating: 4.8 }), 'must not contain "rating"'],
    ['an invented price', withProvider({ base_rate_pkr: 800 }), 'must not contain "base_rate_pkr"'],
    ['no services', withProvider({ services: [] }), 'services must be non-empty'],
    ['duplicate ids', { ...ok(), providers: [ok().providers[0], ok().providers[0]] }, 'unique'],
  ])('rejects %s', (_l, data, message) => {
    expect(() => validateDemoDataset(data)).toThrow(message);
  });
});

describe('createDemoDirectory', () => {
  it('returns demo places within the radius that offer the service, nearest first', async () => {
    const places = await createDemoDirectory().searchNearby(search());
    expect(places.length).toBeGreaterThan(0);
    expect(places.every((p) => p.source === 'demo_seed' && p.id.startsWith('demo:isb-') && p.name.startsWith('[DEMO] '))).toBe(true);
    expect(places[0].id).toBe('demo:isb-g13-home');
    expect(places.every((p) => p.matchedServices.includes('plumber'))).toBe(true);
    expect(places.map((p) => p.id)).not.toContain('demo:isb-g13-appliance'); // no plumbing there
  });

  it('matches through the shared rule table (washing machine -> appliance provider)', async () => {
    const places = await createDemoDirectory().searchNearby(search({ services: ['washing machine repair'], center: JOHAR }));
    expect(places[0]).toMatchObject({ id: 'demo:lhr-johar-appliance', matchedServices: ['washing machine repair'] });
  });

  it('has nothing outside Lahore and Islamabad, or for services it does not list', async () => {
    const dir = createDemoDirectory();
    expect(await dir.searchNearby(search({ center: CLIFTON_KARACHI }))).toEqual([]);
    expect(await dir.searchNearby(search({ services: ['kite flying'] }))).toEqual([]);
  });

  it('respects the limit', async () => {
    expect(await createDemoDirectory().searchNearby(search({ limit: 1 }))).toHaveLength(1);
  });

  it('loads the file once, and again after a failed load', async () => {
    const data = await loadDemoDataset();
    const load = vi.fn().mockRejectedValueOnce(new Error('disk')).mockResolvedValue(data);
    const dir = createDemoDirectory(load);
    await expect(dir.searchNearby(search())).rejects.toThrow('disk');
    await dir.searchNearby(search());
    await dir.searchNearby(search());
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('withDemoFallback', () => {
  const real: Place = { id: 'osm:node/1', name: 'Real Plumber', lat: 33.656, lng: 73.014, address: '', matchedServices: ['plumber'], sourceUrl: '', source: 'openstreetmap' };
  const dirReturning = (result: Place[] | Error): ProviderDirectory & { calls: number } => {
    const d = { calls: 0, async searchNearby() { d.calls++; if (result instanceof Error) throw result; return result; } };
    return d;
  };

  it('uses OpenStreetMap results when there are any, and never asks the demo', async () => {
    const demo = dirReturning([]);
    expect(await withDemoFallback(dirReturning([real]), demo).searchNearby(search())).toEqual([real]);
    expect(demo.calls).toBe(0);
  });

  it('asks the demo only when OpenStreetMap returns zero, and logs it', async () => {
    const log = memoryLogger();
    const places = await withDemoFallback(dirReturning([]), createDemoDirectory(), log).searchNearby(search());
    expect(places.length).toBeGreaterThan(0);
    expect(log.records).toEqual([expect.objectContaining({ level: 'warn', event: 'match.demo_fallback_used', demo_results: places.length })]);
  });

  it('does not hide an OpenStreetMap outage behind demo data', async () => {
    const demo = dirReturning([]);
    const down = new MapsUnavailableError('directory', 'directory answered HTTP 504', 504);
    await expect(withDemoFallback(dirReturning(down), demo).searchNearby(search())).rejects.toBe(down);
    expect(demo.calls).toBe(0);
  });
});

describe('khadmat-provider-match with demo places', () => {
  it('sets data_source "demo_seed", says so in data_notes, and keeps providers labelled', async () => {
    const deps: MatchDeps = {
      geocoder: { geocode: async () => ({ ...G13, formatted_address: 'G-13, Islamabad', source: 'openstreetmap_nominatim' }) },
      directory: withDemoFallback({ searchNearby: async () => [] }, createDemoDirectory()),
      capacity: { activeBookingCounts: async () => new Map() },
      now: () => new Date('2026-11-04T09:00:00Z'),
      log: memoryLogger(),
    };
    const res = await handleProviderMatch({ services: ['plumber'], service_type: 'plumber', location: 'G-13, Islamabad', job_complexity: 'basic' }, deps);
    const body = res.body as any;

    expect(res.status).toBe(200);
    expect(body.data_source).toBe('demo_seed');
    expect(body.data_notes.note).toBe(DEMO_NOTE);
    expect(body.data_notes.not_available[0]).toMatch(/^not a real business/);
    const top = body.services[0].provider;
    expect(top).toMatchObject({ source: 'demo_seed', id: 'demo:isb-g13-home', name: '[DEMO] G-13 Home Repairs', rating: null, review_count: null, google_maps_url: '', osm_url: '' });
    expect(top.data_gaps[0]).toMatch(/^not a real business/);
  });
});
