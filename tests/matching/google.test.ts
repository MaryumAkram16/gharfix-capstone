import { describe, expect, it } from 'vitest';
import { googleConfigFromEnv } from '../../lib/matching/config';
import { MapsUnavailableError, withDirectoryFallback, type NearbySearch, type ProviderDirectory } from '../../lib/matching/directory';
import { createGooglePlacesDirectory, FIELD_MASK, GOOGLE_PLACES_URL } from '../../lib/matching/google';
import { toProvider } from '../../lib/matching/providers';
import type { MatchRequest, Place } from '../../lib/matching/types';
import { memoryLogger } from '../../lib/log';

const G13 = { lat: 33.6557, lng: 73.0138 };
const search = (over: Partial<NearbySearch> = {}): NearbySearch => ({ services: ['plumber'], center: G13, radiusM: 5000, limit: 20, ...over });
const KEY = 'test-key-not-real';

const gplace = (id: string, lat: number, lng: number, extra: Record<string, unknown> = {}) => ({
  id, displayName: { text: `Place ${id}` }, formattedAddress: `${id} street, Islamabad`, location: { latitude: lat, longitude: lng },
  businessStatus: 'OPERATIONAL', googleMapsUri: `https://maps.google.com/?cid=${id}`, ...extra,
});

function fakeGoogle(reply: (body: any) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit; body: any }> = [];
  const fetch = async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, init, body });
    return reply(body);
  };
  return { calls, fetch };
}

