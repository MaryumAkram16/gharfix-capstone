import { normaliseSlot } from '../booking/slot.js';

// WF6 "Dispute Escalation Handler": the five handler Code nodes, with their
// rules, thresholds and amounts unchanged (tests/dispute/decide.test.ts pins
// them). What changed, and why:
//
// - Facts come from the booking row (DisputeFacts), not the request. n8n
//   refunded `price_pkr` as sent by the browser and emailed `user_email` as
//   sent by the browser, so anyone could set both.
// - No invented inputs. n8n assumed a 12% cancellation rate when none was
//   sent, rating 1/5 when none was sent (a free-text complaint became a
//   CRITICAL 50% refund), a charged price of 0 (every price dispute became
//   "no overcharge"), and a 90-minute job when none was sent. Here: the
//   provider's real no-show/cancel history from Supabase; an unrated
//   complaint or an unknown charged price goes to a person instead of an
//   automatic decision; overrun disputes must send both durations.
// - "Hours until the appointment" uses the booked date and slot in Pakistan
//   time; n8n used midnight UTC of the date.
// - Texts no longer promise actions nothing performs ("BLACKLISTED, will not
//   appear in future WF2 results": matching has no blacklist).
// - Messages say GharFix, not Khadmat AI.
//
// Refunds and penalties are decisions recorded in the response and on the
// booking; no money moves.

export const DISPUTE_TYPES = ['no_show', 'provider_cancelled', 'quality_complaint', 'price_disagreement', 'overrun'] as const;
export type DisputeType = (typeof DISPUTE_TYPES)[number];

/** Booking status each dispute type sets (n8n "Supabase — Status: ..." nodes). */
export const STATUS_FOR_DISPUTE: Record<DisputeType, string> = {
  no_show: 'no_show',
  provider_cancelled: 'provider_cancelled',
  quality_complaint: 'disputed',
  price_disagreement: 'price_disputed',
  overrun: 'overrun_disputed',
};

/** From the booking row. */
export interface DisputeFacts {
  booking_id: string;
  provider_id: string;
  provider_name: string;
  user_email: string | null;
  user_name: string | null;
  service_type: string;
  location: string;
  booking_date: string | null;
  slot: string | null;
  price_pkr: number;
  final_price_pkr: number | null;
  customer_rating: number | null;
  feedback_sentiment: string | null;
}

export interface Alternative {
  id: string;
  name: string;
  computed_score: number | null;
  rating: number | null;
  distance_km: number | null;
  estimated_arrival: string | null;
  availability_slots: string[];
}

/** What the customer (or WF5) claims. */
export interface DisputeClaims {
  dispute_type: DisputeType;
  rating: number | null;
  review: string;
  sentiment: string | null;
  auto_escalated: boolean;
  charged_price_pkr: number | null;
  extra_charge_pkr: number;
  customer_notified_before_overrun: boolean;
  customer_approved_overrun: boolean;
  estimated_duration_mins: number | null;
  actual_duration_mins: number | null;
  alternatives: Alternative[];
}

export interface DecisionContext {
  now: Date;
  /** Provider history before this dispute (no_show only uses it). */
  history: { total: number; noShowOrCancelled: number } | null;
  newTicketId: () => string;
}

export type Resolution = Record<string, unknown> & { status: string; customer_message: string; workflow: string };

const PKT_OFFSET_MS = 5 * 3600_000;

/** Appointment start as a Date: booking_date + slot in Pakistan time (UTC+5, no DST). */
export function appointmentTime(date: string | null, slot: string | null): Date | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const hhmm = normaliseSlot(slot) ?? '00:00';
  const t = Date.parse(`${date}T${hhmm}:00Z`);
  return Number.isNaN(t) ? null : new Date(t - PKT_OFFSET_MS);
}

