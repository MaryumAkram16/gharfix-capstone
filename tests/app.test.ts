import { describe, expect, it } from 'vitest';
import { createApp } from '../lib/app';
import type { LogRecord } from '../lib/log';

// The whole server path with only HTTP faked: createApp -> proxy -> booking
// handler -> real Supabase repository -> a fake PostgREST.

const env = {
  SUPABASE_URL: 'https://project.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-not-real',
};

interface Row { [k: string]: unknown }

/** Minimal PostgREST: GET filters by provider_id/booking_date/idempotency_key; POST enforces the slot index. */
function fakePostgrest() {
  const rows: Row[] = [];
  const calls: string[] = [];
  const fetchImpl = async (input: string, init: RequestInit) => {
    const url = new URL(input);
    calls.push(`${init.method} ${url.pathname}`);
    if (init.method === 'GET') {
      const key = url.searchParams.get('idempotency_key');
      const provider = url.searchParams.get('provider_id');
      const found = rows.filter((r) =>
        key ? `eq.${r.idempotency_key}` === key : `eq.${r.provider_id}` === provider && url.searchParams.get('booking_date')!.includes(String(r.booking_date)),
      );
      return Response.json(found);
    }
    const row = JSON.parse(init.body as string) as Row;
    if (rows.some((r) => r.provider_id === row.provider_id && r.booking_date === row.booking_date && r.slot === row.slot)) {
      return Response.json({ code: '23505', message: 'duplicate key value violates unique constraint "bookings_active_slot_key"' }, { status: 409 });
    }
    rows.push(row);
    return Response.json([row], { status: 201 });
  };
  return { rows, calls, fetch: fetchImpl };
}

const confirm = {
  endpoint: 'khadmat-booking',
  action: 'confirm',
  provider_id: 'ChIJ-test-provider',
  provider_name: 'Ali AC Services',
  service_type: 'AC Repair',
  location: 'DHA Phase 5, Lahore',
  price_pkr: 2500,
  slot: '4:00 PM',
  booking_date: '2026-11-10',
  user_name: 'Test User',
  user_email: 'booking-test@example.test',
  idempotency_key: 'idem-test-app-0001',
};

describe('createApp', () => {
  it('books through /api/proxy end to end, then replays and refuses the same slot', async () => {
    const pg = fakePostgrest();
    const logs: LogRecord[] = [];
    const sent: string[] = [];
    const app = createApp({ env, fetch: pg.fetch, logSink: (r) => logs.push(r), email: { send: async (m) => { sent.push(m.to); } } });

    const first = await app.proxy(confirm, { requestId: 'req-1' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: 'confirmed', appointment: { time: '16:00' }, replayed: false });
    expect(pg.rows).toHaveLength(1);
    expect(pg.rows[0]).toMatchObject({ slot: '16:00', idempotency_key: 'idem-test-app-0001' });
    expect(sent).toEqual(['booking-test@example.test']);

    const replay = await app.proxy(confirm, { requestId: 'req-2' });
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ booking_id: (first.body as Row).booking_id, replayed: true });

    const other = await app.proxy({ ...confirm, idempotency_key: 'idem-test-app-0002', user_email: 'other@example.test' }, { requestId: 'req-3' });
    expect(other.status).toBe(409);
    expect(other.body).toMatchObject({ status: 'slot_taken' });

    expect(pg.rows).toHaveLength(1);
    expect(logs.find((r) => r.event === 'booking.confirmed')).toMatchObject({ fn: 'khadmat-booking', request_id: 'req-1' });
    expect(JSON.stringify(logs)).not.toContain(env.SUPABASE_SERVICE_ROLE_KEY);
  });

  it('answers 500 and names the missing variable in the log when Supabase is not configured', async () => {
    const logs: LogRecord[] = [];
    const app = createApp({ env: {}, logSink: (r) => logs.push(r) });
    const res = await app.proxy(confirm, { requestId: null });
    expect(res).toEqual({ status: 500, body: { status: 'internal_error', message: 'Something went wrong. Please try again.' } });
    expect(logs[0]).toMatchObject({ event: 'booking.config_error' });
    expect(JSON.stringify(logs[0])).toContain('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  });

  it('only forwards to n8n when N8N_WEBHOOK_BASE_URL is set', async () => {
    const seen: string[] = [];
    const fetchImpl = async (input: string) => { seen.push(input); return Response.json({ status: 'success' }); };

    const withoutN8n = createApp({ env, fetch: fetchImpl, logSink: () => {} });
    expect((await withoutN8n.proxy({ endpoint: 'khadmat-intent' }, { requestId: null })).status).toBe(503);
    expect(seen).toEqual([]);

    const withN8n = createApp({ env: { ...env, N8N_WEBHOOK_BASE_URL: 'https://n8n.test/webhook' }, fetch: fetchImpl, logSink: () => {} });
    expect((await withN8n.proxy({ endpoint: 'khadmat-intent' }, { requestId: null })).status).toBe(200);
    expect(seen).toEqual(['https://n8n.test/webhook/khadmat-intent']);
  });

  it('uses the console email fallback when GMAIL_* is not set, and the booking still confirms', async () => {
    const pg = fakePostgrest();
    const logs: LogRecord[] = [];
    const app = createApp({ env, fetch: pg.fetch, logSink: (r) => logs.push(r) });

    const res = await app.proxy(confirm, { requestId: 'req-email' });

    expect(res.status).toBe(200);
    expect(logs.map((r) => r.event)).toEqual(['email.sender', 'booking.confirmed', 'email.console', 'booking.email_sent']);
    const bookingId = (res.body as Row).booking_id as string;
    // The sender is built once per instance, so its own line is tied to the request by booking id;
    // the handler's email_sent line carries the request id.
    expect(logs.find((r) => r.event === 'email.console')).toMatchObject({ to: 'b***@example.test', subject: expect.stringContaining(bookingId) });
    expect(logs.find((r) => r.event === 'booking.email_sent')).toMatchObject({ booking_id: bookingId, request_id: 'req-email' });
  });
});
