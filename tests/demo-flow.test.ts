import { describe, expect, it } from 'vitest';
import { createApp } from '../lib/app';
import { NO_PROVIDERS_TEXT } from '../lib/matching/handler';
import type { LogRecord } from '../lib/log';
import { DEMO_BADGE, transformMatchData } from '../src/lib/transformer';

// USE_DEMO_PROVIDERS through /api/proxy with only HTTP faked. The demo
// directory fills in when Overpass (main instance, then the mirror) answers
// with zero providers or fails; with the flag off a failure stays a 503.

type Overpass = 'empty' | 'results' | 'down' | 'timeout';

const OVERPASS_HOSTS = ['overpass-api.de', 'overpass.kumi.systems'];

function overpassReply(mode: Overpass): Response {
  if (mode === 'down') return new Response('', { status: 504 });
  if (mode === 'timeout') return Response.json({ elements: [], remark: 'runtime error: Query timed out in "query" at line 3 after 6 seconds.' });
  return Response.json({ elements: mode === 'empty' ? [] : [{ type: 'node', id: 7, lat: 33.657, lon: 73.015, tags: { name: 'Real G-13 Plumbers', craft: 'plumber' } }] });
}

/** `overpass` is the main instance; `mirror` defaults to the same behaviour. */
function fakeInternet(overpass: Overpass, mirror: Overpass = overpass) {
  const hosts: string[] = [];
  const fetchImpl = async (input: string) => {
    const host = new URL(input).host;
    hosts.push(host);
    if (host === 'nominatim.openstreetmap.org') return Response.json([{ lat: '33.6557', lon: '73.0138', display_name: 'G-13, Islamabad, Pakistan' }]);
    if (host === OVERPASS_HOSTS[0]) return overpassReply(overpass);
    if (host === OVERPASS_HOSTS[1]) return overpassReply(mirror);
    throw new TypeError(`unexpected host ${host}`);
  };
  return { hosts, fetch: fetchImpl };
}

const match = { endpoint: 'khadmat-provider-match', services: ['plumber'], service_type: 'plumber', location: 'G-13, Islamabad', job_complexity: 'basic', budget_sensitivity: 'medium' };

async function run(overpass: Overpass, flag?: string, mirror: Overpass = overpass) {
  const net = fakeInternet(overpass, mirror);
  const logs: LogRecord[] = [];
  const env = flag === undefined ? {} : { USE_DEMO_PROVIDERS: flag };
  const res = await createApp({ env, fetch: net.fetch, logSink: (r) => logs.push(r) }).proxy(match, { requestId: null });
  return { res, logs, hosts: net.hosts };
}

describe('USE_DEMO_PROVIDERS off (default)', () => {
  it.each([['down'], ['timeout']] as const)('OSM %s on both instances: 503, with an incident and no demo data', async (mode) => {
    const { res, logs, hosts } = await run(mode);
    expect(res).toEqual({
      status: 503,
      body: { retryable: true, status: 'service_unavailable', message: 'Provider search is temporarily unavailable. Please try again in a minute.' },
    });
    expect(hosts.filter((h) => OVERPASS_HOSTS.includes(h))).toEqual(OVERPASS_HOSTS);
    expect(logs.find((r) => r.event === 'incident.recorded')).toMatchObject({ step: 'osm.searchNearby', auto_fixed: false });
    expect(logs.map((r) => r.event)).not.toContain('match.demo_fallback_used');
  });

  it.each([[undefined], ['0'], ['true'], ['yes'], [' 1']])('flag %j: zero OSM providers stays "no providers"', async (flag) => {
    const { res, logs } = await run('empty', flag);
    expect(res).toEqual({ status: 200, body: NO_PROVIDERS_TEXT });
    expect(logs.map((r) => r.event)).not.toContain('match.demo_fallback_used');
  });
});