function noShow(f: DisputeFacts, c: DisputeClaims, ctx: DecisionContext): Resolution {
  const h = ctx.history ?? { total: 0, noShowOrCancelled: 0 };
  // Rate before this booking, then with this no-show counted (the booking is already in `total`).
  const cancellationRate = h.total > 0 ? h.noShowOrCancelled / h.total : 0;
  const updatedRate = h.total > 0 ? Math.min(1, (h.noShowOrCancelled + 1) / h.total) : 1;
  const isRepeatOffender = cancellationRate > 0.2;
  const penalty = isRepeatOffender
    ? 'SUSPENSION RECOMMENDED: repeat no-shows. A person must review before the provider is removed.'
    : 'WARNING: strike recorded on the provider history. 3 strikes = suspension review.';
  return {
    status: 'dispute_resolved',
    dispute_type: 'no_show',
    booking_id: f.booking_id,
    provider_name: f.provider_name,
    provider_id: f.provider_id,
    user_email: f.user_email,
    resolution: 'no_show_confirmed',
    decision: {
      refund: { eligible: true, amount_pkr: f.price_pkr, method: 'Credit to next booking or cash refund', note: 'Full refund approved — provider did not show up' },
      provider_action: {
        penalty,
        cancellation_rate: Number(cancellationRate.toFixed(2)),
        cancellation_rate_updated: Number(updatedRate.toFixed(2)),
        bookings_on_record: h.total,
        blacklisted: false,
        suspension_recommended: isRepeatOffender,
        matching_impact: 'Recorded as no_show on the booking; provider scores (WF8b) count it.',
      },
      reschedule_offer: {
        available: true,
        message: 'Kya aap doosre provider ke saath reschedule karna chahte hain?',
        action: 'POST to khadmat-booking with action: get_slots and new provider details',
      },
    },
    antigravity_trace: {
      reasoning: `No-show for booking ${f.booking_id}. Provider ${f.provider_name}: ${h.noShowOrCancelled} no-show/cancellation(s) in ${h.total} booking(s) before this one (${(cancellationRate * 100).toFixed(0)}%). Decision: ${isRepeatOffender ? 'full refund + suspension review' : 'warning + full refund + reschedule offer'}.`,
      confidence: 95,
      escalate_to_human: isRepeatOffender,
    },
    customer_message:
      `Humein afsos hai ke ${f.provider_name} nahi aaye.\n` +
      `Aapka PKR ${f.price_pkr} refund process ho raha hai.\n` +
      'Hum aapko ek naya provider dhundh ke denge — koi extra charge nahi.',
    simulated_whatsapp:
      `No-Show Alert — GharFix\nBooking: ${f.booking_id}\nProvider ${f.provider_name} nahi pahunche.\nFull refund approved: PKR ${f.price_pkr}\nReschedule ke liye reply karein.`,
    workflow: 'WF6-NoShow',
    timestamp: ctx.now.toISOString(),
  };
}

function providerCancelled(f: DisputeFacts, c: DisputeClaims, ctx: DecisionContext): Resolution {
  const next = c.alternatives[0] ?? null;
  const appointment = appointmentTime(f.booking_date, f.slot);
  const hoursUntilBooking = appointment ? Math.round((appointment.getTime() - ctx.now.getTime()) / 3600_000) : null;
  // Unknown appointment time: treat as urgent, so the customer is not denied compensation by missing data.
  const isUrgent = hoursUntilBooking === null || hoursUntilBooking < 3;
  return {
    status: 'dispute_in_progress',
    dispute_type: 'provider_cancelled',
    booking_id: f.booking_id,
    user_email: f.user_email,
    cancelled_provider: { id: f.provider_id, name: f.provider_name, penalty: 'Cancellation recorded on the provider history.', cancellation_logged: true },
    rebooking: {
      triggered: next !== null,
      urgency: isUrgent ? 'HIGH — less than 3 hours to appointment' : 'NORMAL',
      next_best_provider: next
        ? { name: next.name, score: next.computed_score, rating: next.rating, distance_km: next.distance_km, estimated_arrival: next.estimated_arrival }
        : null,
      auto_rebook_instruction: next ? `System will auto-book ${next.name} if customer approves.` : 'No alternatives available. Manual rebooking required.',
      rebook_payload: next
        ? {
            action: 'get_slots',
            provider_id: next.id,
            provider_name: next.name,
            service_type: f.service_type,
            location: f.location,
            booking_date: f.booking_date,
            price_pkr: f.price_pkr,
            availability_slots: next.availability_slots.length ? next.availability_slots : ['09:00', '11:00', '14:00'],
          }
        : null,
    },
    compensation: {
      eligible: isUrgent,
      amount_pkr: isUrgent ? 200 : 0,
      note: isUrgent ? 'PKR 200 discount on next booking — urgent cancellation compensation' : 'No compensation — cancellation was more than 3 hours before appointment',
    },
    antigravity_trace: {
      reasoning: `Provider ${f.provider_name} cancelled booking ${f.booking_id}. Hours until appointment: ${hoursUntilBooking ?? 'unknown'}h. Urgency: ${isUrgent ? 'HIGH' : 'NORMAL'}. Next best alternative: ${next?.name ?? 'None'}. Auto-rebooking: ${next ? 'triggered' : 'not possible'}.`,
      confidence: 90,
      escalate_to_human: !next && isUrgent,
    },
    customer_message:
      `${f.provider_name} ne booking cancel kar di hai.\n` +
      (next
        ? `Hum ne aapke liye next best provider ${next.name} dhundh liya hai. Confirm karein?`
        : 'Filhal koi alternative provider available nahi — hum aapko manually help karenge.'),
    simulated_whatsapp:
      `Provider Cancelled — GharFix\nBooking: ${f.booking_id}\n${f.provider_name} ne cancel kar diya.\n` +
      (next ? `New provider available: ${next.name} (Score: ${next.computed_score ?? 'n/a'})\nConfirm karein?` : 'Koi alternative nahi mila. Team contact karegi.'),
    workflow: 'WF6-ProviderCancelled',
    timestamp: ctx.now.toISOString(),
  };
}

