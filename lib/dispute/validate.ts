import { DISPUTE_TYPES, type Alternative, type DisputeClaims, type DisputeType } from './decide.js';

// Request checks for khadmat-dispute. n8n's Router accepted anything: an
// unknown dispute_type or a missing booking_id produced an error object that
// still flowed into the Overrun branch and PATCHed `booking_id=eq.undefined`.
// Here such requests stop with a 400 naming the fields.

export const BOOKING_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PKR = 10_000_000;
const MAX_MINUTES = 24 * 60;
const MAX_REVIEW = 2000;
const MAX_ALTERNATIVES = 5;

export interface DisputeRequest {
  bookingId: string;
  /** Who is asking (compared with the booking's email). Empty when not sent. */
  userEmail: string;
  claims: DisputeClaims;
}

export type Validated<T> = { value: T; problems?: undefined } | { value?: undefined; problems: string[] };

function num(v: unknown, min: number, max: number): number | null | undefined {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}

function bool(v: unknown): boolean | undefined {
  if (v === undefined || v === null || v === '') return false;
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  return undefined;
}

function text(v: unknown, max: number): string | undefined {
  if (v === undefined || v === null) return '';
  return typeof v === 'string' ? v.trim().slice(0, max) : undefined;
}

function alternatives(v: unknown): Alternative[] {
  if (!Array.isArray(v)) return [];
  const out: Alternative[] = [];
  for (const a of v.slice(0, MAX_ALTERNATIVES)) {
    if (!a || typeof a !== 'object') continue;
    const r = a as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id.slice(0, 200) : '';
    const name = typeof r.name === 'string' ? r.name.slice(0, 200) : '';
    if (!id || !name) continue;
    const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    out.push({
      id,
      name,
      computed_score: n(r.computed_score),
      rating: n(r.rating),
      distance_km: n(r.distance_km),
      estimated_arrival: typeof r.estimated_arrival === 'string' ? r.estimated_arrival.slice(0, 100) : null,
      availability_slots: Array.isArray(r.availability_slots) ? r.availability_slots.filter((s): s is string => typeof s === 'string').slice(0, 12) : [],
    });
  }
  return out;
}

export function validateDispute(body: Record<string, unknown>): Validated<DisputeRequest> {
  const problems: string[] = [];

  // n8n default: no dispute_type means a quality complaint.
  const rawType = body.dispute_type === undefined || body.dispute_type === null || body.dispute_type === '' ? 'quality_complaint' : body.dispute_type;
  const disputeType = (DISPUTE_TYPES as readonly unknown[]).includes(rawType) ? (rawType as DisputeType) : null;
  if (!disputeType) problems.push('dispute_type');

  const bookingId = typeof body.booking_id === 'string' ? body.booking_id.trim() : '';
  if (!BOOKING_ID.test(bookingId)) problems.push('booking_id');

  const userEmail = typeof body.user_email === 'string' ? body.user_email.trim().toLowerCase().slice(0, 254) : '';

  const rating = num(body.rating, 1, 5);
  if (rating === undefined) problems.push('rating');
  const charged = num(body.charged_price_pkr ?? body.final_price_pkr, 0, MAX_PKR);
  if (charged === undefined) problems.push('charged_price_pkr');
  const extra = num(body.extra_charge_pkr, 0, MAX_PKR);
  if (extra === undefined) problems.push('extra_charge_pkr');
  const estimated = num(body.estimated_duration_mins, 1, MAX_MINUTES);
  if (estimated === undefined) problems.push('estimated_duration_mins');
  const actual = num(body.actual_duration_mins, 1, MAX_MINUTES);
  if (actual === undefined) problems.push('actual_duration_mins');
  // n8n assumed 60 and 90 minutes: every overrun "took 30 minutes too long".
  if (disputeType === 'overrun') {
    if (estimated === null) problems.push('estimated_duration_mins');
    if (actual === null) problems.push('actual_duration_mins');
  }
  const notified = bool(body.customer_notified_before_overrun);
  if (notified === undefined) problems.push('customer_notified_before_overrun');
  const approved = bool(body.customer_approved_overrun);
  if (approved === undefined) problems.push('customer_approved_overrun');
  const autoEscalated = bool(body.auto_escalated);
  if (autoEscalated === undefined) problems.push('auto_escalated');

  const review = text(body.review ?? body.review_text ?? body.custom_reason, MAX_REVIEW);
  if (review === undefined) problems.push('review');
  const sentiment = typeof body.sentiment === 'string' && ['positive', 'neutral', 'negative'].includes(body.sentiment) ? body.sentiment : null;

  if (problems.length) return { problems: [...new Set(problems)] };
  return {
    value: {
      bookingId,
      userEmail,
      claims: {
        dispute_type: disputeType!,
        rating: rating ?? null,
        review: review!,
        sentiment,
        auto_escalated: autoEscalated!,
        charged_price_pkr: charged === null || charged === undefined ? null : Math.round(charged),
        extra_charge_pkr: Math.round(extra ?? 0),
        customer_notified_before_overrun: notified!,
        customer_approved_overrun: approved!,
        estimated_duration_mins: estimated ?? null,
        actual_duration_mins: actual ?? null,
        alternatives: alternatives(body.alternatives),
      },
    },
  };
}