describe('USE_DEMO_PROVIDERS=1', () => {
  it('fills in demo providers when OSM returns zero, labelled end to end', async () => {
    const { res, logs } = await run('empty', '1');
    const body = res.body as any;

    expect(res.status).toBe(200);
    expect(body.data_source).toBe('demo_seed');
    expect(body.services[0].provider.name).toMatch(/^\[DEMO\] /);
    expect(logs.map((r) => r.event)).toEqual(expect.arrayContaining(['match.demo_providers_enabled', 'match.demo_fallback_used']));

    const ui = transformMatchData(body);
    expect(ui.is_demo).toBe(true);
    for (const card of [ui.top_provider_card!, ...ui.alternative_cards]) {
      expect(card.source).toBe('demo_seed');
      expect(card.badges[0]).toBe(DEMO_BADGE);
    }
  });

  it('still prefers real OSM providers when there are any', async () => {
    const { res } = await run('results', '1');
    const body = res.body as any;
    expect(body.data_source).toBe('openstreetmap');
    expect(body.services[0].provider).toMatchObject({ id: 'osm:node/7', source: 'openstreetmap' });
    const ui = transformMatchData(body);
    expect(ui.is_demo).toBe(false);
    expect(ui.top_provider_card!.badges).not.toContain(DEMO_BADGE);
  });

  it.each([['down'], ['timeout']] as const)('falls back to demo providers when OSM is %s (both instances), and still records the incident', async (mode) => {
    const { res, logs, hosts } = await run(mode, '1');
    const body = res.body as any;

    expect(res.status).toBe(200);
    expect(hosts.filter((h) => OVERPASS_HOSTS.includes(h))).toEqual(OVERPASS_HOSTS); // main, then mirror
    expect(body.data_source).toBe('demo_seed');
    expect(body.data_notes).toMatchObject({ demo_reason: 'osm_unavailable', note: expect.stringMatching(/^DEMO DATA: OpenStreetMap could not be reached/) });
    expect(body.services[0].provider).toMatchObject({ source: 'demo_seed', name: expect.stringMatching(/^\[DEMO\] /) });
    expect(logs.find((r) => r.event === 'incident.recorded')).toMatchObject({
      workflow: 'khadmat-provider-match', step: 'osm.searchNearby', auto_fixed: false, retryable: true,
      error_class: mode === 'down' ? 'MapsUnavailableError:directory:504' : 'MapsUnavailableError:directory:timeout',
    });
    expect(logs.find((r) => r.event === 'match.demo_fallback_used')).toMatchObject({ reason: 'osm_unavailable' });

    const ui = transformMatchData(body);
    expect(ui.is_demo).toBe(true);
    expect(ui.demo_reason).toBe('osm_unavailable');
    expect(ui.top_provider_card!.badges[0]).toBe(DEMO_BADGE);
  });

  it('uses the mirror, not demo data, when only the main Overpass instance fails', async () => {
    const { res, hosts, logs } = await run('down', '1', 'results');
    const body = res.body as any;
    expect(body.data_source).toBe('openstreetmap');
    expect(body.services[0].provider).toMatchObject({ id: 'osm:node/7', source: 'openstreetmap' });
    expect(hosts.filter((h) => OVERPASS_HOSTS.includes(h))).toEqual(OVERPASS_HOSTS);
    expect(logs.map((r) => r.event)).toEqual(expect.arrayContaining(['osm.mirror_failed', 'osm.mirror_used']));
    // The mirror answered, so no OpenStreetMap incident (this env has no Supabase, so the capacity read records its own).
    expect(logs.filter((r) => r.event === 'incident.recorded' && String(r.step).startsWith('osm.'))).toEqual([]);
  });

  it('serves Gulshan-e-Ravi from demo data when OSM is down (was a 503 on Vercel)', async () => {
    const net = fakeInternet('down');
    const gulshan = async (input: string) =>
      new URL(input).host === 'nominatim.openstreetmap.org'
        ? Response.json([{ lat: '31.5536', lon: '74.2706', display_name: 'Gulshan-e-Ravi, Lahore, Pakistan' }])
        : net.fetch(input);
    const res = await createApp({ env: { USE_DEMO_PROVIDERS: '1' }, fetch: gulshan, logSink: () => {} })
      .proxy({ ...match, location: 'Gulshan-e-Ravi, Lahore' }, { requestId: null });
    const body = res.body as any;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ data_source: 'demo_seed', data_notes: { demo_reason: 'osm_unavailable' } });
    expect(body.services[0].provider).toMatchObject({ id: 'demo:lhr-gulshanravi-home', name: '[DEMO] Gulshan-e-Ravi Home Repairs' });
  });

  it('still answers 503 (not "no providers") when OSM is down and the demo has nothing for the area', async () => {
    const net = fakeInternet('down');
    const karachi = async (input: string) =>
      new URL(input).host === 'nominatim.openstreetmap.org' ? Response.json([{ lat: '24.8138', lon: '67.0300', display_name: 'Clifton, Karachi' }]) : net.fetch(input);
    const res = await createApp({ env: { USE_DEMO_PROVIDERS: '1' }, fetch: karachi, logSink: () => {} }).proxy({ ...match, location: 'Clifton, Karachi' }, { requestId: null });
    expect(res.status).toBe(503);
  });

  it('still finds nothing outside Lahore and Islamabad', async () => {
    const net = fakeInternet('empty');
    const karachiFetch = async (input: string) =>
      new URL(input).host === 'nominatim.openstreetmap.org'
        ? Response.json([{ lat: '24.8138', lon: '67.0300', display_name: 'Clifton, Karachi' }])
        : net.fetch(input);
    const res = await createApp({ env: { USE_DEMO_PROVIDERS: '1' }, fetch: karachiFetch, logSink: () => {} })
      .proxy({ ...match, location: 'Clifton, Karachi' }, { requestId: null });
    expect(res).toEqual({ status: 200, body: NO_PROVIDERS_TEXT });
  });

  it('labels intent responses the same way (khadmat-intent -> matching_result)', async () => {
    const net = fakeInternet('empty');
    const res = await createApp({ env: { USE_DEMO_PROVIDERS: '1' }, fetch: net.fetch, logSink: () => {} })
      .proxy({ endpoint: 'khadmat-intent', raw_message: 'plumber chahiye Islamabad G-13' }, { requestId: null });
    const body = res.body as any;
    expect(body).toMatchObject({ status: 'success', intent_source: 'keyword_fallback', matching_result: { data_source: 'demo_seed' } });
    expect(transformMatchData(body).is_demo).toBe(true);
  });
});
