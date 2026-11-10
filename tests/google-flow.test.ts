import { describe, expect, it } from 'vitest';
import { createApp } from '../lib/app';
import { GOOGLE_NOTE, NO_PROVIDERS_TEXT, OSM_NOTE } from '../lib/matching/handler';
import type { EmailMessage } from '../lib/email/types';
import type { LogRecord } from '../lib/log';
import { adviceFor } from '../lib/resilience/alerts';
import { transformMatchData } from '../src/lib/transformer';

// GOOGLE_MAPS_API_KEY through /api/proxy with only HTTP faked: Google Places
// first, OpenStreetMap when Google fails, demo data (flag on) when both fail.
// No real Google request is made here.

const KEY = 'fake-google-key-for-tests';
type Mode = 'results' | 'empty' | 'down';

function fakeInternet(google: Mode | 403, overpass: Mode) {
  const hosts: string[] = [];
  const fetchImpl = async (input: string, init?: RequestInit) => {
    const host = new URL(input).host;
    hosts.push(host);
    if (host === 'nominatim.openstreetmap.org') return Response.json([{ lat: '33.6557', lon: '73.0138', display_name: 'G-13, Islamabad, Pakistan' }]);
    if (host === 'places.googleapis.com') {
      expect((init?.headers as Record<string, string>)['X-Goog-Api-Key']).toBe(KEY);
      if (google === 403) return Response.json({ error: { code: 403, status: 'PERMISSION_DENIED' } }, { status: 403 });
      if (google === 'down') return new Response('', { status: 503 });
      return Response.json(google === 'empty' ? {} : { places: [{
        id: 'ChIJtest', displayName: { text: 'Real G-13 Plumbing Services' }, formattedAddress: 'Street 5, G-13/2, Islamabad',
        location: { latitude: 33.657, longitude: 73.015 }, businessStatus: 'OPERATIONAL', googleMapsUri: 'https://maps.google.com/?cid=1',
        rating: 4.7, userRatingCount: 128, priceLevel: 'PRICE_LEVEL_MODERATE', currentOpeningHours: { openNow: true },
      }] });
    }
    if (host === 'overpass-api.de' || host === 'overpass.kumi.systems') {
      if (overpass === 'down') return new Response('', { status: 504 });
      return Response.json({ elements: overpass === 'empty' ? [] : [{ type: 'node', id: 7, lat: 33.657, lon: 73.015, tags: { name: 'OSM G-13 Plumbers', craft: 'plumber' } }] });
    }
    throw new TypeError(`unexpected host ${host}`);
  };
  return { hosts, fetch: fetchImpl };
}

const match = { endpoint: 'khadmat-provider-match', services: ['plumber'], service_type: 'plumber', location: 'G-13, Islamabad', job_complexity: 'basic', budget_sensitivity: 'medium' };

async function run(google: Mode | 403, overpass: Mode, env: Record<string, string> = { GOOGLE_MAPS_API_KEY: KEY }) {
  const net = fakeInternet(google, overpass);
  const logs: LogRecord[] = [];
  // Alerts go to ALERT_EMAIL through this sender, so a test can see whether one went out.
  const alerts: EmailMessage[] = [];
  const email = { send: async (m: EmailMessage) => { alerts.push(m); } };
  const res = await createApp({ env: { ALERT_EMAIL: 'owner@example.test', ...env }, fetch: net.fetch, email, logSink: (r) => logs.push(r) }).proxy(match, { requestId: null });
  // This env has no Supabase, so the capacity read records (and alerts) its own incident: look at Google's only.
  const googleIncidents = logs.filter((r) => r.event === 'incident.recorded' && r.step === 'google.searchText');
  const googleAlerts = alerts.filter((m) => m.subject.includes('Google Places'));
  return { res, body: res.body as any, logs, hosts: net.hosts, googleIncidents, googleAlerts };
}