describe('createGooglePlacesDirectory', () => {
  it('sends one Text Search (New) request per service, with key, field mask and a location bias', async () => {
    const g = fakeGoogle(() => Response.json({ places: [] }));
    await createGooglePlacesDirectory({ apiKey: KEY, fetch: g.fetch }).searchNearby(search({ services: ['plumber', 'electrician', ' '] }));
    expect(g.calls).toHaveLength(2);
    const [c] = g.calls;
    expect(c.url).toBe(GOOGLE_PLACES_URL);
    expect(c.init.method).toBe('POST');
    expect(c.init.headers).toMatchObject({ 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': FIELD_MASK, 'Content-Type': 'application/json' });
    expect(FIELD_MASK.split(',')).toEqual(expect.arrayContaining(['places.rating', 'places.userRatingCount', 'places.priceLevel', 'places.currentOpeningHours.openNow']));
    expect(c.body).toEqual({
      textQuery: 'plumber',
      locationBias: { circle: { center: { latitude: G13.lat, longitude: G13.lng }, radius: 5000 } },
      regionCode: 'PK', languageCode: 'en', pageSize: 20,
    });
    expect(g.calls[1].body.textQuery).toBe('electrician');
  });

  it('keeps user text out of the JSON structure (JSON.stringify)', async () => {
    const g = fakeGoogle(() => Response.json({}));
    await createGooglePlacesDirectory({ apiKey: KEY, fetch: g.fetch }).searchNearby(search({ services: ['plumber", "pageSize": 1, "x": "'] }));
    expect(g.calls[0].body.pageSize).toBe(20);
    expect(g.calls[0].body.textQuery).toBe('plumber", "pageSize": 1, "x": "');
  });

  it('maps places, merges services per place, drops far/closed/incomplete ones, nearest first, limited', async () => {
    const g = fakeGoogle((b) => Response.json({
      places: b.textQuery === 'plumber'
        ? [gplace('far', 33.80, 73.20), gplace('b', 33.68, 73.03, { rating: 4.6, userRatingCount: 212, priceLevel: 'PRICE_LEVEL_INEXPENSIVE', currentOpeningHours: { openNow: true } }), gplace('a', 33.657, 73.015), gplace('shut', 33.656, 73.014, { businessStatus: 'CLOSED_PERMANENTLY' }), { id: 'noname', location: { latitude: 33.656, longitude: 73.014 } }]
        : [gplace('b', 33.68, 73.03), gplace('c', 33.66, 73.02)],
    }));
    const log = memoryLogger();
    const places = await createGooglePlacesDirectory({ apiKey: KEY, fetch: g.fetch, log }).searchNearby(search({ services: ['plumber', 'electrician'] }));
    expect(places.map((p) => p.id)).toEqual(['google:a', 'google:c', 'google:b']);
    expect(places[2]).toEqual({
      id: 'google:b', name: 'Place b', lat: 33.68, lng: 73.03, address: 'b street, Islamabad',
      matchedServices: ['plumber', 'electrician'], sourceUrl: 'https://maps.google.com/?cid=b', source: 'google_places',
      google: { rating: 4.6, reviewCount: 212, priceLevel: 'PRICE_LEVEL_INEXPENSIVE', businessStatus: 'OPERATIONAL', openNow: true, mapsUrl: 'https://maps.google.com/?cid=b' },
    });
    expect(places[0].google).toMatchObject({ rating: null, reviewCount: null, priceLevel: null, openNow: null });
    expect(log.records).toEqual([expect.objectContaining({ event: 'google.search', results: 3 })]);
    expect(JSON.stringify(log.records)).not.toContain(KEY);

    const one = await createGooglePlacesDirectory({ apiKey: KEY, fetch: g.fetch }).searchNearby(search({ services: ['plumber'], limit: 1 }));
    expect(one.map((p) => p.id)).toEqual(['google:a']);
  });

  it.each([[400], [403], [429], [500]])('HTTP %i -> MapsUnavailableError (so the next directory is used), without the key in the message', async (status) => {
    const g = fakeGoogle(() => new Response('{"error":{}}', { status }));
    const err = await createGooglePlacesDirectory({ apiKey: KEY, fetch: g.fetch }).searchNearby(search()).catch((e) => e);
    expect(err).toBeInstanceOf(MapsUnavailableError);
    expect(err).toMatchObject({ service: 'directory', httpStatus: status, timedOut: false });
    expect(err.message).not.toContain(KEY);
  });

  it('timeouts, network errors and non-JSON bodies are MapsUnavailableError too', async () => {
    const timeout = async () => { throw new DOMException('timed out', 'TimeoutError'); };
    expect(await createGooglePlacesDirectory({ apiKey: KEY, fetch: timeout }).searchNearby(search()).catch((e) => e)).toMatchObject({ name: 'MapsUnavailableError', timedOut: true });
    const offline = async () => { throw new TypeError('fetch failed'); };
    expect(await createGooglePlacesDirectory({ apiKey: KEY, fetch: offline }).searchNearby(search()).catch((e) => e)).toMatchObject({ name: 'MapsUnavailableError', timedOut: false });
    const html = async () => new Response('<html>', { status: 200 });
    expect(await createGooglePlacesDirectory({ apiKey: KEY, fetch: html }).searchNearby(search()).catch((e) => e)).toBeInstanceOf(MapsUnavailableError);
  });

  it('a really slow answer is cut off by the timeout', async () => {
    const hang = (_u: string, init: RequestInit) => new Promise<Response>((_r, reject) => init.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
    const err = await createGooglePlacesDirectory({ apiKey: KEY, fetch: hang, timeoutMs: 20 }).searchNearby(search()).catch((e) => e);
    expect(err).toMatchObject({ name: 'MapsUnavailableError', timedOut: true });
  });
});

describe('toProvider for Google places (WF2 mapping without invented values)', () => {
  const request: MatchRequest = { services: ['plumber'], service_type: 'plumber', location: 'G-13, Islamabad', job_complexity: 'basic' } as MatchRequest;
  const base: Place = { id: 'google:x', name: 'X Plumbers', lat: 33.657, lng: 73.015, address: 'G-13', matchedServices: ['plumber'], sourceUrl: '', source: 'google_places',
    google: { rating: 4.5, reviewCount: 50, priceLevel: 'PRICE_LEVEL_EXPENSIVE', businessStatus: 'OPERATIONAL', openNow: true, mapsUrl: 'https://maps.google.com/?cid=x' } };
  const ctx = { request, center: G13, activeBookings: new Map<string, number>() };

  it('uses the real rating, reviews, price level, open-now and status', () => {
    const p = toProvider(base, ctx);
    expect(p).toMatchObject({
      source: 'google_places', rating: 4.5, review_count: 50, base_rate_pkr: 1300, base_rate_source: 'google_price_level',
      availability_slots: ['09:00', '11:00', '14:00', '16:00'], verified: true, google_maps_url: 'https://maps.google.com/?cid=x', osm_url: '',
      last_review_date: null, on_time_score: null, cancellation_rate: null,
      reputation_score: Math.round((4.5 / 5) * 70 + (50 / 100) * 30),
    });
    expect(p.data_gaps).not.toContain('rating (none on Google yet)');
  });

  it('missing facts stay null / default and are listed in data_gaps (n8n invented 4.0 and 10 reviews)', () => {
    const p = toProvider({ ...base, google: { rating: null, reviewCount: null, priceLevel: null, businessStatus: null, openNow: null, mapsUrl: '' } }, ctx);
    expect(p).toMatchObject({ rating: null, review_count: null, reputation_score: null, base_rate_pkr: 900, base_rate_source: 'gharfix_default', availability_slots: ['09:00', '11:00'], verified: false });
    expect(p.google_maps_url).toBe('https://www.google.com/maps/search/?api=1&query=33.657,73.015');
    expect(p.data_gaps).toEqual(expect.arrayContaining(['rating (none on Google yet)', 'price (base_rate_pkr is the GharFix default)']));
  });

  it('no slots at capacity', () => {
    expect(toProvider(base, { ...ctx, activeBookings: new Map([['google:x', 4]]) }).availability_slots).toEqual([]);
  });
});

describe('withDirectoryFallback', () => {
  const place = { id: 'osm:node/1' } as Place;
  const dir = (r: Place[] | Error) => { const d = { calls: 0, async searchNearby() { d.calls++; if (r instanceof Error) throw r; return r; } }; return d as ProviderDirectory & { calls: number }; };

  it('returns the primary answer, including zero results, without asking the secondary', async () => {
    const second = dir([place]);
    expect(await withDirectoryFallback(dir([]), second).searchNearby(search())).toEqual([]);
    expect(second.calls).toBe(0);
  });

  it('asks the secondary when the primary throws, and logs it', async () => {
    const log = memoryLogger();
    expect(await withDirectoryFallback(dir(new Error('403')), dir([place]), log).searchNearby(search())).toEqual([place]);
    expect(log.records[0]).toMatchObject({ level: 'warn', event: 'match.directory_fallback_used' });
  });

  it('lets the secondary error through when both fail', async () => {
    const second = new MapsUnavailableError('directory', 'osm down', 504);
    await expect(withDirectoryFallback(dir(new Error('x')), dir(second)).searchNearby(search())).rejects.toBe(second);
  });
});

describe('googleConfigFromEnv', () => {
  it('is off without GOOGLE_MAPS_API_KEY', () => {
    expect(googleConfigFromEnv({})).toBeNull();
    expect(googleConfigFromEnv({ GOOGLE_MAPS_API_KEY: '  ' })).toBeNull();
  });
  it('reads the key and timeout (default 8000, invalid -> default with a warning)', () => {
    expect(googleConfigFromEnv({ GOOGLE_MAPS_API_KEY: ' k ' })).toEqual({ apiKey: 'k', timeoutMs: 8000 });
    expect(googleConfigFromEnv({ GOOGLE_MAPS_API_KEY: 'k', GOOGLE_PLACES_TIMEOUT_MS: '12000' })).toEqual({ apiKey: 'k', timeoutMs: 12000 });
    const log = memoryLogger();
    expect(googleConfigFromEnv({ GOOGLE_MAPS_API_KEY: 'k', GOOGLE_PLACES_TIMEOUT_MS: 'soon' }, log)?.timeoutMs).toBe(8000);
    expect(log.records[0]).toMatchObject({ event: 'osm.config_invalid', variable: 'GOOGLE_PLACES_TIMEOUT_MS' });
    expect(JSON.stringify(log.records)).not.toContain('"k"');
  });
});
