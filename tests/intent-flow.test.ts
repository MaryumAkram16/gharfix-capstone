import { describe, expect, it } from 'vitest';
import { createApp } from '../lib/app';
import type { LogRecord } from '../lib/log';
import { transformMatchData } from '../src/lib/transformer';

// /api/proxy khadmat-intent end to end with only HTTP faked, routed by host:
// Gemini, Nominatim, Overpass and Supabase PostgREST. The result is fed to
// the frontend's transformMatchData() to check the UI can render it.

const FAKE_GEMINI_KEY = 'test-gemini-key-not-real';
const env = {
  SUPABASE_URL: 'https://project.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-not-real',
  GEMINI_API_KEY: FAKE_GEMINI_KEY,
};

const intent = {
  services: ['plumber'], primary_service: 'plumber', location: 'Johar Town, Lahore', urgency: 'high', preferred_time: 'asap',
  budget_sensitivity: 'medium', job_complexity: 'basic', confidence_score: 90, clarification_needed: false,
  clarification_question: null, detected_language: 'roman_urdu',
};

function fakeInternet({ gemini = 'ok' as 'ok' | 'down' } = {}) {
  const hosts: string[] = [];
  const fetchImpl = async (input: string, init: RequestInit) => {
    const url = new URL(input);
    hosts.push(url.host);
    switch (url.host) {
      case 'generativelanguage.googleapis.com':
        if (gemini === 'down') return new Response('{}', { status: 503 });
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(intent) }] }, finishReason: 'STOP' }] });
      case 'nominatim.openstreetmap.org':
        return Response.json([{ lat: '31.4697', lon: '74.2728', display_name: 'Johar Town, Lahore, Punjab, Pakistan' }]);
      case 'overpass-api.de':
        expect(new URLSearchParams(init.body as string).get('data')).toContain('around:5000,31.469700,74.272800');
        return Response.json({ elements: [
          { type: 'node', id: 10, lat: 31.4710, lon: 74.2740, tags: { name: 'Johar Sanitary & Plumbing', craft: 'plumber', 'addr:street': 'Khayaban-e-Firdousi' } },
          { type: 'node', id: 11, lat: 31.4800, lon: 74.2900, tags: { name: 'City Plumbers' } },
        ] });
      case 'project.supabase.test':
        // Today's capacity: City Plumbers already has 4 bookings.
        return Response.json([1, 2, 3, 4].map(() => ({ provider_id: 'osm:node/11' })));
      default:
        throw new TypeError(`unexpected host ${url.host}`);
    }
  };
  return { hosts, fetch: fetchImpl };
}

const request = { endpoint: 'khadmat-intent', raw_message: 'Mujhe Johar Town Lahore mein plumber chahiye, abhi', source: 'home' };

describe('khadmat-intent through /api/proxy', () => {
  it('Gemini -> Nominatim -> Overpass -> Supabase capacity -> scored, priced, renderable', async () => {
    const net = fakeInternet();
    const logs: LogRecord[] = [];
    const app = createApp({ env, fetch: net.fetch, logSink: (r) => logs.push(r) });

    const res = await app.proxy(request, { requestId: 'req-intent' });

    expect(res.status).toBe(200);
    const body = res.body as any;
    expect(body).toMatchObject({ status: 'success', stage: 'booking_ready', intent_source: 'gemini' });
    expect(body.matching_result).toMatchObject({ status: 'success', workflow: 'WF3-Pricing', data_source: 'openstreetmap', data_notes: { capacity_checked: true } });
    expect(net.hosts).toEqual(['generativelanguage.googleapis.com', 'nominatim.openstreetmap.org', 'overpass-api.de', 'project.supabase.test']);

    const top = body.matching_result.services[0].provider;
    expect(top).toMatchObject({ id: 'osm:node/10', name: 'Johar Sanitary & Plumbing', address: 'Khayaban-e-Firdousi', rating: null, review_count: null });
    expect(body.matching_result.services[0].alternatives[0]).toMatchObject({ id: 'osm:node/11', at_capacity: true });

    // What MatchView will show.
    const ui = transformMatchData(body);
    expect(ui.status).toBe('success');
    expect(ui.top_provider_card).toMatchObject({ id: 'osm:node/10', name: 'Johar Sanitary & Plumbing', price_from: 900, verified: false });
    expect(ui.alternative_cards.map((c) => c.id)).toEqual(['osm:node/11']);
    expect(ui.pricing_card.total).toBe(body.matching_result.summary.grand_total_pkr);

    const secrets = JSON.stringify(logs);
    expect(secrets).not.toContain(FAKE_GEMINI_KEY);
    expect(secrets).not.toContain(env.SUPABASE_SERVICE_ROLE_KEY);
    expect(secrets).not.toContain('Mujhe Johar Town');
  });

  it('keeps working on the keyword parser when Gemini is down', async () => {
    const net = fakeInternet({ gemini: 'down' });
    const logs: LogRecord[] = [];
    const res = await createApp({ env, fetch: net.fetch, logSink: (r) => logs.push(r) }).proxy(request, { requestId: null });

    expect((res.body as any)).toMatchObject({ status: 'success', intent_source: 'keyword_fallback' });
    expect(logs.find((r) => r.event === 'intent.parser_failed')).toMatchObject({ reason: 'unavailable', http_status: 503 });
  });

  it('uses only the keyword parser, never calling Gemini, without GEMINI_API_KEY', async () => {
    const net = fakeInternet();
    const { GEMINI_API_KEY: _k, ...noGemini } = env;
    const res = await createApp({ env: noGemini, fetch: net.fetch, logSink: () => {} }).proxy(request, { requestId: null });
    expect((res.body as any).intent_source).toBe('keyword_fallback');
    expect(net.hosts).not.toContain('generativelanguage.googleapis.com');
  });

  it('matches without Supabase configured, saying capacity was not checked', async () => {
    const net = fakeInternet();
    const res = await createApp({ env: { GEMINI_API_KEY: FAKE_GEMINI_KEY }, fetch: net.fetch, logSink: () => {} })
      .proxy({ endpoint: 'khadmat-provider-match', ...intent }, { requestId: null });
    expect((res.body as any).data_notes.capacity_checked).toBe(false);
    expect(net.hosts).not.toContain('project.supabase.test');
  });
});