describe('khadmat-provider-match with GOOGLE_MAPS_API_KEY', () => {
  it('uses Google Places, with its real rating, reviews and price, and never asks OpenStreetMap', async () => {
    const { res, body, hosts, logs } = await run('results', 'results');
    expect(res.status).toBe(200);
    expect(hosts).not.toContain('overpass-api.de');
    expect(body.data_source).toBe('google_places');
    expect(body.data_notes).toMatchObject({ note: GOOGLE_NOTE, geocoder: 'openstreetmap_nominatim' });
    expect(body.services[0].provider).toMatchObject({
      id: 'google:ChIJtest', name: 'Real G-13 Plumbing Services', source: 'google_places', rating: 4.7, review_count: 128,
      base_rate_pkr: 900, base_rate_source: 'google_price_level', verified: true, google_maps_url: 'https://maps.google.com/?cid=1',
    });
    expect(JSON.stringify(logs)).not.toContain(KEY);

    const ui = transformMatchData(body);
    expect(ui.is_demo).toBe(false);
    expect(ui.top_provider_card).toMatchObject({ rating: 4.7, source: 'google_places' });
  });

  it.each([
    // 403: bad key / billing / API not enabled. OpenStreetMap served the customer, but this needs a person: alert.
    [403, { auto_fixed: false, retryable: false, alerts: 1 }],
    // 503: temporary. OpenStreetMap served the customer and it clears by itself: fixed, no alert.
    ['down', { auto_fixed: true, retryable: true, alerts: 0 }],
  ] as const)('Google %s: answers from OpenStreetMap, one incident, auto_fixed per cause', async (mode, expected) => {
    const { res, body, hosts, logs, googleIncidents, googleAlerts: alerts } = await run(mode, 'results');
    expect(res.status).toBe(200);
    expect(hosts).toContain('overpass-api.de');
    expect(body.data_source).toBe('openstreetmap');
    expect(body.data_notes.note).toBe(OSM_NOTE);
    expect(body.services[0].provider).toMatchObject({ name: 'OSM G-13 Plumbers', rating: null });
    expect(googleIncidents).toEqual([expect.objectContaining({ auto_fixed: expected.auto_fixed, retryable: expected.retryable })]);
    expect(alerts).toHaveLength(expected.alerts);
    if (expected.alerts) expect(alerts[0].text).toContain('will not clear by itself');
    expect(logs.map((r) => r.event)).toContain('match.directory_fallback_used');
    expect(JSON.stringify(logs)).not.toContain(KEY);
    expect(JSON.stringify(alerts)).not.toContain(KEY);
  });

  it('GOOGLE_PLACES_FAULT=503 makes Google fail on purpose: OpenStreetMap serves, auto_fixed, no alert, no Google call', async () => {
    const { res, body, hosts, logs, googleIncidents, googleAlerts } = await run('results', 'results', { GOOGLE_MAPS_API_KEY: KEY, GOOGLE_PLACES_FAULT: '503' });
    expect(res.status).toBe(200);
    expect(body.data_source).toBe('openstreetmap');
    expect(hosts).not.toContain('places.googleapis.com');
    expect(logs.find((r) => r.event === 'google.fault_injected')).toMatchObject({ level: 'warn', fault: '503' });
    expect(googleIncidents).toEqual([expect.objectContaining({ error_class: 'MapsUnavailableError:directory:503', auto_fixed: true, retryable: true })]);
    expect(googleAlerts).toEqual([]);
  });

  it('GOOGLE_PLACES_FAULT=timeout is recorded as a timeout, also fixed by OpenStreetMap', async () => {
    const { body, googleIncidents, googleAlerts } = await run('results', 'results', { GOOGLE_MAPS_API_KEY: KEY, GOOGLE_PLACES_FAULT: 'timeout' });
    expect(body.data_source).toBe('openstreetmap');
    expect(googleIncidents).toEqual([expect.objectContaining({ error_class: 'MapsUnavailableError:directory:timeout', auto_fixed: true })]);
    expect(googleAlerts).toEqual([]);
  });

  it.each([['true'], ['TIMEOUT'], [' 503'], ['500'], ['']])('GOOGLE_PLACES_FAULT=%j does nothing: Google answers as normal', async (fault) => {
    const { body, hosts, logs, googleIncidents } = await run('results', 'results', { GOOGLE_MAPS_API_KEY: KEY, GOOGLE_PLACES_FAULT: fault });
    expect(body.data_source).toBe('google_places');
    expect(hosts).toContain('places.googleapis.com');
    expect(logs.map((r) => r.event)).not.toContain('google.fault_injected');
    expect(googleIncidents).toEqual([]);
  });

  it('Google answers zero places: that is the answer (no OpenStreetMap call)', async () => {
    const { body, hosts } = await run('empty', 'results');
    expect(hosts).not.toContain('overpass-api.de');
    expect(body).toBe(NO_PROVIDERS_TEXT);
  });

  it('Google and OpenStreetMap both down, flag off: 503 with both incidents', async () => {
    const { res, logs } = await run('down', 'down');
    expect(res.status).toBe(503);
    const steps = logs.filter((r) => r.event === 'incident.recorded').map((r) => r.step);
    expect(steps).toEqual(expect.arrayContaining(['google.searchText', 'osm.searchNearby']));
  });

  it('both down, USE_DEMO_PROVIDERS=1: labelled demo providers', async () => {
    const { res, body } = await run('down', 'down', { GOOGLE_MAPS_API_KEY: KEY, USE_DEMO_PROVIDERS: '1' });
    expect(res.status).toBe(200);
    expect(body.data_source).toBe('demo_seed');
    expect(body.data_notes.demo_reason).toBe('osm_unavailable');
  });

  it('without the key nothing calls Google', async () => {
    const { body, hosts } = await run('results', 'results', {});
    expect(hosts).not.toContain('places.googleapis.com');
    expect(body.data_source).toBe('openstreetmap');
  });

  it('the alert email says what to check for a Google failure', () => {
    expect(adviceFor({ step: 'google.searchText', error_class: 'MapsUnavailableError' })).toMatch(/GOOGLE_MAPS_API_KEY.*billing/s);
  });
});
