import { beforeEach, describe, expect, it } from 'vitest';
import { handleBookingRequest } from '../../lib/booking/handler';
import { memoryLogger } from '../../lib/log';
import { handleRescheduleRequest, type RescheduleDeps } from '../../lib/reschedule/handler';
import type { WaitlistEntry } from '../../lib/reschedule/waitlist';
import { FakeBookingDb } from '../fakes/bookingDb';
import { FakeMailer, FakeRecords } from '../fakes/records';

// The replacement booking goes through the real khadmat-booking handler on an
// in-memory table, so idempotency and slot conflicts are the real ones.

const NOW = new Date('2026-11-06T04:00:00Z'); // 09:00 PKT; booking is 16:00 PKT today: 7 h away
let records: FakeRecords;
let bookings: FakeBookingDb;
let mail: FakeMailer;
let waitlist: WaitlistEntry[];
let bookingCalls: Array<Record<string, unknown>>;
let deps: RescheduleDeps & { log: ReturnType<typeof memoryLogger> };
let ids = 0;

const ALT = { id: 'osm:node/2', name: 'Bilal Plumbing', computed_score: 81, rating: 4.4, availability_slots: ['09:00', '14:00', '16:00'] };
const WORSE = { id: 'osm:node/3', name: 'Cheap Fix', computed_score: 60, availability_slots: ['16:00'] };

beforeEach(() => {
  ids = 0;
  records = new FakeRecords().seed({ booking_id: 'BK-TEST-7', slot: '16:00', booking_date: '2026-11-06', price_pkr: 2000 });
  bookings = new FakeBookingDb();
  mail = new FakeMailer();
  waitlist = [];
  bookingCalls = [];
  const log = memoryLogger();
  deps = {
    records, email: mail, now: () => NOW, log, newTicketId: () => 'TKT-WF7-1',
    waitlist: { add: async (e) => { waitlist.push(e); } },
    booking: (b) => {
      bookingCalls.push(b);
      return handleBookingRequest(b, { db: bookings, email: mail, now: () => NOW, log, newBookingId: () => `BK-TEST-NEW-${++ids}` });
    },
  };
});

const send = (body: Record<string, unknown>) => handleRescheduleRequest({ booking_id: 'BK-TEST-7', user_email: 'customer@example.test', ...body }, deps);

describe('cancel_only', () => {
  it('cancels, emails the booking address, and a repeat answers without a second update', async () => {
    const res = await send({ action: 'cancel_only' });
    expect(res.body).toMatchObject({ status: 'cancelled', workflow: 'WF7-CancelOnly', ui_actions: { primary_label: 'Cancelled' }, email: 'sent' });
    expect(records.get('BK-TEST-7')).toMatchObject({ status: 'cancelled', previous_status: 'confirmed' });
    expect(mail.sent.map((m) => m.subject)).toEqual(['Your GharFix Booking Cancelled (BK-TEST-7)']);
    expect((await send({ action: 'cancel_only' })).body).toMatchObject({ status: 'cancelled', already_recorded: true });
    expect(records.updates).toHaveLength(1);
  });
});

