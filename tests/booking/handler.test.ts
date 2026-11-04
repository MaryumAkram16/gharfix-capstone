import { beforeEach, describe, expect, it } from 'vitest';
import { defaultBookingId, handleBookingRequest, requestFingerprint, type BookingDeps } from '../../lib/booking/handler';
import { validateConfirm, type ConfirmRequest } from '../../lib/booking/validate';
import { memoryLogger } from '../../lib/log';
import { FakeBookingDb, FakeEmail } from '../fakes/bookingDb';

const NOW = new Date('2026-11-04T09:00:00.000Z'); // 14:00 in Karachi, 2026-11-04

const confirmBody = {
  action: 'confirm',
  provider_id: 'ChIJ-test-provider',
  provider_name: 'Ali AC Services',
  service_type: 'AC Repair', // 120 min + 30 travel = 150 min block
  location: 'DHA Phase 5, Lahore',
  price_pkr: 2500,
  slot: '4:00 PM',
  booking_date: '2026-11-10',
  user_name: 'Test User',
  user_email: 'booking-test@example.test',
};

let db: FakeBookingDb;
let email: FakeEmail;
let log: ReturnType<typeof memoryLogger>;
let deps: BookingDeps;

beforeEach(() => {
  db = new FakeBookingDb();
  email = new FakeEmail();
  log = memoryLogger();
  let n = 0;
  deps = {
    db,
    email,
    log,
    now: () => NOW,
    newBookingId: () => `BK-TEST-${String(++n).padStart(4, '0')}`,
    emailTimeoutMs: 50,
  };
});

function confirmRequest(body: object): ConfirmRequest {
  const v = validateConfirm(body);
  expect(v.ok).toBe(true);
  return (v as { value: ConfirmRequest }).value;
}

const events = () => log.records.map((r) => r.event);

describe('confirm: success', () => {
  it('stores one booking with a 24h slot, returns the WF4 receipt and sends the email', async () => {
    const res = await handleBookingRequest(confirmBody, deps);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      booking_id: 'BK-TEST-0001',
      status: 'confirmed',
      service: 'AC Repair',
      provider: { id: 'ChIJ-test-provider', name: 'Ali AC Services' },
      appointment: { date: '2026-11-10', time: '16:00', time_label: '4:00 PM', location: 'DHA Phase 5, Lahore' },
      customer: { name: 'Test User', email: 'booking-test@example.test' },
      workflow: 'WF4-StepB',
      created_at: NOW.toISOString(),
    });

    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ booking_id: 'BK-TEST-0001', slot: '16:00', status: 'confirmed', idempotency_key: null });
    expect(email.sent.map((m) => [m.to, m.subject])).toEqual([
      ['booking-test@example.test', 'Your GharFix Booking is Confirmed! (Booking ID: BK-TEST-0001)'],
    ]);
    expect(events()).toEqual(['booking.confirmed', 'booking.email_sent']);
  });

  it('skips the email when the customer left it blank', async () => {
    const res = await handleBookingRequest({ ...confirmBody, user_email: '' }, deps);
    expect(res.status).toBe(200);
    expect(email.sent).toHaveLength(0);
    expect(events()).toContain('booking.email_skipped');
  });
});

