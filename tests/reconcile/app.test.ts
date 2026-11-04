import { describe, expect, it } from 'vitest';
import { createApp } from '../../lib/app';
import type { EmailMessage } from '../../lib/email/types';
import type { LogRecord } from '../../lib/log';

// app.reconcile with the real repository, resilience and recorder; only HTTP
// (PostgREST) and the mailer are fake.

const env = {
  SUPABASE_URL: 'https://project.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-not-real',
  ALERT_EMAIL: 'owner@example.test',
};

type Row = Record<string, unknown>;

function fakePostgrest(bookings: Row[], { failFirstRead = false } = {}) {
  const incidents: Row[] = [];
  const calls: string[] = [];
  let reads = 0;
  const fetchImpl = async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const table = url.pathname.replace('/rest/v1/', '');
    calls.push(`${init.method} ${table}`);
    if (table === 'workflow_incidents') {
      if (init.method === 'POST') { incidents.push(JSON.parse(init.body as string)); return new Response(null, { status: 201 }); }
      return Response.json([]);
    }
    if (init.method === 'GET') {
      if (failFirstRead && reads++ === 0) return new Response('', { status: 503 });
      return Response.json(bookings.filter((b) => b.status === 'confirmed' && !b.confirmation_sent_at));
    }
    if (init.method === 'PATCH') {
      const id = url.searchParams.get('booking_id')!.slice(3);
      for (const b of bookings) if (b.booking_id === id && !b.confirmation_sent_at) Object.assign(b, JSON.parse(init.body as string));
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected ${init.method} ${table}`);
  };
  return { incidents, calls, fetch: fetchImpl };
}

const due = (id: string): Row => ({
  booking_id: id, status: 'confirmed', user_name: 'Customer', user_email: 'customer@gmail.com', service_type: 'plumber',
  provider_id: 'osm:node/1', provider_name: 'Ali Plumbing', location: 'G-13, Islamabad', slot: '16:00',
  booking_date: '2026-11-10', price_pkr: 900, created_at: new Date(Date.now() - 30 * 60_000).toISOString(),
});

function mailer(fail = false) {
  const sent: EmailMessage[] = [];
  return { sent, send: async (m: EmailMessage) => { if (fail && !m.subject.startsWith('[GharFix alert]')) throw new Error('Connection timeout'); sent.push(m); } };
}

describe('app.reconcile', () => {
  it('re-sends, marks the booking, and a repeat run does nothing', async () => {
    const pg = fakePostgrest([due('BK-TEST-R1')]);
    const mail = mailer();
    const app = createApp({ env, fetch: pg.fetch, email: mail, logSink: () => {} });

    expect(await app.reconcile('req-r1')).toEqual({ found: 1, fixed: 1, failed: 0, skipped: 0, deferred: 0 });
    expect(await app.reconcile('req-r2')).toEqual({ found: 0, fixed: 0, failed: 0, skipped: 0, deferred: 0 });
    expect(mail.sent.map((m) => m.to)).toEqual(['customer@gmail.com']);
    expect(pg.calls.filter((c) => c === 'PATCH bookings')).toHaveLength(1);
  });

  it('retries the bookings read (auto_fixed incident), never the send', async () => {
    const pg = fakePostgrest([due('BK-TEST-R2')], { failFirstRead: true });
    const app = createApp({ env, fetch: pg.fetch, email: mailer(), logSink: () => {} });
    expect(await app.reconcile(null)).toMatchObject({ fixed: 1 });
    expect(pg.incidents).toEqual([expect.objectContaining({ workflow: 'reconcile', step: 'supabase.findUnconfirmed', auto_fixed: true })]);
  });

  it('records a failed send and alerts ALERT_EMAIL once; the booking stays unsent for the next run', async () => {
    const bookings = [due('BK-TEST-R3'), due('BK-TEST-R4')];
    const pg = fakePostgrest(bookings);
    const mail = mailer(true);
    const logs: LogRecord[] = [];
    const app = createApp({ env, fetch: pg.fetch, email: mail, logSink: (r) => logs.push(r) });

    expect(await app.reconcile('req-r3')).toMatchObject({ found: 2, fixed: 0, failed: 2 });
    expect(pg.incidents).toEqual([
      expect.objectContaining({ workflow: 'reconcile', step: 'smtp.send', auto_fixed: false }),
      expect.objectContaining({ workflow: 'reconcile', step: 'smtp.send', auto_fixed: false }),
    ]);
    const alerts = mail.sent.filter((m) => m.to === 'owner@example.test');
    expect(alerts).toHaveLength(1); // two failures, one alert
    expect(alerts[0].text).toMatch(/What you need to do: The email could not be sent/);
    expect(bookings.every((b) => !b.confirmation_sent_at)).toBe(true);
    expect(JSON.stringify(logs)).not.toContain('customer@gmail.com');
  });
});