function qualityComplaint(f: DisputeFacts, c: DisputeClaims, ctx: DecisionContext): Resolution {
  const rating = c.rating ?? f.customer_rating;
  const sentiment = c.sentiment ?? f.feedback_sentiment;

  let severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'UNRATED';
  let compensationPct: number;
  let providerAction: string;
  let escalateHuman: boolean;
  if (rating === null) {
    // n8n assumed 1/5 here: a written complaint with no rating became an automatic 50% refund.
    severity = 'UNRATED';
    compensationPct = 0;
    providerAction = 'No rating given: a person reviews the complaint before any penalty or refund.';
    escalateHuman = true;
  } else if (rating === 1 || (sentiment === 'negative' && rating <= 2)) {
    severity = 'CRITICAL';
    compensationPct = 0.5;
    providerAction = 'Immediate review. Score heavily penalized. Risk of suspension.';
    escalateHuman = true;
  } else if (rating === 2) {
    severity = 'HIGH';
    compensationPct = 0.25;
    providerAction = 'Warning issued. Score penalized. Monitored for 30 days.';
    escalateHuman = false;
  } else {
    severity = 'MEDIUM';
    compensationPct = 0;
    providerAction = 'Soft warning. Customer notified of improvement steps.';
    escalateHuman = false;
  }
  const estimatedRefund = Math.round(f.price_pkr * compensationPct);
  const matchingPenalty = severity === 'CRITICAL' ? -25 : severity === 'HIGH' ? -15 : severity === 'MEDIUM' ? -5 : 0;
  const status = escalateHuman ? 'escalated_to_human' : 'dispute_resolved';

  return {
    status,
    dispute_type: 'quality_complaint',
    booking_id: f.booking_id,
    provider_name: f.provider_name,
    provider_id: f.provider_id,
    user_email: f.user_email,
    service_type: f.service_type,
    complaint_details: { rating_given: rating, review_text: c.review, sentiment, auto_escalated_from_wf5: c.auto_escalated, severity },
    decision: {
      compensation: {
        refund_percentage: compensationPct * 100,
        refund_pkr: estimatedRefund,
        eligible: estimatedRefund > 0,
        method: estimatedRefund > 0 ? 'Credit on next booking or cash' : severity === 'UNRATED' ? 'Decided by a person after review' : 'No refund — medium severity only',
      },
      provider_penalty: { action: providerAction, matching_score_delta: matchingPenalty, flagged: true, under_review_days: severity === 'CRITICAL' ? 30 : 7 },
      human_escalation: {
        required: escalateHuman,
        reason: !escalateHuman ? null : severity === 'UNRATED' ? 'No rating given — a person must review within 24h' : 'CRITICAL rating — human agent must review within 24h',
        ticket_id: escalateHuman ? ctx.newTicketId() : null,
      },
    },
    antigravity_trace: {
      reasoning: `Quality complaint for booking ${f.booking_id}. Rating: ${rating ?? 'none'}/5. Severity: ${severity}. Compensation: PKR ${estimatedRefund} (${compensationPct * 100}%). Provider ${f.provider_name} score delta: ${matchingPenalty}. Human escalation: ${escalateHuman}.`,
      confidence: severity === 'UNRATED' ? 50 : 88,
      decision_factors: ['rating_score', 'sentiment_analysis', 'auto_escalation_flag'],
    },
    customer_message:
      estimatedRefund > 0
        ? `Aapki complaint receive ho gayi. Hum ne PKR ${estimatedRefund} refund approve kar diya hai. Aapki next booking mein credit mil jaega.`
        : severity === 'UNRATED'
          ? 'Aapki complaint record ho gayi. Hamari team 24 ghante mein aap se rabta karegi.'
          : `Aapki complaint record ho gayi. Hum ${f.provider_name} ki service improve karne ke liye kadam utha rahe hain.`,
    simulated_whatsapp:
      `Quality Complaint — GharFix\nBooking: ${f.booking_id}\nRating: ${rating ?? '-'}/5 (${severity})\n` +
      `${estimatedRefund > 0 ? `Refund approved: PKR ${estimatedRefund}` : 'No refund — complaint logged'}\n` +
      `${escalateHuman ? 'Human agent will contact you within 24h.' : 'Issue resolved automatically.'}`,
    workflow: 'WF6-QualityComplaint',
    timestamp: ctx.now.toISOString(),
  };
}

