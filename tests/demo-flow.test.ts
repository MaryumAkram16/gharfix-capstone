import { describe, expect, it } from 'vitest';
import { createApp } from '../lib/app';
import { NO_PROVIDERS_TEXT } from '../lib/matching/handler';
import type { LogRecord } from '../lib/log';
import { DEMO_BADGE, transformMatchData } from '../src/lib/transformer';

// USE_DEMO_PROVIDERS through /api/proxy with only HTTP faked. The demo
// directory may only fill in when Overpass answers with zero providers.

type Overpass = 'empty' | 'results' | 'down';

function fakeInternet(overpass: Overpass) {
  const hosts: string[] = [];
  const fetchImpl = async (input: string) => {
    const host = new URL(input).host;
    hosts.push(host);
    if (host === 'nominatim.openstreetmap.org') return Response.json([{ lat: '33.6557', lon: '73.0138', display_name: 'G-13, Islamabad, Pakistan' }]);
    if (host === 'overpass-api.de') {
      if (overpass === 'down') return new Response('', { status: 504 });
      return Response.json({ elements: overpass === 'empty' ? [] : [{ type: 'node', id: 7, lat: 33.657, lon: 73.015, tags: { name: 'Real G-13 Plumbers', craft: 'plumber' } }] });
    }
    throw new TypeError(`unexpected host ${host}`);
  };
  return { hosts, fetch: fetchImpl };
}

const match = { endpoint: 'khadmat-provider-match', services: ['plumber'], service_type: 'plumber', location: 'G-13, Islamabad', job_complexity: 'basic', budget_sensitivity: 'medium' };

async function run(overpass: Overpass, flag?: string) {
  const net = fakeInternet(overpass);
  const logs: LogRecord[] = [];
  const env = flag === undefined ? {} : { USE_DEMO_PROVIDERS: flag };
  const res = await createApp({ env, fetch: net.fetch, logSink: (r) => logs.push(r) }).proxy(match, { requestId: null });
  return { res, logs, hosts: net.hosts };
}

describe('USE_DEMO_PROVIDERS off (default)', () => {
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

  it('does not use demo data when OSM is down: 503 as before', async () => {
    const { res } = await run('down', '1');
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
