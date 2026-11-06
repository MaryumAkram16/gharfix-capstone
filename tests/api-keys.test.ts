import { describe, expect, it } from 'vitest';
import { createApp } from '../lib/app';
import type { LogRecord } from '../lib/log';

// Two separate Google keys, each restricted to one API (README §3):
//   GEMINI_API_KEY      -> generativelanguage.googleapis.com (intent parsing) only
//   GOOGLE_MAPS_API_KEY -> places.googleapis.com (provider search) only
// A key sent to the wrong API is refused with 403 by a restricted key, so
// every outgoing request is checked here, and no log line may contain a key.

const GEMINI_KEY = 'test-gemini-key-not-real';
const MAPS_KEY = 'test-maps-key-not-real';

const intent = {
  services: ['plumber'], primary_service: 'plumber', location: 'G-13, Islamabad', urgency: 'high', preferred_time: 'asap',
  budget_sensitivity: 'medium', job_complexity: 'basic', confidence_score: 90, clarification_needed: false,
  clarification_question: null, detected_language: 'english',
};

interface Sent { host: string; url: string; headers: Record<string, string> }

function fakeInternet() {
  const sent: Sent[] = [];
  const fetchImpl = async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    sent.push({ host: url.host, url: input, headers });
    switch (url.host) {
      case 'generativelanguage.googleapis.com':
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(intent) }] }, finishReason: 'STOP' }] });
      case 'places.googleapis.com':
        return Response.json({ places: [{ id: 'ChIJkey', displayName: { text: 'G-13 Plumbers' }, location: { latitude: 33.657, longitude: 73.015 }, businessStatus: 'OPERATIONAL', rating: 4.4, userRatingCount: 30 }] });
      case 'nominatim.openstreetmap.org':
        return Response.json([{ lat: '33.6557', lon: '73.0138', display_name: 'G-13, Islamabad, Pakistan' }]);
      default:
        throw new TypeError(`unexpected host ${url.host}`);
    }
  };
  return { sent, fetch: fetchImpl };
}

const keysIn = (s: Sent) => [GEMINI_KEY, MAPS_KEY].filter((k) => s.url.includes(k) || Object.values(s.headers).some((v) => v.includes(k)));

describe('GEMINI_API_KEY and GOOGLE_MAPS_API_KEY stay apart', () => {
  it('a chat message: Gemini gets only the Gemini key, Places only the Maps key, OSM neither', async () => {
    const net = fakeInternet();
    const logs: LogRecord[] = [];
    const app = createApp({ env: { GEMINI_API_KEY: GEMINI_KEY, GOOGLE_MAPS_API_KEY: MAPS_KEY }, fetch: net.fetch, logSink: (r) => logs.push(r) });
    const res = await app.proxy({ endpoint: 'khadmat-intent', raw_message: 'I need a plumber in G-13 Islamabad now', source: 'home' }, { requestId: 'req-keys' });

    const body = res.body as any;
    expect(body).toMatchObject({ intent_source: 'gemini', matching_result: { data_source: 'google_places' } });
    expect(net.sent.map((s) => s.host)).toEqual(['generativelanguage.googleapis.com', 'nominatim.openstreetmap.org', 'places.googleapis.com']);

    const gemini = net.sent.filter((s) => s.host === 'generativelanguage.googleapis.com');
    const places = net.sent.filter((s) => s.host === 'places.googleapis.com');
    expect(gemini.every((s) => s.headers['x-goog-api-key'] === GEMINI_KEY && !s.url.includes('key='))).toBe(true);
    expect(places.every((s) => s.headers['x-goog-api-key'] === MAPS_KEY && !s.url.includes('key='))).toBe(true);
    for (const s of net.sent) {
      const expected = s.host === 'generativelanguage.googleapis.com' ? [GEMINI_KEY] : s.host === 'places.googleapis.com' ? [MAPS_KEY] : [];
      expect(keysIn(s), s.host).toEqual(expected);
    }
    expect(JSON.stringify(logs)).not.toContain(GEMINI_KEY);
    expect(JSON.stringify(logs)).not.toContain(MAPS_KEY);
  });

  it('only the Gemini key set: Places is never called (no borrowing the other key)', async () => {
    const net = fakeInternet();
    // No Overpass in this fake: OSM fails, which is fine; the point is which hosts are tried.
    await createApp({ env: { GEMINI_API_KEY: GEMINI_KEY }, fetch: net.fetch, logSink: () => {} })
      .proxy({ endpoint: 'khadmat-provider-match', services: ['plumber'], service_type: 'plumber', location: 'G-13, Islamabad', job_complexity: 'basic' }, { requestId: null });
    expect(net.sent.map((s) => s.host)).not.toContain('places.googleapis.com');
  });

  it('only the Maps key set: Gemini is never called, the keyword parser runs', async () => {
    const net = fakeInternet();
    const res = await createApp({ env: { GOOGLE_MAPS_API_KEY: MAPS_KEY }, fetch: net.fetch, logSink: () => {} })
      .proxy({ endpoint: 'khadmat-intent', raw_message: 'I need a plumber in G-13 Islamabad now', source: 'home' }, { requestId: null });
    expect(net.sent.map((s) => s.host)).not.toContain('generativelanguage.googleapis.com');
    expect((res.body as any).intent_source).toBe('keyword_fallback');
    expect(net.sent.find((s) => s.host === 'places.googleapis.com')?.headers['x-goog-api-key']).toBe(MAPS_KEY);
  });
});
