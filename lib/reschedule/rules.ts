import { addDays, pakistanDate } from '../booking/schedule.js';
import { normaliseSlot, slotLabel } from '../booking/slot.js';
import { appointmentTime, type Alternative } from '../dispute/decide.js';

// WF7 "Cancellation & Auto-Reschedule": Intake timing, Penalty Engine,
// Alternative Picker, Slot Selector and the response builders, with n8n's
// thresholds and amounts (tests/reschedule/rules.test.ts runs the original
// nodes next to these). What changed:
// - Hours until the appointment use Pakistan time (n8n: the server clock).
// - The penalty uses the provider's real history (n8n assumed 8% when the
//   browser sent no rate) and recommends suspension instead of claiming it.
// - The cancelled provider is never picked as its own replacement.
// - "Alternate dates" are Pakistan dates.

export interface Timing {
  hours_until_booking: number | null;
  is_urgent: boolean;
  is_past: boolean;
}

export function timing(bookingDate: string | null, slot: string | null, now: Date): Timing {
  const at = appointmentTime(bookingDate, slot);
  if (!at) return { hours_until_booking: null, is_urgent: true, is_past: false };
  const hours = Number(((at.getTime() - now.getTime()) / 3600_000).toFixed(1));
  return { hours_until_booking: hours, is_urgent: hours < 3, is_past: hours < 0 };
}

export interface Compensation { eligible: boolean; amount_pkr: number; reason: string }

/** Alternative Picker's compensation rule. */
export function compensationFor(t: Timing): Compensation {
  if (t.is_urgent) return { eligible: true, amount_pkr: 250, reason: 'Urgent cancellation — PKR 250 credit on next booking.' };
  if (t.hours_until_booking !== null && t.hours_until_booking < 12) return { eligible: true, amount_pkr: 100, reason: 'Same-day cancellation. PKR 100 discount credit added.' };
  return { eligible: false, amount_pkr: 0, reason: '' };
}

/** Highest computed_score first, never the provider who just cancelled. */
export function pickAlternative(alternatives: Alternative[], cancelledProviderId: string): { next: Alternative | null; remaining: Alternative[] } {
  const sorted = alternatives.filter((a) => a.id !== cancelledProviderId).sort((a, b) => (b.computed_score ?? 0) - (a.computed_score ?? 0));
  return { next: sorted[0] ?? null, remaining: sorted.slice(1) };
}

/**
 * Penalty Engine. `history` is read after this cancellation was recorded, so
 * it already counts it: the previous rate leaves it out, the updated one
 * includes it (n8n: browser-sent rate, default 8%, plus 5 points).
 */
export function penaltyRecord(providerId: string, providerName: string, history: { total: number; noShowOrCancelled: number }, now: Date) {
  const { total, noShowOrCancelled: faults } = history;
  const previous = total > 0 ? Math.max(0, faults - 1) / total : 0;
  const updated = total > 0 ? Math.min(1, faults / total) : 1;
  const isRepeatOffender = previous > 0.2;
  const suspend = updated > 0.3 || isRepeatOffender;
  return {
    provider_id: providerId,
    provider_name: providerName,
    previous_cancellation_rate: Number(previous.toFixed(2)),
    updated_cancellation_rate: Number(updated.toFixed(2)),
    bookings_on_record: total,
    blacklisted: false,
    suspension_recommended: suspend,
    penalty_level: suspend ? 'SUSPENSION_REVIEW' : updated > 0.15 ? 'WARNING_LEVEL_2' : 'WARNING_LEVEL_1',
    penalty_note: suspend
      ? `${providerName}: cancellation rate ${(updated * 100).toFixed(0)}%. Suspension recommended; a person decides.`
      : `Strike added. Rate: ${(updated * 100).toFixed(0)}%.`,
    matching_score_delta: suspend ? -100 : -20,
    logged_at: now.toISOString(),
  };
}

export interface SlotEntry { time: string; label: string; available: boolean }

/** Slot Selector: keep the original time if it is free, else the first free one. */
export function selectSlot(slots: SlotEntry[], originalSlot: string | null): { selected: SlotEntry | null; keptOriginal: boolean; free: number } {
  const free = slots.filter((s) => s.available);
  const original = normaliseSlot(originalSlot);
  const match = original ? free.find((s) => normaliseSlot(s.time) === original) : undefined;
  return { selected: match ?? free[0] ?? null, keptOriginal: !!match, free: free.length };
}

export function alternateDates(now: Date) {
  const today = pakistanDate(now);
  return [1, 2, 3].map((offset) => ({
    date: addDays(today, offset),
    label: offset === 1 ? 'Tomorrow' : offset === 2 ? 'Day after tomorrow' : '3 days from now',
    suggested_slots: ['09:00', '11:00', '14:00'],
  }));
}