describe('confirm: pre-check conflict', () => {
  it('answers 409 slot_taken when an earlier booking still runs into the slot, without inserting', async () => {
    // 15:00 + 150 min block runs to 17:30, so 16:00 is inside its window.
    db.seed({ booking_id: 'BK-TEST-SEED-1', provider_id: 'ChIJ-test-provider', booking_date: '2026-11-10', slot: '3:00 PM' });
    // Tomorrow (Karachi) has 09:00 taken, which also blocks 10:00 and 11:00.
    db.seed({ booking_id: 'BK-TEST-SEED-2', provider_id: 'ChIJ-test-provider', booking_date: '2026-11-05', slot: '09:00' });

    const res = await handleBookingRequest(confirmBody, deps);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      status: 'slot_taken',
      message: 'Yeh slot abhi kisi aur ne book kar liya. Kripya doosra slot chunein.',
      slot_requested: '16:00',
      booking_date: '2026-11-10',
      action_required: 'get_slots',
      waitlist: { available: true },
      workflow: 'WF4-SlotTakenFallback',
      timestamp: NOW.toISOString(),
    });
    expect(res.body.alternative_dates).toEqual([
      { date: '2026-11-05', label: 'Kal (Tomorrow)', slots: ['12:00', '14:00', '15:00'] },
      { date: '2026-11-06', label: 'Parson', slots: ['09:00', '10:00', '11:00'] },
      { date: '2026-11-07', label: '3 din baad', slots: ['09:00', '10:00', '11:00'] },
    ]);
    expect(db.calls).not.toContain('insert');
    expect(db.rows).toHaveLength(2);
    expect(email.sent).toHaveLength(0);
    expect(log.records.find((r) => r.event === 'booking.slot_taken')).toMatchObject({ reason: 'precheck', conflict: 'buffer_after_earlier' });
  });

  it('matches an old "16:00" row against a "4:00 PM" request (slot normalisation)', async () => {
    db.seed({ booking_id: 'BK-TEST-SEED-1', provider_id: 'ChIJ-test-provider', booking_date: '2026-11-10', slot: '16:00' });
    const res = await handleBookingRequest(confirmBody, deps);
    expect(res.status).toBe(409);
  });

  it('ignores cancelled bookings', async () => {
    db.seed({ booking_id: 'BK-TEST-SEED-1', provider_id: 'ChIJ-test-provider', booking_date: '2026-11-10', slot: '16:00', status: 'cancelled' });
    const res = await handleBookingRequest(confirmBody, deps);
    expect(res.status).toBe(200);
  });

  it('still answers 409 when the alternatives lookup fails', async () => {
    db.seed({ booking_id: 'BK-TEST-SEED-1', provider_id: 'ChIJ-test-provider', booking_date: '2026-11-10', slot: '16:00' });
    let lookups = 0;
    db.failWhen = (op) => op === 'bookedSlots' && ++lookups > 1;
    const res = await handleBookingRequest(confirmBody, deps);
    expect(res.status).toBe(409);
    expect(res.body.alternative_dates).toEqual([]);
    expect(events()).toContain('booking.alternatives_unavailable');
  });
});

describe('confirm: unique index conflict', () => {
  it('returns 409 when a racing request takes the slot between pre-check and insert', async () => {
    db.beforeInsert = (row) => db.insertNow({ ...row, booking_id: 'BK-TEST-RACER', user_email: 'racer@example.test' });

    const res = await handleBookingRequest(confirmBody, deps);

    expect(res.status).toBe(409);
    expect(res.body.status).toBe('slot_taken');
    expect(db.rows.map((r) => r.booking_id)).toEqual(['BK-TEST-RACER']);
    expect(email.sent).toHaveLength(0);
    expect(log.records.find((r) => r.event === 'booking.slot_taken')).toMatchObject({
      reason: 'unique_index',
      constraint: 'bookings_active_slot_key',
    });
  });

  it('retries once with a new id when the generated booking_id already exists', async () => {
    db.seed({ booking_id: 'BK-TEST-0001', provider_id: 'someone-else', booking_date: '2026-11-10', slot: '09:00' });
    const res = await handleBookingRequest(confirmBody, deps);
    expect(res.status).toBe(200);
    expect(res.body.booking_id).toBe('BK-TEST-0002');
    expect(events()).toContain('booking.id_collision');
  });
});

describe('confirm: idempotency', () => {
  const keyed = { ...confirmBody, idempotency_key: 'idem-test-0001' };

  it('replays the same key and body: same receipt, one row, one email', async () => {
    const first = await handleBookingRequest(keyed, deps);
    const second = await handleBookingRequest({ ...keyed, slot: '16:00' }, deps); // same slot, other spelling

    expect(first.status).toBe(200);
    expect(second).toEqual(first);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].idempotency_key).toBe('idem-test-0001');
    expect(email.sent).toHaveLength(1);
    expect(events()).toContain('booking.replayed');
  });

  it('replays when a concurrent request with the same key wins the insert', async () => {
    const fingerprint = requestFingerprint(confirmRequest(keyed));
    db.beforeInsert = (row) => db.insertNow({ ...row, booking_id: 'BK-TEST-TWIN', request_fingerprint: fingerprint });

    const res = await handleBookingRequest(keyed, deps);

    expect(res.status).toBe(200);
    expect(res.body.booking_id).toBe('BK-TEST-TWIN');
    expect(db.rows).toHaveLength(1);
  });

  it('rejects the same key with a different body with 422 and changes nothing', async () => {
    await handleBookingRequest(keyed, deps);
    const res = await handleBookingRequest({ ...keyed, slot: '10:00' }, deps);

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      status: 'idempotency_key_reused',
      message: 'This idempotency_key was already used for a different booking request.',
    });
    expect(db.rows).toHaveLength(1);
    expect(email.sent).toHaveLength(1);
  });

  it('fingerprint ignores availability_slots but not the slot', () => {
    const fp = (b: object) => requestFingerprint(confirmRequest(b));
    expect(fp({ ...keyed, availability_slots: ['09:00'] })).toBe(fp(keyed));
    expect(fp({ ...keyed, slot: '10:00' })).not.toBe(fp(keyed));
  });
});