describe('user reschedule', () => {
  it('books the best alternative at the original time through khadmat-booking, then closes the original', async () => {
    const res = await send({ action: 'reschedule', alternatives: [WORSE, ALT] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'rescheduled', initiator: 'user', workflow: 'WF7-AutoReschedule',
      new_booking: { booking_id: 'BK-TEST-NEW-1', provider: 'Bilal Plumbing', provider_id: 'osm:node/2', slot: '16:00', kept_original_time: true, price_pkr: 2000 },
      compensation: { eligible: true, amount_pkr: 100 }, // 7 h away: same-day credit
    });
    expect(bookings.rows).toHaveLength(1);
    expect(bookings.rows[0]).toMatchObject({ provider_id: 'osm:node/2', slot: '16:00', idempotency_key: 'reschedule-BK-TEST-7', user_email: 'customer@example.test' });
    expect(records.get('BK-TEST-7')).toMatchObject({ status: 'rescheduled', previous_status: 'user_rescheduling', rescheduled_to_booking_id: 'BK-TEST-NEW-1', new_provider_id: 'osm:node/2', booking_visibility: 'archived', rescheduled_by: 'user', flagged_for_review: false });
    // WF4's confirmation for the new booking, then WF7's update (as n8n).
    expect(mail.sent.map((m) => m.subject)).toEqual([expect.stringContaining('BK-TEST-NEW-1'), 'Important Update: Your GharFix Booking (BK-TEST-NEW-1)']);
  });

  it('takes the first free slot when the original time is booked', async () => {
    await bookings.insert({ booking_id: 'BK-TEST-OTHER', provider_id: 'osm:node/2', booking_date: '2026-11-06', slot: '16:00', status: 'confirmed' } as any);
    const res = await send({ alternatives: [ALT] });
    expect(res.body).toMatchObject({ new_booking: { slot: '09:00', kept_original_time: false } });
  });

  it('a request repeated after it finished answers from the record', async () => {
    await send({ alternatives: [ALT] });
    const again = await send({ alternatives: [ALT] });
    expect(again.body).toMatchObject({ status: 'rescheduled', already_recorded: true, new_booking: { booking_id: 'BK-TEST-NEW-1' } });
    expect(bookings.rows).toHaveLength(1);
  });

  it('self-heals a crash after the new booking: the retry replays it instead of booking twice', async () => {
    let n = 0;
    records.failWhen = (op) => op === 'update' && ++n === 3; // 1 mark, 2 record choice, 3 close original
    const first = await send({ alternatives: [ALT] });
    expect(first.body).toMatchObject({ status: 'rescheduled', original_update_pending: true });
    expect(records.get('BK-TEST-7')?.status).toBe('user_rescheduling');

    records.failWhen = () => false;
    const retry = await send({ alternatives: [ALT] });
    expect(retry.body).toMatchObject({ status: 'rescheduled', new_booking: { booking_id: 'BK-TEST-NEW-1', slot: '16:00' } });
    expect(retry.body).not.toHaveProperty('original_update_pending');
    expect(bookings.rows).toHaveLength(1); // replayed by the idempotency key
    expect(records.get('BK-TEST-7')?.status).toBe('rescheduled');
    expect(bookingCalls.filter((c) => c.action === 'get_slots')).toHaveLength(1); // the retry reused the recorded choice
  });

  it('no alternatives: waitlist, refund and a person; no email (as n8n)', async () => {
    const res = await send({ alternatives: [] });
    expect(res.body).toMatchObject({ status: 'no_alternative_available', resolution: { refund: { amount_pkr: 2000 }, human_escalation: { ticket_id: 'TKT-WF7-1' } } });
    expect(waitlist).toEqual([expect.objectContaining({ booking_id: 'BK-TEST-7', reason: 'no_alternative_available', user_email: 'customer@example.test', cancelled_provider_id: 'osm:node/1', status: 'waiting' })]);
    expect(records.get('BK-TEST-7')?.status).toBe('user_rescheduling');
    expect(mail.sent).toEqual([]);
  });

  it('no free slot: waitlist, alternate dates in Pakistan time, waitlist email', async () => {
    for (const s of ['09:00', '14:00', '16:00']) await bookings.insert({ booking_id: `BK-TEST-X${s}`, provider_id: 'osm:node/2', booking_date: '2026-11-06', slot: s, status: 'confirmed' } as any);
    const res = await send({ alternatives: [ALT] });
    expect(res.body).toMatchObject({ status: 'no_slot_available', attempted_provider: 'Bilal Plumbing', alternate_dates: [{ date: '2026-11-07' }, { date: '2026-11-08' }, { date: '2026-11-09' }] });
    expect(waitlist[0]).toMatchObject({ reason: 'no_slot_available', attempted_provider_name: 'Bilal Plumbing' });
    expect(mail.sent.map((m) => m.subject)).toEqual(["GharFix — We're Finding You a Provider"]);
  });

  it('never picks the provider who cancelled as the replacement', async () => {
    const res = await send({ alternatives: [{ id: 'osm:node/1', name: 'Ali Plumbers', computed_score: 99 }] });
    expect(res.body).toMatchObject({ status: 'no_alternative_available' });
  });

  it('a slot taken at the last moment: 409, and the recorded choice is cleared so a retry picks again', async () => {
    const realBooking = deps.booking;
    deps.booking = async (b) => {
      if (b.action === 'confirm') await bookings.insert({ booking_id: 'BK-TEST-RACE', provider_id: 'osm:node/2', booking_date: '2026-11-06', slot: '16:00', status: 'confirmed' } as any);
      return realBooking(b);
    };
    const res = await send({ alternatives: [ALT] });
    expect(res.status).toBe(409);
    expect(records.get('BK-TEST-7')).toMatchObject({ status: 'user_rescheduling', new_slot: null, new_provider_id: null });
    deps.booking = realBooking;
    expect((await send({ alternatives: [ALT] })).body).toMatchObject({ status: 'rescheduled', new_booking: { slot: '09:00' } });
  });
});

describe('provider cancel', () => {
  it('records the cancellation with the real history, then reschedules', async () => {
    records.seed({ booking_id: 'BK-TEST-OLD', provider_id: 'osm:node/1', status: 'no_show' });
    const res = await send({ action: 'provider_cancel', initiator: 'provider', cancellation_reason_by_provider: 'Bike kharab', alternatives: [ALT] });
    expect(res.body).toMatchObject({
      status: 'rescheduled', initiator: 'provider',
      // 2 bookings, 1 earlier no-show + this cancellation: 50% -> 100%.
      penalty_record: { previous_cancellation_rate: 0.5, updated_cancellation_rate: 1, suspension_recommended: true, penalty_level: 'SUSPENSION_REVIEW', blacklisted: false },
    });
    expect(records.updates[0].patch).toMatchObject({ status: 'provider_cancelled', cancellation_reason: 'Bike kharab', provider_action_locked: true, flagged_for_review: true });
    expect(records.get('BK-TEST-7')).toMatchObject({ status: 'rescheduled', rescheduled_by: 'provider', flagged_for_review: true });
  });
});

describe('checks', () => {
  it.each([[{ action: 'refund' }, ['action']], [{ initiator: 'admin' }, ['initiator']], [{ booking_id: '' }, ['booking_id']]])('400 for %j', async (body, fields) => {
    expect(await send(body)).toMatchObject({ status: 400, body: { fields } });
  });
  it('403 for another email, 404 for an unknown booking, 409 for a disputed one', async () => {
    expect((await send({ user_email: 'x@example.test' })).status).toBe(403);
    expect((await send({ booking_id: 'BK-TEST-404' })).status).toBe(404);
    records.rows[0].status = 'disputed';
    expect((await send({ alternatives: [ALT] })).status).toBe(409);
    expect((await send({ action: 'cancel_only' })).status).toBe(409);
  });
  it('uses the booking\'s own price and email, not the request\'s', async () => {
    await send({ alternatives: [ALT], price_pkr: 1, user_email: 'CUSTOMER@example.test' });
    expect(bookings.rows[0]).toMatchObject({ price_pkr: 2000, user_email: 'customer@example.test' });
  });
  it('503 when Supabase is down', async () => {
    records.failWhen = () => true;
    expect((await send({ alternatives: [ALT] })).status).toBe(503);
  });
});
