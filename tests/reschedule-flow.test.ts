import { describe, expect, it } from 'vitest';
import { createApp } from '../lib/app';
import type { EmailMessage } from '../lib/email/types';

// khadmat-reschedule through /api/proxy, only HTTP faked. The replacement is
// booked by the real khadmat-booking route in-process, against a PostgREST
// stand-in holding bookings and the waitlist.

const env = { SUPABASE_URL: 'https://project.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-not-real' };

function fakeSupabase(rows: Array<Record<string, any>>) {
  const waitlist: any[] = [];
  const eq = (p: URLSearchParams, k: string, row: Record<string, any>) => {
    const v = p.get(k);
    if (!v) return true;
    if (v.startsWith('eq.')) return String(row[k]) === v.slice(3);
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map((x) => JSON.parse(x)).includes(row[k]);
    if (v === 'is.null') return row[k] == null;
    return false;
  };
  const filter = (p: URLSearchParams) => rows.filter((r) => ['booking_id', 'provider_id', 'idempotency_key', 'booking_date', 'status', 'current_status'].every((k) => eq(p, k, r)));
  const fetchImpl = async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const p = url.searchParams;
    if (url.pathname === '/rest/v1/workflow_incidents') return new Response('', { status: 201 });
    if (url.pathname === '/rest/v1/waitlist') { waitlist.push(JSON.parse(String(init.body))); return new Response('', { status: 201 }); }
    if (init.method === 'GET') return Response.json(filter(p));
    if (init.method === 'POST') { const row = JSON.parse(String(init.body)); rows.push(row); return Response.json([row], { status: 201 }); }
    const hit = filter(p);
    for (const r of hit) Object.assign(r, JSON.parse(String(init.body)));
    return Response.json(hit);
  };
  return { waitlist, fetch: fetchImpl };
}

describe('khadmat-reschedule through /api/proxy', () => {
  it('reschedules to the best alternative through the real booking route', async () => {
    const rows: Array<Record<string, any>> = [{
      booking_id: 'BK-TEST-90', status: 'confirmed', user_name: 'Test', user_email: 'customer@example.test', service_type: 'plumber',
      provider_id: 'osm:node/1', provider_name: 'Ali Plumbers', location: 'G-13', slot: '16:00', booking_date: '2099-01-05', price_pkr: 2000,
    }];
    const net = fakeSupabase(rows);
    const sent: EmailMessage[] = [];
    const app = createApp({ env, fetch: net.fetch, email: { send: async (m) => { sent.push(m); } }, logSink: () => {} });
    const res = await app.proxy({
      endpoint: 'khadmat-reschedule', action: 'reschedule', booking_id: 'BK-TEST-90', user_email: 'customer@example.test',
      alternatives: [{ id: 'osm:node/2', name: 'Bilal Plumbing', computed_score: 80, availability_slots: ['09:00', '16:00'] }],
    }, { requestId: 'req-r' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'rescheduled', new_booking: { provider_id: 'osm:node/2', slot: '16:00', date: '2099-01-05' } });
    const created = rows.find((r) => r.idempotency_key === 'reschedule-BK-TEST-90');
    expect(created).toMatchObject({ provider_id: 'osm:node/2', status: 'confirmed', price_pkr: 2000 });
    expect(rows[0]).toMatchObject({ status: 'rescheduled', rescheduled_to_booking_id: created!.booking_id });
    expect(sent.map((m) => m.to)).toEqual(['customer@example.test', 'customer@example.test']);

    // The same request again: answered from the record, nothing new inserted.
    const again = await app.proxy({ endpoint: 'khadmat-reschedule', booking_id: 'BK-TEST-90', user_email: 'customer@example.test' }, { requestId: 'req-r2' });
    expect(again.body).toMatchObject({ status: 'rescheduled', already_recorded: true });
    expect(rows).toHaveLength(2);
  });

  it('no alternatives: the customer is put on the waitlist table', async () => {
    const rows: Array<Record<string, any>> = [{ booking_id: 'BK-TEST-91', status: 'confirmed', user_email: 'customer@example.test', provider_id: 'osm:node/1', provider_name: 'Ali', service_type: 'plumber', location: 'G-13', slot: '16:00', booking_date: '2099-01-05', price_pkr: 1500 }];
    const net = fakeSupabase(rows);
    const app = createApp({ env, fetch: net.fetch, email: { send: async () => {} }, logSink: () => {} });
    const res = await app.proxy({ endpoint: 'khadmat-reschedule', booking_id: 'BK-TEST-91', user_email: 'customer@example.test' }, { requestId: null });
    expect(res.body).toMatchObject({ status: 'no_alternative_available' });
    expect(net.waitlist).toEqual([expect.objectContaining({ booking_id: 'BK-TEST-91', reason: 'no_alternative_available', price_pkr: 1500, status: 'waiting' })]);
  });
});