function priceDisagreement(f: DisputeFacts, c: DisputeClaims, ctx: DecisionContext): Resolution {
  const quotedPrice = f.price_pkr;
  // What was charged: the final price WF5 recorded at completion, else the customer's figure.
  const charged = f.final_price_pkr ?? c.charged_price_pkr;
  if (charged === null) {
    return {
      status: 'escalated_to_human',
      dispute_type: 'price_disagreement',
      booking_id: f.booking_id,
      provider_name: f.provider_name,
      provider_id: f.provider_id,
      user_email: f.user_email,
      price_analysis: { quoted_pkr: quotedPrice, charged_pkr: null, difference_pkr: null, overcharge_percent: null, decision: 'NEEDS_REVIEW' },
      resolution: {
        refund: { amount_pkr: 0, eligible: false, method: 'Decided by a person after review' },
        provider_action: 'Charged amount unknown: a person checks it with the customer and provider.',
        flagged: true,
      },
      antigravity_trace: {
        reasoning: `Price dispute for booking ${f.booking_id}. Quoted: PKR ${quotedPrice}. Charged amount was not recorded or sent, so no automatic decision.`,
        confidence: 50,
        decision_factors: ['quoted_price', 'charged_price_missing'],
      },
      customer_message: `Aapka case record ho gaya. Quoted price PKR ${quotedPrice} tha. Hamari team charge ki tasdeeq kar ke 24 ghante mein rabta karegi.`,
      simulated_whatsapp: `Price Dispute — GharFix\nBooking: ${f.booking_id}\nQuoted: PKR ${quotedPrice}\nTeam review karegi.`,
      workflow: 'WF6-PriceDisagreement',
      timestamp: ctx.now.toISOString(),
    };
  }
  const difference = charged - quotedPrice;
  const overchargePercent = quotedPrice > 0 ? Number(((difference / quotedPrice) * 100).toFixed(1)) : 0;
  let decision: string;
  let refundAmount: number;
  let providerNote: string;
  if (difference <= 0) {
    decision = 'NO_OVERCHARGE';
    refundAmount = 0;
    providerNote = 'Charge matches or is below quote. No action needed.';
  } else if (overchargePercent <= 10) {
    decision = 'MINOR_VARIANCE';
    refundAmount = 0;
    providerNote = `Overcharge within 10% tolerance (${overchargePercent}%). Logged as warning.`;
  } else if (overchargePercent <= 30) {
    decision = 'PARTIAL_REFUND';
    refundAmount = Math.round(difference * 0.75);
    providerNote = `Overcharge of ${overchargePercent}%. PKR ${refundAmount} refund issued. Strike added.`;
  } else {
    decision = 'FULL_EXCESS_REFUND';
    refundAmount = difference;
    providerNote = `Major overcharge of ${overchargePercent}%. Full excess PKR ${refundAmount} refunded. Escalated for review.`;
  }
  return {
    status: 'dispute_resolved',
    dispute_type: 'price_disagreement',
    booking_id: f.booking_id,
    provider_name: f.provider_name,
    provider_id: f.provider_id,
    user_email: f.user_email,
    price_analysis: { quoted_pkr: quotedPrice, charged_pkr: charged, difference_pkr: difference, overcharge_percent: overchargePercent, decision },
    resolution: {
      refund: { amount_pkr: refundAmount, eligible: refundAmount > 0, method: refundAmount > 0 ? 'Credit on next booking or cash refund' : 'No refund applicable' },
      provider_action: providerNote,
      flagged: difference > 0,
    },
    antigravity_trace: {
      reasoning: `Price dispute for booking ${f.booking_id}. Quoted: PKR ${quotedPrice}. Charged: PKR ${charged}${f.final_price_pkr === null ? ' (as stated by the customer)' : ''}. Difference: PKR ${difference} (${overchargePercent}%). Decision: ${decision}. Refund: PKR ${refundAmount}.`,
      confidence: 97,
      decision_factors: ['quoted_price', 'charged_price', 'overcharge_percentage', 'tolerance_band'],
    },
    customer_message:
      refundAmount > 0
        ? `Aapka case review hua. Quoted price PKR ${quotedPrice} tha lekin PKR ${charged} charge hua. PKR ${refundAmount} refund approve ho gaya.`
        : difference > 0
          ? `Farq PKR ${difference} hai jo 10% tolerance ke andar hai. Yeh acceptable variation hai — provider ko warning di gayi.`
          : 'Aapka charge quote ke mutabiq hai. Koi overcharge nahi hua.',
    simulated_whatsapp: `Price Dispute — GharFix\nBooking: ${f.booking_id}\nQuoted: PKR ${quotedPrice} | Charged: PKR ${charged}\nDecision: ${decision}\n${refundAmount > 0 ? `Refund: PKR ${refundAmount}` : 'No refund applicable'}`,
    workflow: 'WF6-PriceDisagreement',
    timestamp: ctx.now.toISOString(),
  };
}

