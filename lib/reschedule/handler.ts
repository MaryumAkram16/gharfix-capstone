import { RepositoryError } from '../booking/repository.js';
import type { BookingRecord, BookingRecords } from '../booking/records.js';
import { normaliseSlot, slotLabel } from '../booking/slot.js';
import type { Alternative } from '../dispute/decide.js';
import { BOOKING_ID, parseAlternatives } from '../dispute/validate.js';
import type { EmailSender } from '../email/types.js';
import { fail, internalError, ok, serviceUnavailable, validationError, type HttpResult } from '../http/errors.js';
import type { Logger } from '../log.js';
import { withTimeout } from '../resilience/retry.js';
import { cancelEmail, noSlotEmail, rescheduleEmail } from './email.js';
import {
  cancelledBody, compensationFor, noAlternativeBody, noSlotBody, penaltyRecord, pickAlternative, rescheduledBody, selectSlot, timing,
  type Original, type SlotEntry,
} from './rules.js';
import type { Waitlist } from './waitlist.js';

// khadmat-reschedule (WF7): cancel_only, user reschedule, provider cancel.
//
// The reschedule is built to survive a crash or timeout at any step and be
// retried safely (the same request again finishes the job, never doubles it):
//   1. the original booking moves confirmed -> user_rescheduling /
//      provider_cancelled (compare-and-set); a retry finds it there and resumes
//   2. the chosen provider and slot are written on the original booking
//      before booking them; a retry reuses them
//   3. the new booking goes through khadmat-booking in-process with the
//      idempotency key "reschedule-<original id>", so a retry replays it
//      instead of inserting a second one (n8n called WF4 over HTTP, twice,
//      with no key)
//   4. only then is the original marked rescheduled
// Facts (provider, date, slot, price, customer email) come from the booking
// row; the request supplies only the action, the alternatives the browser
// kept from matching, and the provider's cancellation reason.

export const ACTIONS = ['cancel_only', 'reschedule', 'provider_cancel'] as const;
const IN_FLIGHT = { user: 'user_rescheduling', provider: 'provider_cancelled' } as const;

type BookingCall = (body: Record<string, unknown>) => Promise<HttpResult<unknown>>;

export interface RescheduleDeps {
  records: BookingRecords;
  waitlist: Waitlist;
  email: EmailSender;
  /** khadmat-booking, in-process. */
  booking: BookingCall;
  now: () => Date;
  log: Logger;
  newTicketId?: () => string;
  emailTimeoutMs?: number;
}

function original(row: BookingRecord): Original {
  const n = Number(row.price_pkr);
  return {
    booking_id: row.booking_id,
    provider_id: row.provider_id ?? '',
    provider_name: row.provider_name ?? 'Your provider',
    service_type: row.service_type ?? '',
    location: row.location ?? '',
    booking_date: row.booking_date,
    slot: normaliseSlot(row.slot) ?? row.slot,
    price_pkr: Number.isFinite(n) ? n : 0,
    user_email: row.user_email ?? '',
    user_name: row.user_name?.trim() || 'Valued Customer',
  };
}

async function mail(deps: RescheduleDeps, log: Logger, build: () => import('../email/types.js').EmailMessage | null): Promise<string> {
  const message = build();
  if (!message) return 'skipped';
  try {
    await withTimeout(Promise.resolve().then(() => deps.email.send(message)), deps.emailTimeoutMs ?? 5000, 'reschedule email');
  } catch (err) {
    log.error('reschedule.email_failed', { error: err });
    return 'failed';
  }
  return deps.email.logsOnly ? 'logged' : 'sent';
}

/** Entry point for POST khadmat-reschedule. Never throws. */
export async function handleRescheduleRequest(body: Record<string, unknown>, deps: RescheduleDeps): Promise<HttpResult<unknown>> {
  const problems: string[] = [];
  const action = body.action === undefined || body.action === null || body.action === '' ? 'reschedule' : body.action;
  if (!(ACTIONS as readonly unknown[]).includes(action)) problems.push('action');
  const rawInitiator = body.initiator === undefined || body.initiator === null || body.initiator === '' ? (action === 'provider_cancel' ? 'provider' : 'user') : body.initiator;
  if (rawInitiator !== 'user' && rawInitiator !== 'provider') problems.push('initiator');
  const bookingId = typeof body.booking_id === 'string' ? body.booking_id.trim() : '';
  if (!BOOKING_ID.test(bookingId)) problems.push('booking_id');
  if (problems.length) return validationError(`Invalid fields: ${problems.join(', ')}`, problems);
  const initiator = rawInitiator as 'user' | 'provider';
  // n8n: cancel_only only for the customer; a provider's cancel_only is a provider cancel.
  const mode = action === 'cancel_only' && initiator === 'user' ? 'cancel_only' : 'reschedule';
  const userEmail = typeof body.user_email === 'string' ? body.user_email.trim().toLowerCase() : '';
  const reason = typeof body.cancellation_reason_by_provider === 'string' && body.cancellation_reason_by_provider.trim()
    ? body.cancellation_reason_by_provider.trim().slice(0, 300) : null;
  const log = deps.log.child({ booking_id: bookingId, action: mode, initiator });

  try {
    const row = await deps.records.find(bookingId);
    if (!row) return fail('not_found', 'Booking not found.', { booking_id: bookingId });
    const owner = row.user_email?.trim().toLowerCase();
    if (owner && owner !== userEmail) {
      log.warn('reschedule.email_mismatch');
      return fail('forbidden', 'This booking was made with a different email address.');
    }
    const o = original(row);
    const now = deps.now();

    if (mode === 'cancel_only') return await cancelOnly(row, o, now, deps, log);
    return await reschedule(row, o, initiator, reason, parseAlternatives(body.alternatives), now, deps, log);
  } catch (err) {
    if (err instanceof RepositoryError && err.kind === 'unavailable') {
      log.error('reschedule.db_unavailable', { error: err });
      return serviceUnavailable();
    }
    log.error('reschedule.unhandled_error', { error: err });
    return internalError();
  }
}