const ui = (o: { cancelBtn?: boolean; feedback: boolean; primary: string; secondary: string | null; reason: string }) => ({
  show_track_button: false,
  show_feedback_button: o.feedback,
  ui_actions: { show_track_button: false, show_cancel_button: false, show_report_button: false, show_feedback_button: o.feedback, primary_label: o.primary, secondary_label: o.secondary, reason: o.reason },
});

export interface Original {
  booking_id: string;
  provider_id: string;
  provider_name: string;
  service_type: string;
  location: string;
  booking_date: string | null;
  slot: string | null;
  price_pkr: number;
  user_email: string;
  user_name: string;
}

export function cancelledBody(o: Original, cancelledAt: string) {
  return {
    status: 'cancelled',
    workflow: 'WF7-CancelOnly',
    booking_id: o.booking_id,
    provider_name: o.provider_name,
    service_type: o.service_type,
    cancelled_at: cancelledAt,
    user_email: o.user_email,
    user_name: o.user_name,
    message: 'Your booking has been cancelled successfully.',
    customer_message: 'Booking cancelled. No replacement has been made.',
    ...ui({ feedback: true, primary: 'Cancelled', secondary: 'Leave Feedback', reason: 'booking_cancelled_by_user' }),
  };
}

export function noAlternativeBody(o: Original, compensation: Compensation, ticketId: string, now: Date) {
  return {
    status: 'no_alternative_available',
    workflow: 'WF7-NoAlternativeFallback',
    original_booking_id: o.booking_id,
    cancelled_provider: o.provider_name,
    service_type: o.service_type,
    location: o.location,
    booking_date: o.booking_date,
    user_email: o.user_email,
    user_name: o.user_name,
    resolution: {
      refund: { eligible: true, amount_pkr: o.price_pkr, note: 'Full refund approved' },
      human_escalation: { required: true, ticket_id: ticketId, reason: 'Zero alternatives after cancellation' },
      waitlist: { added: true, message: 'Added to waitlist. Will notify when provider available.' },
    },
    compensation,
    timestamp: now.toISOString(),
    ...ui({ feedback: false, primary: 'Cancelled — Refund Pending', secondary: null, reason: 'no_alternative_available_refund_issued' }),
  };
}

export function noSlotBody(o: Original, attempted: string, compensation: Compensation, now: Date) {
  return {
    status: 'no_slot_available',
    workflow: 'WF7-NoSlotFallback',
    original_booking_id: o.booking_id,
    cancelled_provider: o.provider_name,
    attempted_provider: attempted,
    service_type: o.service_type,
    location: o.location,
    booking_date: o.booking_date,
    alternate_dates: alternateDates(now),
    compensation,
    user_email: o.user_email,
    user_name: o.user_name,
    timestamp: now.toISOString(),
    ...ui({ feedback: false, primary: 'Pending Reschedule', secondary: null, reason: 'no_slot_available_awaiting_user_selection' }),
  };
}

export interface NewBooking {
  booking_id: string;
  provider: string;
  provider_id: string;
  provider_score: number | null;
  provider_rating: number | null;
  slot: string;
  slot_label: string;
  kept_original_time: boolean;
}

export function rescheduledBody(o: Original, initiator: string, n: NewBooking, compensation: Compensation, penalty: unknown, now: Date) {
  return {
    status: 'rescheduled',
    workflow: 'WF7-AutoReschedule',
    initiator,
    original_booking: { booking_id: o.booking_id, provider: o.provider_name, provider_id: o.provider_id, slot: o.slot, date: o.booking_date },
    provider_action_locked: true,
    tracking_locked: true,
    new_booking: {
      booking_id: n.booking_id,
      provider: n.provider,
      provider_id: n.provider_id,
      provider_score: n.provider_score,
      provider_rating: n.provider_rating,
      slot: n.slot,
      slot_label: n.slot_label || slotLabel(n.slot),
      date: o.booking_date,
      location: o.location,
      price_pkr: o.price_pkr,
      kept_original_time: n.kept_original_time,
    },
    ...ui({ feedback: true, primary: 'Booking Reassigned', secondary: 'Leave Feedback', reason: 'booking_rescheduled_to_new_provider' }),
    user_email: o.user_email,
    user_name: o.user_name,
    compensation,
    penalty_record: penalty ?? null,
    customer_message: `Your booking with ${o.provider_name} was cancelled. We have automatically reassigned your booking to ${n.provider || 'a new provider'}.`,
    simulated_whatsapp:
      `⚠️ Provider Update — GharFix\n\nPrevious Provider: ${o.provider_name}\nNew Provider: ${n.provider || 'N/A'}\n\n` +
      `🎫 New Booking ID: ${n.booking_id}\n📅 ${o.booking_date} at ${n.slot_label || slotLabel(n.slot)}\n📍 ${o.location}\n💰 PKR ${o.price_pkr}` +
      (compensation.eligible ? `\n🎁 Compensation: PKR ${compensation.amount_pkr}` : ''),
    timestamp: now.toISOString(),
  };
}