function overrun(f: DisputeFacts, c: DisputeClaims, ctx: DecisionContext): Resolution {
  const quotedPrice = f.price_pkr;
  const extraCharge = c.extra_charge_pkr;
  // Validation requires both for overrun disputes.
  const estimatedDuration = c.estimated_duration_mins as number;
  const actualDuration = c.actual_duration_mins as number;
  const overrunMins = actualDuration - estimatedDuration;
  let decision: string;
  let approvedExtra: number;
  let note: string;
  if (c.customer_approved_overrun) {
    decision = 'APPROVED_BY_CUSTOMER';
    approvedExtra = extraCharge;
    note = 'Customer pre-approved extra charge. No dispute.';
  } else if (!c.customer_notified_before_overrun && extraCharge > 0) {
    decision = 'EXTRA_CHARGE_REJECTED';
    approvedExtra = 0;
    note = 'Customer was not notified before overrun. Extra charge rejected. Provider warned.';
  } else if (overrunMins <= 15) {
    decision = 'MINOR_OVERRUN_ACCEPTED';
    approvedExtra = Math.min(extraCharge, Math.round(quotedPrice * 0.1));
    note = `Overrun under 15 mins — up to 10% extra (PKR ${approvedExtra}) accepted as fair.`;
  } else {
    decision = 'OVERRUN_NEGOTIATED';
    approvedExtra = Math.round(extraCharge * 0.5);
    note = `Significant overrun (${overrunMins} mins). 50% of extra charge (PKR ${approvedExtra}) approved. Rest waived.`;
  }
  return {
    status: 'dispute_resolved',
    dispute_type: 'overrun',
    booking_id: f.booking_id,
    provider_name: f.provider_name,
    user_email: f.user_email,
    overrun_details: {
      estimated_duration_mins: estimatedDuration,
      actual_duration_mins: actualDuration,
      overrun_mins: overrunMins,
      quoted_price_pkr: quotedPrice,
      extra_charge_requested_pkr: extraCharge,
      customer_notified: c.customer_notified_before_overrun,
      customer_approved: c.customer_approved_overrun,
    },
    resolution: { decision, approved_extra_pkr: approvedExtra, total_fair_price_pkr: quotedPrice + approvedExtra, note },
    antigravity_trace: {
      reasoning: `Overrun dispute for booking ${f.booking_id}. Estimated: ${estimatedDuration}min, Actual: ${actualDuration}min (+${overrunMins}min). Extra requested: PKR ${extraCharge}. Customer notified: ${c.customer_notified_before_overrun}. Decision: ${decision}. Approved extra: PKR ${approvedExtra}.`,
      confidence: 91,
      decision_factors: ['customer_notification', 'customer_approval', 'overrun_duration', 'extra_charge_amount'],
    },
    customer_message: `Job overrun dispute resolved.\nQuoted: PKR ${quotedPrice} | Extra requested: PKR ${extraCharge}\nApproved extra: PKR ${approvedExtra}\nTotal fair price: PKR ${quotedPrice + approvedExtra}`,
    simulated_whatsapp: `Overrun Dispute — GharFix\nBooking: ${f.booking_id}\nDecision: ${decision}\nTotal fair charge: PKR ${quotedPrice + approvedExtra}`,
    workflow: 'WF6-Overrun',
    timestamp: ctx.now.toISOString(),
  };
}

const HANDLERS: Record<DisputeType, (f: DisputeFacts, c: DisputeClaims, ctx: DecisionContext) => Resolution> = {
  no_show: noShow,
  provider_cancelled: providerCancelled,
  quality_complaint: qualityComplaint,
  price_disagreement: priceDisagreement,
  overrun,
};

export function decideDispute(facts: DisputeFacts, claims: DisputeClaims, ctx: DecisionContext): Resolution {
  return HANDLERS[claims.dispute_type](facts, claims, ctx);
}