async function cancelOnly(row: BookingRecord, o: Original, now: Date, deps: RescheduleDeps, log: Logger): Promise<HttpResult<unknown>> {
  if (row.status === 'cancelled') return ok({ ...cancelledBody(o, String(row.updated_at ?? now.toISOString())), already_recorded: true });
  if (row.status !== 'confirmed') return fail('conflict', `This booking cannot be cancelled: its status is '${row.status}'.`, { booking_id: o.booking_id });
  const saved = await deps.records.update(o.booking_id, {
    status: 'cancelled', previous_status: row.status, flagged_for_review: false,
    cancellation_reason: 'Customer initiated cancellation — cancel only', updated_at: now.toISOString(),
  }, { status: ['confirmed'] });
  if (!saved) return fail('conflict', 'This booking changed while your request was processed. Please refresh and try again.', { retryable: true });
  const responseBody = cancelledBody(o, now.toISOString());
  const email = await mail(deps, log, () => (o.user_email ? cancelEmail(o.user_email, responseBody) : null));
  log.info('reschedule.cancelled', { email });
  return ok({ ...responseBody, email });
}

async function reschedule(
  row: BookingRecord, o: Original, initiator: 'user' | 'provider', reason: string | null, alternatives: Alternative[],
  now: Date, deps: RescheduleDeps, log: Logger,
): Promise<HttpResult<unknown>> {
  const inFlight = IN_FLIGHT[initiator];
  const t = timing(o.booking_date, o.slot, now);
  const compensation = compensationFor(t);

  // Already done: answer with what was recorded.
  if (row.status === 'rescheduled' && typeof row.rescheduled_to_booking_id === 'string') {
    const slot = String(row.new_slot ?? '');
    return ok({
      ...rescheduledBody(o, initiator, {
        booking_id: row.rescheduled_to_booking_id, provider: String(row.new_provider_name ?? ''), provider_id: String(row.new_provider_id ?? ''),
        provider_score: null, provider_rating: null, slot, slot_label: slot ? slotLabel(slot) : '', kept_original_time: slot === o.slot,
      }, compensation, null, now),
      already_recorded: true,
    });
  }

  // 1. Mark the original (or resume an earlier attempt that got this far).
  if (row.status === 'confirmed') {
    const patch = initiator === 'provider'
      ? { status: inFlight, previous_status: row.status, flagged_for_review: true, cancellation_reason: reason ?? 'Provider initiated cancellation', provider_action_locked: true, tracking_locked: true, updated_at: now.toISOString() }
      : { status: inFlight, previous_status: row.status, flagged_for_review: false, cancellation_reason: 'User initiated reschedule', updated_at: now.toISOString() };
    const saved = await deps.records.update(o.booking_id, patch, { status: ['confirmed'] });
    if (!saved) return fail('conflict', 'This booking changed while your request was processed. Please refresh and try again.', { retryable: true });
  } else if (row.status === inFlight) {
    log.info('reschedule.resuming', { status: row.status });
  } else {
    return fail('conflict', `This booking cannot be rescheduled: its status is '${row.status}'.`, { booking_id: o.booking_id });
  }

  const penalty = initiator === 'provider' && o.provider_id ? penaltyRecord(o.provider_id, o.provider_name, await deps.records.providerHistory(o.provider_id), now) : null;

  // 2. The replacement: the one recorded by an earlier attempt, else the best alternative.
  const recorded = typeof row.new_provider_id === 'string' && row.new_provider_id && typeof row.new_slot === 'string' && row.new_slot
    ? { id: row.new_provider_id, name: String(row.new_provider_name ?? ''), slot: row.new_slot } : null;
  const { next } = pickAlternative(alternatives, o.provider_id);
  const provider: Alternative | null = recorded
    ? alternatives.find((a) => a.id === recorded.id) ?? { id: recorded.id, name: recorded.name, computed_score: null, rating: null, distance_km: null, estimated_arrival: null, availability_slots: [] }
    : next;

  const waitlistEntry = (why: 'no_alternative_available' | 'no_slot_available', attempted: string | null) => deps.waitlist.add({
    booking_id: o.booking_id, user_email: o.user_email, user_name: o.user_name, service_type: o.service_type, location: o.location,
    booking_date: o.booking_date, slot: o.slot, price_pkr: o.price_pkr, cancelled_provider_id: o.provider_id,
    cancelled_provider_name: o.provider_name, attempted_provider_name: attempted, reason: why, status: 'waiting',
  });

  if (!provider) {
    await waitlistEntry('no_alternative_available', null);
    log.info('reschedule.no_alternative');
    return ok(noAlternativeBody(o, compensation, (deps.newTicketId ?? (() => `TKT-WF7-${now.getTime()}`))(), now));
  }

  const candidateSlots = provider.availability_slots.length ? provider.availability_slots : ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];
  const providerFields = {
    provider_id: provider.id, provider_name: provider.name, service_type: o.service_type, location: o.location,
    booking_date: o.booking_date, price_pkr: o.price_pkr, availability_slots: candidateSlots,
  };

  let slot = recorded?.slot ?? null;
  let keptOriginal = slot !== null && slot === o.slot;
  if (!slot) {
    const slots = await deps.booking({ action: 'get_slots', ...providerFields });
    if (slots.status !== 200) return passThrough(slots, log, 'get_slots');
    const pick = selectSlot(((slots.body as { slots?: SlotEntry[] }).slots) ?? [], o.slot);
    if (!pick.selected) {
      await waitlistEntry('no_slot_available', provider.name);
      const responseBody = noSlotBody(o, provider.name, compensation, now);
      const email = await mail(deps, log, () => (o.user_email ? noSlotEmail(o.user_email, responseBody) : null));
      log.info('reschedule.no_slot', { email });
      return ok({ ...responseBody, email });
    }
    slot = pick.selected.time;
    keptOriginal = pick.keptOriginal;
    // Recorded before booking, so a retry books the same provider and slot (and the key replays it).
    await deps.records.update(o.booking_id, { new_provider_id: provider.id, new_provider_name: provider.name, new_slot: slot, updated_at: now.toISOString() }, { status: [inFlight] });
  }

  // 3. Book the replacement through khadmat-booking.
  const confirmed = await deps.booking({
    action: 'confirm', ...providerFields, slot, user_name: o.user_name, user_email: o.user_email || undefined,
    idempotency_key: `reschedule-${o.booking_id}`,
  });
  if (confirmed.status !== 200) {
    if (confirmed.status === 409) {
      // Someone took that slot first: forget the choice, so a retry picks again (the key was not used: nothing was inserted).
      await deps.records.update(o.booking_id, { new_provider_id: null, new_provider_name: null, new_slot: null, updated_at: now.toISOString() }, { status: [inFlight] });
    }
    return passThrough(confirmed, log, 'confirm');
  }
  const receipt = confirmed.body as { booking_id: string; appointment?: { time?: string; time_label?: string }; provider?: { id?: string; name?: string } };

  const newBooking = {
    booking_id: receipt.booking_id,
    provider: provider.name || receipt.provider?.name || '',
    provider_id: provider.id || receipt.provider?.id || '',
    provider_score: provider.computed_score,
    provider_rating: provider.rating,
    slot: receipt.appointment?.time ?? slot,
    slot_label: receipt.appointment?.time_label ?? slotLabel(slot),
    kept_original_time: keptOriginal,
  };

  // 4. Close the original.
  const responseBody = rescheduledBody(o, initiator, newBooking, compensation, penalty, now);
  let originalClosed = true;
  try {
    const closed = await deps.records.update(o.booking_id, {
      status: 'rescheduled', previous_status: inFlight, booking_visibility: 'archived', tracking_status: 'closed', tracked_once: true,
      tracking_locked: true, provider_action_locked: true, reassigned_to_provider_id: newBooking.provider_id,
      reassigned_from_provider_id: o.provider_id, rescheduled_to_booking_id: newBooking.booking_id, new_provider_name: newBooking.provider,
      new_provider_id: newBooking.provider_id, new_slot: newBooking.slot, rescheduled_by: initiator, flagged_for_review: initiator === 'provider',
      updated_at: now.toISOString(),
    }, { status: [inFlight] });
    originalClosed = closed !== null;
  } catch (err) {
    // The new booking exists; a retry of this request finishes the job (step 3 replays).
    originalClosed = false;
    log.error('reschedule.close_original_failed', { error: err });
  }
  const email = await mail(deps, log, () => (o.user_email ? rescheduleEmail(o.user_email, responseBody) : null));
  log.info('reschedule.done', { new_booking_id: newBooking.booking_id, kept_original_time: keptOriginal, email, original_closed: originalClosed });
  return ok({ ...responseBody, email, ...(originalClosed ? {} : { original_update_pending: true }) });
}

/** A failed get_slots/confirm: its status and body reach the customer (e.g. 503 retryable, 409 slot taken). */
function passThrough(res: HttpResult<unknown>, log: Logger, step: string): HttpResult<unknown> {
  log.warn('reschedule.booking_step_failed', { step, http_status: res.status });
  if (res.status >= 500) return serviceUnavailable();
  return { status: res.status, body: { ...(res.body as Record<string, unknown>), workflow: 'WF7-AutoReschedule', retryable: true } };
}
