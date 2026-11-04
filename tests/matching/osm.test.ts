import { describe, expect, it, vi } from 'vitest';
import { memoryLogger } from '../../lib/log';
import { MapsUnavailableError } from '../../lib/matching/directory';
import { createNominatimGeocoder, createOverpassDirectory, DEFAULT_USER_AGENT } from '../../lib/matching/osm';
import { elementMatches, overpassQuery, ruleFor, SERVICE_RULES } from '../../lib/matching/osmServices';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function fakeFetch(...responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('no more fake responses');
    if (next instanceof Error) throw next;
    return next;
  });
  return { calls, impl };
}

describe('Nominatim geocoder', () => {
  it('searches Pakistan with an identifying User-Agent and maps the first hit', async () => {
    const f = fakeFetch(json(200, [{ lat: '33.6557', lon: '73.0138', display_name: 'G-13, Islamabad, Pakistan' }]));
    const geo = createNominatimGeocoder('https://nominatim.test/', { fetch: f.impl });

    expect(await geo.geocode(' G-13, Islamabad ')).toEqual({
      lat: 33.6557, lng: 73.0138, formatted_address: 'G-13, Islamabad, Pakistan', source: 'openstreetmap_nominatim',
    });
    const url = new URL(f.calls[0].url);
    expect(url.origin + url.pathname).toBe('https://nominatim.test/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'G-13, Islamabad', format: 'jsonv2', limit: '1', countrycodes: 'pk', 'accept-language': 'en' });
    expect(f.calls[0].init.headers).toMatchObject({ 'User-Agent': DEFAULT_USER_AGENT });
    expect(DEFAULT_USER_AGENT).not.toMatch(/@/); // no personal email in the UA
  });

  it('returns null when nothing is found, and caches both hits and misses', async () => {
    const f = fakeFetch(json(200, []));
    const geo = createNominatimGeocoder(undefined, { fetch: f.impl });
    expect(await geo.geocode('Atlantis')).toBeNull();
    expect(await geo.geocode('atlantis')).toBeNull();
    expect(f.impl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['429', json(429, {})],
    ['503', json(503, {})],
    ['network error', new TypeError('fetch failed')],
    ['timeout', Object.assign(new Error('t'), { name: 'TimeoutError' })],
  ])('throws MapsUnavailableError on %s', async (_l, response) => {
    const geo = createNominatimGeocoder(undefined, { fetch: fakeFetch(response).impl });
    await expect(geo.geocode('G-13')).rejects.toBeInstanceOf(MapsUnavailableError);
  });
});

describe('ruleFor', () => {
  it('finds exact keys, then the longest whole-phrase key', () => {
    expect(ruleFor('AC repair')!.tags).toContainEqual(['craft', 'hvac']);
    expect(ruleFor('emergency plumber')!.tags).toContainEqual(['craft', 'plumber']);
    expect(ruleFor('Washing machine repair')!.tags).toContainEqual(['shop', 'appliance']);
    expect(ruleFor('generator mechanic')!.names).toContain('generator');
  });

  it('does not match short keys inside other words', () => {
    // "ac" is a key, but must not match "vacuum" or "pacific".
    expect(ruleFor('vacuum repair')!.tags).toEqual([]);
    expect(ruleFor('vacuum repair')!.names).toEqual(['vacuum', 'repair']);
  });

  it('falls back to name words for unknown services and ignores anything but letters', () => {
    expect(ruleFor('cook')).toEqual({ keys: ['cook'], tags: [], names: ['cook'] });
    expect(ruleFor('x"];out;')).toBeNull();
    expect(ruleFor('kite"];(node(1);<;);out;')!.names).toEqual(['kite', 'node']);
  });

  it('every table pattern compiles in JavaScript', () => {
    for (const r of SERVICE_RULES) for (const n of r.names) expect(() => new RegExp(n, 'i')).not.toThrow();
  });
});

describe('elementMatches', () => {
  const ac = ruleFor('AC repair')!;
  it.each([
    [{ tags: { craft: 'hvac', name: 'Cool Point' } }, true],
    [{ tags: { name: 'Ali AC Services' } }, true],
    [{ tags: { name: 'A.C. Wala' } }, true],
    [{ tags: { name: 'Pacific Traders' } }, false],
    [{ tags: { name: 'Shah Air Conditioning' } }, true],
    [{ tags: {} }, false],
  ])('%j -> %s', (el, expected) => {
    expect(elementMatches(ac, el)).toBe(expected);
  });
});

describe('overpassQuery', () => {
  it('builds one around-filter per tag and name pattern, de-duplicated', () => {
    const q = overpassQuery([ruleFor('plumber')!, ruleFor('geyser repair')!], 33.6557, 73.0138, 5000, 10);
    expect(q).toBe([
      '[out:json][timeout:10];',
      '(',
      '  nwr["craft"="plumber"](around:5000,33.655700,73.013800);',
      '  nwr["name"~"plumb",i](around:5000,33.655700,73.013800);',
      '  nwr["name"~"sanitary",i](around:5000,33.655700,73.013800);',
      ');',
      'out center tags 200;',
    ].join('\n'));
  });

  it('refuses non-numeric coordinates', () => {
    expect(() => overpassQuery([ruleFor('plumber')!], Number('x'), 73, 5000, 10)).toThrow('non-numeric');
  });
});

describe('Overpass directory', () => {
  const center = { lat: 33.6557, lng: 73.0138 };
  const elements = [
    { type: 'node', id: 3, lat: 33.70, lon: 73.05, tags: { name: 'Far Plumbing', craft: 'plumber' } },
    { type: 'way', id: 2, center: { lat: 33.657, lon: 73.015 }, tags: { name: 'Near Electric & Sanitary', 'addr:street': 'Main Road', 'addr:city': 'Islamabad' } },
    { type: 'node', id: 4, lat: 33.66, lon: 73.02, tags: { craft: 'plumber' } }, // no name: skipped
    { type: 'node', id: 3, lat: 33.70, lon: 73.05, tags: { name: 'Far Plumbing', craft: 'plumber' } }, // duplicate
    { type: 'node', id: 5, lat: 33.66, lon: 73.02, tags: { name: 'Bakery' } }, // matches nothing
  ];

  it('POSTs the query as form data and returns named matches, nearest first, with what each matched', async () => {
    const f = fakeFetch(json(200, { elements }));
    const dir = createOverpassDirectory('https://overpass.test/api/interpreter', { fetch: f.impl });

    const places = await dir.searchNearby({ services: ['plumber', 'electrician'], center, radiusM: 5000, limit: 20 });

    expect(f.calls[0].init.method).toBe('POST');
    expect(f.calls[0].init.headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded' });
    const data = new URLSearchParams(f.calls[0].init.body as string).get('data')!;
    expect(data).toContain('nwr["craft"="plumber"](around:5000,33.655700,73.013800);');
    expect(data).toContain('nwr["craft"="electrician"]');

    expect(places).toEqual([
      {
        id: 'osm:way/2', name: 'Near Electric & Sanitary', lat: 33.657, lng: 73.015, address: 'Main Road, Islamabad',
        matchedServices: ['plumber', 'electrician'], sourceUrl: 'https://www.openstreetmap.org/way/2', source: 'openstreetmap',
      },
      {
        id: 'osm:node/3', name: 'Far Plumbing', lat: 33.7, lng: 73.05, address: '',
        matchedServices: ['plumber'], sourceUrl: 'https://www.openstreetmap.org/node/3', source: 'openstreetmap',
      },
    ]);
  });

  it('applies the limit after sorting by distance', async () => {
    const dir = createOverpassDirectory(undefined, { fetch: fakeFetch(json(200, { elements })).impl });
    const places = await dir.searchNearby({ services: ['plumber'], center, radiusM: 5000, limit: 1 });
    expect(places.map((p) => p.id)).toEqual(['osm:way/2']);
  });

  it('makes no request when no service can be searched', async () => {
    const f = fakeFetch();
    expect(await createOverpassDirectory(undefined, { fetch: f.impl }).searchNearby({ services: ['x'], center, radiusM: 5000, limit: 5 })).toEqual([]);
    expect(f.impl).not.toHaveBeenCalled();
  });

  it.each([
    ['an Overpass timeout remark', json(200, { elements: [], remark: 'runtime error: Query timed out in "query" at line 3 after 11 seconds.' })],
    ['504', json(504, {})],
    ['429', json(429, {})],
  ])('throws MapsUnavailableError on %s', async (_l, response) => {
    const dir = createOverpassDirectory(undefined, { fetch: fakeFetch(response).impl });
    await expect(dir.searchNearby({ services: ['plumber'], center, radiusM: 5000, limit: 5 })).rejects.toMatchObject({ name: 'MapsUnavailableError', service: 'directory' });
  });
});

describe('Overpass mirrors', () => {
  const center = { lat: 33.6557, lng: 73.0138 };
  const MAIN = 'https://overpass-main.test/api/interpreter';
  const MIRROR = 'https://overpass-mirror.test/api/interpreter';
  const ok = () => json(200, { elements: [{ type: 'node', id: 9, lat: 33.657, lon: 73.015, tags: { name: 'Mirror Plumbing', craft: 'plumber' } }] });
  const plumber = { services: ['plumber'], center, radiusM: 5000, limit: 20 };

  function router(replies: Record<string, Array<Response | Error | 'hang'>>) {
    const hits: string[] = [];
    const queries: string[] = [];
    const impl = async (url: string, init: RequestInit) => {
      const host = new URL(url).host;
      hits.push(host);
      queries.push(new URLSearchParams(init.body as string).get('data') ?? '');
      const next = replies[host].shift()!;
      if (next === 'hang') {
        // Like real fetch: reject when the AbortSignal fires.
        return new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))));
      }
      if (next instanceof Error) throw next;
      return next;
    };
    return { hits, queries, impl };
  }

  it.each([
    ['a 504', json(504, {})],
    ['a 429', json(429, {})],
    ['a network error', new TypeError('fetch failed')],
    ['an Overpass timeout remark', json(200, { elements: [], remark: 'runtime error: Query timed out in "query" at line 3 after 6 seconds.' })],
  ])('tries the mirror after %s on the main instance', async (_l, failure) => {
    const log = memoryLogger();
    const r = router({ 'overpass-main.test': [failure], 'overpass-mirror.test': [ok()] });
    const places = await createOverpassDirectory([MAIN, MIRROR], { fetch: r.impl, log }).searchNearby(plumber);
    expect(r.hits).toEqual(['overpass-main.test', 'overpass-mirror.test']);
    expect(places.map((p) => p.id)).toEqual(['osm:node/9']);
    expect(log.records.map((x) => x.event)).toEqual(['osm.mirror_failed', 'osm.mirror_used', 'osm.search']);
  });

  it('tries the mirror after a real per-attempt timeout', async () => {
    const r = router({ 'overpass-main.test': ['hang'], 'overpass-mirror.test': [ok()] });
    const t = Date.now();
    const places = await createOverpassDirectory([MAIN, MIRROR], { fetch: r.impl, timeoutMs: 60, budgetMs: 5000 }).searchNearby(plumber);
    expect(places).toHaveLength(1);
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it('does not call the mirror when the main instance answers (even with zero results)', async () => {
    const r = router({ 'overpass-main.test': [json(200, { elements: [] })], 'overpass-mirror.test': [ok()] });
    expect(await createOverpassDirectory([MAIN, MIRROR], { fetch: r.impl }).searchNearby(plumber)).toEqual([]);
    expect(r.hits).toEqual(['overpass-main.test']);
  });

  it('gives up with one MapsUnavailableError when both fail, keeping status and timeout flag', async () => {
    const r = router({ 'overpass-main.test': [json(503, {})], 'overpass-mirror.test': ['hang'] });
    const err = await createOverpassDirectory([MAIN, MIRROR], { fetch: r.impl, timeoutMs: 50, budgetMs: 5000 }).searchNearby(plumber).catch((e) => e);
    expect(err).toBeInstanceOf(MapsUnavailableError);
    expect(err).toMatchObject({ service: 'directory', timedOut: true, message: 'directory timed out (2 Overpass instance(s) tried)' });
  });

  it('skips the mirror when the budget is spent, so the caller can still answer in time', async () => {
    let clock = 0;
    const r = router({ 'overpass-main.test': [json(504, {})], 'overpass-mirror.test': [ok()] });
    const slow = async (url: string, init: RequestInit) => { clock += 11_000; return r.impl(url, init); };
    const log = memoryLogger();
    const err = await createOverpassDirectory([MAIN, MIRROR], { fetch: slow, timeoutMs: 8000, budgetMs: 12000, now: () => clock, log })
      .searchNearby(plumber).catch((e) => e);
    expect(err).toBeInstanceOf(MapsUnavailableError);
    expect(r.hits).toEqual(['overpass-main.test']);
    expect(log.records.find((x) => x.event === 'osm.mirror_skipped')).toMatchObject({ mirror: 'overpass-mirror.test', budget_left_ms: 1000 });
  });

  it('gives the mirror only what is left of the budget (server-side timeout shrinks too)', async () => {
    let clock = 0;
    const r = router({ 'overpass-main.test': [json(504, {})], 'overpass-mirror.test': [ok()] });
    const timed = async (url: string, init: RequestInit) => { const res = await r.impl(url, init); clock += 7_000; return res; };
    await createOverpassDirectory([MAIN, MIRROR], { fetch: timed, timeoutMs: 8000, budgetMs: 12000, now: () => clock }).searchNearby(plumber);
    expect(r.queries[0]).toMatch(/^\[out:json\]\[timeout:6\];/); // 8 s attempt
    expect(r.queries[1]).toMatch(/^\[out:json\]\[timeout:3\];/); // 5 s left of the 12 s budget
  });
});

describe('Nominatim timeout', () => {
  it('honours the configured timeout', async () => {
    const hang = (_u: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))));
    const err = await createNominatimGeocoder(undefined, { fetch: hang, timeoutMs: 40 }).geocode('G-13').catch((e) => e);
    expect(err).toMatchObject({ name: 'MapsUnavailableError', service: 'geocoder', timedOut: true, message: 'geocoder timed out' });
  });
});
