import { describe, expect, it } from 'vitest';
import { handleBookingRequest, type BookingDeps } from '../../lib/booking/handler';
import { toResponse } from '../../lib/http/web';
import { memoryLogger } from '../../lib/log';
import {
  interpretBookingResponse, MESSAGES, networkFailure, newIdempotencyKey,
} from '../../src/lib/bookingResponse';
import { FakeBookingDb, FakeEmail } from '../fakes/bookingDb';

// Contract tests: the frontend helper is fed what the real handler sends,
// serialised the way api/proxy.ts sends it.

const confirm = {
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
  idempotency_key: 'idem-test-front-0001',
};

function setup() {
  const db = new FakeBookingDb();
  let n = 0;
  const deps: BookingDeps = {
    db, email: new FakeEmail(), log: memoryLogger(), now: () => new Date('2026-11-04T09:00:00Z'),
    newBookingId: () => `BK-TEST-${String(++n).padStart(4, '0')}`, emailTimeoutMs: 50,
  };
  /** What the browser sees: HTTP status and body text. */
  const call = async (body: object) => {
    const res = toResponse(await handleBookingRequest(body, deps));
    return [res.status, await res.text()] as const;
  };
  return { db, call };
}

describe('interpretBookingResponse against the real handler', () => {
  it('200 confirmed -> confirmed, with the server booking id', async () => {
    const { call } = setup();
    const outcome = interpretBookingResponse(...(await call(confirm)));
    expect(outcome).toMatchObject({ kind: 'confirmed', receipt: { booking_id: 'BK-TEST-0001', status: 'confirmed', replayed: false } });
  });

  it('a replay (same key) is confirmed with the same id and its current status', async () => {
    const { db, call } = setup();
    await call(confirm);
    db.rows[0].status = 'cancelled';
    const outcome = interpretBookingResponse(...(await call(confirm)));
    expect(outcome).toMatchObject({ kind: 'confirmed', receipt: { booking_id: 'BK-TEST-0001', replayed: true, booking_status: 'cancelled' } });
  });

  it('409 slot_taken -> slot_taken with the server message and alternatives (not a network error)', async () => {
    const { db, call } = setup();
    db.seed({ booking_id: 'BK-TEST-SEED', provider_id: 'ChIJ-test-provider', booking_date: '2026-11-10', slot: '16:00' });
    const [status, text] = await call(confirm);
    expect(status).toBe(409);
    const outcome = interpretBookingResponse(status, text);
    expect(outcome.kind).toBe('slot_taken');
    expect(outcome).toMatchObject({ message: 'Yeh slot abhi kisi aur ne book kar liya. Kripya doosra slot chunein.' });
    expect((outcome as { alternatives: unknown[] }).alternatives).toHaveLength(3);
  });

  it('400 validation_error -> not retryable, server message shown', async () => {
    const { call } = setup();
    const [status, text] = await call({ action: 'confirm', slot: '25:00' });
    expect(status).toBe(400);
    expect(interpretBookingResponse(status, text)).toEqual({
      kind: 'error', retryable: false,
      message: expect.stringMatching(/^Missing fields: provider_id, provider_name.*Invalid fields: slot$/),
    });
  });

  it('422 idempotency_key_reused -> not retryable', async () => {
    const { call } = setup();
    await call(confirm);
    const [status, text] = await call({ ...confirm, slot: '10:00' });
    expect(status).toBe(422);
    expect(interpretBookingResponse(status, text)).toEqual({ kind: 'error', retryable: false, message: MESSAGES.keyReused });
  });

  it('503 service_unavailable -> retryable', async () => {
    const { db, call } = setup();
    db.goDown();
    const [status, text] = await call(confirm);
    expect(status).toBe(503);
    expect(interpretBookingResponse(status, text)).toEqual({
      kind: 'error', retryable: true, message: 'Booking service is temporarily unavailable. Please try again in a minute.',
    });
  });
});

describe('interpretBookingResponse never invents a booking', () => {
  it.each([
    ['empty 200', 200, ''],
    ['non-JSON 200', 200, 'OK'],
    ['200 confirmed without booking_id', 200, '{"status":"confirmed"}'],
    ['200 confirmed with blank booking_id', 200, '{"status":"confirmed","booking_id":"  "}'],
    ['200 booking_id without status (old n8n fallback)', 200, '{"booking_id":"BK-1"}'],
  ])('%s -> retryable error', (_label, status, text) => {
    expect(interpretBookingResponse(status, text)).toEqual({ kind: 'error', retryable: true, message: MESSAGES.unexpected });
  });

  it('a confirmed body on a non-2xx status is not a booking', () => {
    expect(interpretBookingResponse(500, '{"status":"confirmed","booking_id":"BK-1"}')).toMatchObject({ kind: 'error', retryable: true });
  });

  it('unwraps an n8n one-element array', () => {
    expect(interpretBookingResponse(200, '[{"status":"confirmed","booking_id":"BK-1"}]')).toMatchObject({ kind: 'confirmed' });
  });

  it.each([
    [502, '<html>Bad gateway</html>', true],
    [504, '', true],
    [429, '', true],
    [404, 'Not Found', false],
    [413, '{"status":"payload_too_large","message":"too big"}', false],
  ])('HTTP %i -> retryable %s', (status, text, retryable) => {
    expect(interpretBookingResponse(status, text)).toMatchObject({ kind: 'error', retryable });
  });

  it('network failure is retryable', () => {
    expect(networkFailure()).toEqual({ kind: 'error', retryable: true, message: MESSAGES.network });
  });
});

describe('newIdempotencyKey', () => {
  // Must pass the server's IDEMPOTENCY_KEY_PATTERN in lib/booking/validate.ts.
  const SERVER_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

  it('uses crypto.randomUUID and is unique per call', () => {
    const a = newIdempotencyKey();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).toMatch(SERVER_PATTERN);
    expect(newIdempotencyKey()).not.toBe(a);
  });

  it('falls back to getRandomValues where randomUUID is missing (plain-http LAN dev)', () => {
    const key = newIdempotencyKey({ getRandomValues: (arr) => globalThis.crypto.getRandomValues(arr) });
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).toMatch(SERVER_PATTERN);
  });
});
