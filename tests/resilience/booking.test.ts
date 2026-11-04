import { beforeEach, describe, expect, it } from 'vitest';
import { createBookingRoute, type BookingDepsOptions } from '../../lib/booking/deps';
import type { BookingDeps } from '../../lib/booking/handler';
import { RepositoryError } from '../../lib/booking/repository';
import { memoryLogger } from '../../lib/log';
import { createIncidentRecorder } from '../../lib/resilience/recorder';
import { FakeBookingDb, FakeEmail } from '../fakes/bookingDb';
import { FakeAlertSender, FakeIncidentStore } from '../fakes/resilience';

// The booking route with lib/resilience wired in, as createApp does it, on
// fake dependencies. Retries use real (short) waits here.

const NOW = new Date('2026-11-04T09:00:00Z');
const body = {
  action: 'confirm', provider_id: 'osm:node/1', provider_name: 'Ali Plumbing', service_type: 'plumber',
  location: 'G-13, Islamabad', price_pkr: 900, slot: '16:00', booking_date: '2026-11-10',
  user_name: 'Test User', user_email: 'booking-test@example.test',
};

let db: FakeBookingDb;
let email: FakeEmail;
let store: FakeIncidentStore;
let alerts: FakeAlertSender;
let log: ReturnType<typeof memoryLogger>;
let route: ReturnType<typeof createBookingRoute>;

beforeEach(() => {
  db = new FakeBookingDb();
  email = new FakeEmail();
  store = new FakeIncidentStore(() => NOW);
  alerts = new FakeAlertSender();
  log = memoryLogger();
  let n = 0;
  const deps: BookingDeps = { db, email, log, now: () => NOW, newBookingId: () => `BK-TEST-${String(++n).padStart(4, '0')}` };
  const recorder = createIncidentRecorder({ store, alertSender: alerts, alertTo: 'owner@example.test', log, now: () => NOW, timeoutMs: 500 });
  const opts: BookingDepsOptions = { env: {}, log, recorder };
  route = createBookingRoute(opts, () => deps);
});

const call = (b: Record<string, unknown> = body) => route(b, { requestId: 'req-1' });

describe('booking with lib/resilience', () => {
  it('a Supabase read that fails once is retried, the booking succeeds, and auto_fixed is logged', async () => {
    let n = 0;
    db.failWhen = (op) => op === 'bookedSlots' && ++n === 1;
    const res = await call();
    expect(res.status).toBe(200);
    expect(db.calls.filter((c) => c === 'bookedSlots')).toHaveLength(2);
    expect(store.rows).toEqual([expect.objectContaining({ step: 'supabase.bookedSlots', auto_fixed: true, request_id: 'req-1' })]);
    expect(alerts.sent).toEqual([]);
  });

  it('Supabase down: 503 to the customer, one incident, one alert; a second failure is not alerted again', async () => {
    db.goDown();
    expect((await call()).status).toBe(503);
    expect((await call()).status).toBe(503);
    expect(store.rows.filter((r) => !r.auto_fixed)).toHaveLength(2);
    expect(alerts.sent).toHaveLength(1);
    expect(alerts.sent[0].text).toMatch(/What you need to do: Supabase did not answer/);
  });

  it('an insert without an idempotency key is never retried', async () => {
    db.failWhen = (op) => op === 'insert';
    expect((await call()).status).toBe(503);
    expect(db.calls.filter((c) => c === 'insert')).toHaveLength(1);
    expect(db.rows).toHaveLength(0);
  });

  it('a keyed insert that timed out after committing is retried and ends in a replay: one row, same answer', async () => {
    const realInsert = db.insert.bind(db);
    let n = 0;
    db.insert = async (row) => {
      if (++n === 1) { db.insertNow(row); throw new RepositoryError('unavailable', 'Supabase POST timed out'); }
      return realInsert(row);
    };
    const res = await call({ ...body, idempotency_key: 'idem-test-ambiguous-01' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ booking_id: 'BK-TEST-0001', replayed: true });
    expect(db.rows).toHaveLength(1);
    expect(store.rows).toEqual([expect.objectContaining({ step: 'supabase.insert', auto_fixed: true })]);
  });

  it('a failed alert email never breaks the booking', async () => {
    // SMTP is down for both the confirmation and the alert (one mailer in production).
    email.behaviour = 'fail';
    alerts.behaviour = 'fail';
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'confirmed', booking_id: 'BK-TEST-0001' });
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].confirmation_sent_at).toBeUndefined(); // left for the reconciler
    expect(store.rows).toEqual([expect.objectContaining({ step: 'smtp.send', auto_fixed: false })]);
    expect(log.records.map((r) => r.event)).toEqual(expect.arrayContaining(['booking.email_failed', 'incident.alert_failed']));
  });

  it('SMTP is never retried: one send attempt, then the reconciler takes over', async () => {
    let sends = 0;
    email.send = async () => { sends++; throw new Error('Greeting never received'); };
    await call();
    expect(sends).toBe(1);
  });

  it('records the incident with no secrets and a masked email in the alert', async () => {
    email.behaviour = 'fail'; // FakeEmail's error message contains booking-test@example.test
    await call();
    const everything = JSON.stringify({ incidents: store.rows, alerts: alerts.sent, logs: log.records });
    expect(everything).not.toContain('booking-test@example.test');
    expect(alerts.sent[0].text).toContain('b***@example.test');
  });
});
