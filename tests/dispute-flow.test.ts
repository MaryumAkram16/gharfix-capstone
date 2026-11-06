import { describe, expect, it } from 'vitest';
import { createApp } from '../lib/app';
import type { EmailMessage } from '../lib/email/types';
import type { LogRecord } from '../lib/log';

// khadmat-dispute through /api/proxy with only HTTP faked: a tiny PostgREST
// that understands the filters lib/booking/records.ts sends.

const env = { SUPABASE_URL: 'https://project.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-not-real' };

function fakeSupabase(row: Record<string, unknown>, opts: { patchStatus?: number } = {}) {
  const requests: Array<{ method: string; url: URL; body: any; headers: Record<string, string> }> = [];
  const fetchImpl = async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method: String(init.method), url, body, headers: init.headers as Record<string, string> });
    if (url.pathname === '/rest/v1/workflow_incidents') return new Response('', { status: 201 });
    if (url.pathname !== '/rest/v1/bookings') throw new TypeError(`unexpected ${url}`);
    const id = url.searchParams.get('booking_id');
    const matches = id === `eq.${row.booking_id}`;
    if (init.method === 'GET') return Response.json(matches ? [row] : []);
    if (init.method === 'PATCH') {
      if (opts.patchStatus) return new Response('{}', { status: opts.patchStatus });
      const cas = url.searchParams.get('status');
      if (!matches || (cas && cas !== `in.("${row.status}")`)) return Response.json([]);
      Object.assign(row, body);
      return Response.json([row]);
    }
    throw new TypeError(`unexpected ${init.method}`);
  };
  return { requests, fetch: fetchImpl };
}

const booking = () => ({
  booking_id: 'BK-TEST-77', status: 'confirmed', user_name: 'Test User', user_email: 'customer@example.test', service_type: 'plumber',
  provider_id: 'osm:node/1', provider_name: 'Ali Plumbers', location: 'G-13', slot: '16:00', booking_date: '2026-11-06',
  price_pkr: 1800, final_price_pkr: 2400, customer_rating: null, feedback_sentiment: null,
});

function app(fetchImpl: any) {
  const sent: EmailMessage[] = [];
  const logs: LogRecord[] = [];
  const a = createApp({ env, fetch: fetchImpl, email: { send: async (m) => { sent.push(m); } }, logSink: (r) => logs.push(r) });
  return { a, sent, logs };
}

describe('khadmat-dispute through /api/proxy', () => {
  it('price dispute: reads the booking, decides from its own prices, compare-and-sets the status, emails', async () => {
    const row = booking();
    const net = fakeSupabase(row);
    const { a, sent } = app(net.fetch);
    const res = await a.proxy({ endpoint: 'khadmat-dispute', dispute_type: 'price_disagreement', booking_id: 'BK-TEST-77', user_email: 'customer@example.test', price_pkr: 1, charged_price_pkr: 99999 }, { requestId: 'req-d' });

    expect(res.status).toBe(200);
    // Quoted 1800 and final 2400 from the row (33.3% over): full excess refund of 600.
    expect(res.body).toMatchObject({ status: 'dispute_resolved', price_analysis: { quoted_pkr: 1800, charged_pkr: 2400, decision: 'FULL_EXCESS_REFUND' }, resolution: { refund: { amount_pkr: 600 } } });
    const patch = net.requests.find((r) => r.method === 'PATCH')!;
    expect(patch.url.searchParams.get('booking_id')).toBe('eq.BK-TEST-77');
    expect(patch.url.searchParams.get('status')).toBe('in.("confirmed")');
    expect(patch.body).toMatchObject({ status: 'price_disputed', previous_status: 'confirmed', flagged_for_review: true });
    expect(patch.headers.Prefer).toBe('return=representation');
    expect(row.status).toBe('price_disputed');
    expect(sent.map((m) => m.to)).toEqual(['customer@example.test']);
  });

  it('a failed update is answered 503 and recorded as an incident', async () => {
    const net = fakeSupabase(booking(), { patchStatus: 503 });
    const { a, logs, sent } = app(net.fetch);
    const res = await a.proxy({ endpoint: 'khadmat-dispute', booking_id: 'BK-TEST-77', user_email: 'customer@example.test', rating: 2 }, { requestId: 'req-e' });
    expect(res.status).toBe(503);
    expect(logs.find((r) => r.event === 'incident.recorded')).toMatchObject({ workflow: 'khadmat-dispute', step: 'supabase.updateBooking', auto_fixed: false });
    expect(net.requests.filter((r) => r.method === 'PATCH')).toHaveLength(1); // not retried
    expect(sent).toEqual([]);
  });

  it('without Supabase configured: 500 and a config incident, not an n8n forward', async () => {
    const logs: LogRecord[] = [];
    const res = await createApp({ env: {}, logSink: (r) => logs.push(r) }).proxy({ endpoint: 'khadmat-dispute', booking_id: 'BK-TEST-77' }, { requestId: null });
    expect(res.status).toBe(500);
    expect(logs.find((r) => r.event === 'incident.recorded')).toMatchObject({ workflow: 'khadmat-dispute', step: 'config' });
  });
});