describe('Supabase down', () => {
  it('confirm returns 503 and sends nothing', async () => {
    db.goDown();
    const res = await handleBookingRequest(confirmBody, deps);
    expect(res).toEqual({
      status: 503,
      body: {
        status: 'service_unavailable',
        message: 'Booking service is temporarily unavailable. Please try again in a minute.',
        retryable: true,
      },
    });
    expect(email.sent).toHaveLength(0);
    expect(events()).toEqual(['booking.db_unavailable']);
  });

  it('confirm returns 503 when only the insert fails', async () => {
    db.failWhen = (op) => op === 'insert';
    const res = await handleBookingRequest(confirmBody, deps);
    expect(res.status).toBe(503);
    expect(db.rows).toHaveLength(0);
  });

  it('get_slots returns 503', async () => {
    db.goDown();
    const res = await handleBookingRequest({ action: 'get_slots', provider_id: 'p', booking_date: '2026-11-10' }, deps);
    expect(res.status).toBe(503);
  });
});

describe('email failure', () => {
  it('a rejected send is logged and the booking still succeeds', async () => {
    email.behaviour = 'fail';
    const res = await handleBookingRequest(confirmBody, deps);

    expect(res.status).toBe(200);
    expect(res.body.booking_id).toBe('BK-TEST-0001');
    expect(db.rows).toHaveLength(1);
    const failed = log.records.find((r) => r.event === 'booking.email_failed');
    expect(failed).toMatchObject({ level: 'error', booking_id: 'BK-TEST-0001', to: 'b***@example.test' });
    expect(JSON.stringify(log.records)).not.toContain('booking-test@example.test');
  });

  it('a hanging send is cut off by the timeout and the booking still succeeds', async () => {
    email.behaviour = 'hang';
    const res = await handleBookingRequest(confirmBody, deps);
    expect(res.status).toBe(200);
    expect(log.records.find((r) => r.event === 'booking.email_failed')?.error).toEqual({
      name: 'Error',
      message: 'email send timed out after 50ms',
    });
  });
});

describe('validation and routing', () => {
  it('returns 400 validation_error listing every bad field, without touching the db', async () => {
    const res = await handleBookingRequest({ action: 'confirm', slot: '25:00' }, deps);
    expect(res.status).toBe(400);
    expect(res.body.status).toBe('validation_error');
    expect(res.body.fields).toEqual(expect.arrayContaining(['provider_id', 'booking_date', 'slot']));
    expect(db.calls).toEqual([]);
  });

  it('rejects an unknown action', async () => {
    const res = await handleBookingRequest({ action: 'drop_table' }, deps);
    expect(res.status).toBe(400);
    expect(res.body.fields).toEqual(['action']);
  });

  it('get_slots is the default action and keeps the WF4 Step A shape', async () => {
    db.seed({ booking_id: 'BK-TEST-SEED-1', provider_id: 'p1', booking_date: '2026-11-10', slot: '10:00 AM' });
    const res = await handleBookingRequest(
      { provider_id: 'p1', booking_date: '2026-11-10', service_type: 'Plumber', availability_slots: ['9:00 AM', '10:00', '12:00', '2 PM'] },
      deps,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'slots_ready',
      action: 'get_slots',
      provider_id: 'p1',
      availability_slots: ['09:00', '10:00', '12:00', '14:00'],
      free_count: 2,
      booked_count: 1,
      job_duration_mins: 90,
      total_block_mins: 120,
      message: '2 slot(s) available — slot chunein',
      workflow: 'WF4-StepA',
    });
    expect((res.body.slots as Array<{ time: string; available: boolean }>).map((s) => [s.time, s.available])).toEqual([
      ['09:00', false],
      ['10:00', false],
      ['12:00', true],
      ['14:00', true],
    ]);
  });
});

describe('defaultBookingId', () => {
  it('keeps the WF4 format', () => {
    expect(defaultBookingId(NOW)).toMatch(/^BK-2026-1793782800000-\d{3}$/);
  });
});
