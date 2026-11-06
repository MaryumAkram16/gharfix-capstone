import type { BookingPatch, BookingRecord } from '../booking/records.js';

// WF5 "Service Quality Loop": the four stage Code nodes (En Route, Arrived,
// Completed, Feedback Processor) and the Trace Guard state machine. Rules,
// keyword lists, formulas and messages are n8n's (tests/quality/stages.test.ts
// runs the original nodes next to these). What changed:
//
// - The Trace Guard is enforced. In n8n it read the booking row, which has no
//   `action`, so every request was "invalid_action", and the merge after it
//   let every request through anyway. Here: en_route -> arrived -> completed
//   -> feedback, in that order, once each; feedback locks tracking.
// - No invented numbers. n8n used a random 5-15 km distance when none was
//   sent (a random ETA), and computed the provider's new rating from a fixed
//   "old rating 4.1 over 28 reviews" for every provider. Here: the distance
//   and the rating/review count saved on the booking, or null when unknown.
// - Facts come from the booking row: price, provider, service, location,
//   email. The final price is the one recorded on the booking, never a
//   browser-sent final_price_pkr (a customer could set it, then dispute it).
// - Times are Pakistan time; n8n used the server clock (UTC on Vercel).
// - An unknown service gets a generic checklist (n8n gave it the AC-repair one).
// - Messages say GharFix, not Khadmat AI.

export const STAGES = ['en_route', 'arrived', 'completed', 'feedback'] as const;
export type Stage = (typeof STAGES)[number];

/** Trace Guard's transition table: the tracking position a stage may follow. */
export const ALLOWED_FROM: Record<Stage, readonly string[]> = {
  en_route: ['booked', 'confirmed'],
  arrived: ['en_route'],
  completed: ['arrived'],
  feedback: ['completed'],
};

/** Booking statuses that can be tracked at all. A disputed, cancelled or no-show booking cannot. */
export const TRACKABLE_STATUSES = ['confirmed', 'in_progress'] as const;

export type Guard =
  | { kind: 'allow'; from: string }
  | { kind: 'repeat' }
  | { kind: 'locked'; message: string }
  | { kind: 'invalid_state'; message: string };

/** Where the booking is in the tracking flow: current_status, or "confirmed" before the first stage. */
export function trackingPosition(row: BookingRecord): string {
  return typeof row.current_status === 'string' && row.current_status ? row.current_status : 'confirmed';
}

export function guardStage(row: BookingRecord, stage: Stage): Guard {
  if (row.tracking_locked === true || row.tracking_locked === 'true' || row.status === 'feedback_done' || row.current_status === 'feedback_done') {
    return { kind: 'locked', message: 'This booking has already been tracked and feedback submitted. No further actions allowed.' };
  }
  if (!(TRACKABLE_STATUSES as readonly string[]).includes(String(row.status))) {
    return { kind: 'invalid_state', message: `This booking cannot be tracked: its status is '${row.status}'.` };
  }
  if (row.last_action === stage) return { kind: 'repeat' };
  const from = trackingPosition(row);
  if (!ALLOWED_FROM[stage].includes(from)) {
    return { kind: 'invalid_state', message: `Cannot move to '${stage}' from current status '${from}'. Expected one of: ${ALLOWED_FROM[stage].join(', ')}` };
  }
  return { kind: 'allow', from };
}

const PKT_OFFSET_MS = 5 * 3600_000;
/** "HH:MM" in Pakistan time. */
export function pktClock(d: Date): string {
  return new Date(d.getTime() + PKT_OFFSET_MS).toISOString().slice(11, 16);
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export interface StageFacts {
  booking_id: string;
  provider_id: string;
  provider_name: string;
  service_type: string;
  location: string;
  user_email: string | null;
  price_pkr: number;
  final_price_pkr: number | null;
  distance_km: number | null;
  provider_rating: number | null;
  provider_review_count: number | null;
  arrival_time: string | null;
}

export function stageFacts(row: BookingRecord): StageFacts {
  return {
    booking_id: row.booking_id,
    provider_id: row.provider_id ?? '',
    provider_name: row.provider_name ?? '',
    service_type: row.service_type ?? '',
    location: row.location ?? '',
    user_email: row.user_email,
    price_pkr: num(row.price_pkr) ?? 0,
    final_price_pkr: num(row.final_price_pkr),
    distance_km: num(row.provider_distance_km),
    provider_rating: num(row.provider_rating),
    provider_review_count: num(row.provider_review_count),
    arrival_time: typeof row.arrival_time === 'string' ? row.arrival_time : null,
  };
}

export interface StageResult {
  body: Record<string, unknown> & { status: string; workflow: string };
  patch: BookingPatch;
}

const traceKey = (id: string, stage: Stage) => `${id}-${stage}`;

export function enRoute(f: StageFacts, now: Date): StageResult {
  const etaMinutes = f.distance_km === null ? null : Math.round(f.distance_km * 3 + 5);
  const etaText = etaMinutes === null ? null
    : etaMinutes <= 10 ? 'approximately 10 minutes'
    : etaMinutes <= 20 ? 'approximately 15-20 minutes'
    : `approximately ${etaMinutes} minutes`;
  const arrivalStr = etaMinutes === null ? null : pktClock(new Date(now.getTime() + etaMinutes * 60000));
  const providerName = f.provider_name || 'Your Provider';
  return {
    body: {
      status: 'en_route',
      booking_id: f.booking_id,
      provider_name: providerName,
      service_type: f.service_type,
      user_email: f.user_email,
      eta_minutes: etaMinutes,
      estimated_arrival_time: arrivalStr,
      customer_location: f.location,
      live_tracking_simulated: true,
      simulated_whatsapp:
        'Assalam o Alaikum!\n' +
        `Your provider ${f.provider_name || 'is'} is on the way!\n` +
        (etaText ? `ETA: ${etaText} (around ${arrivalStr})\n` : 'ETA: the provider will share it\n') +
        `Booking: ${f.booking_id}`,
      checklist_reminder: ['Ensure access to service area', 'Have booking ID ready: ' + f.booking_id, 'Cash prepared: PKR ' + (f.price_pkr || 'as quoted')],
      workflow: 'WF5-EnRoute',
      timestamp: now.toISOString(),
    },
    patch: { last_action: 'en_route', current_status: 'en_route', trace_key: traceKey(f.booking_id, 'en_route'), eta_minutes: etaMinutes, updated_at: now.toISOString() },
  };
}

const CHECKLISTS: Record<string, string[]> = {
  'AC repair': ['Check power supply & thermostat', 'Inspect filters and coils', 'Test compressor operation', 'Check refrigerant pressure', 'Clean drainage pipe', 'Test cooling performance', 'Document fault found'],
  'AC installation': ['Verify wall bracket position', 'Run copper piping', 'Connect electrical wiring', 'Install indoor unit', 'Install outdoor unit', 'Vacuum and charge refrigerant', 'Test full system operation'],
  'AC gas refill': ['Check for leaks first', 'Evacuate old gas if needed', 'Recharge refrigerant to spec', 'Check operating pressure', 'Test cooling performance'],
  plumber: ['Identify leak/blockage source', 'Turn off water supply', 'Replace or repair component', 'Check for secondary leaks', 'Restore water supply and test'],
  electrician: ['Check circuit breaker/fuse', 'Test voltage at fault point', 'Identify wiring issue', 'Repair or replace component', 'Test load under full power'],
  carpenter: ['Measure and mark work area', 'Prepare materials', 'Execute carpentry task', 'Sand and finish if needed', 'Clean work area'],
  painter: ['Prepare surface (clean, sand, fill)', 'Apply primer if needed', 'Apply first coat', 'Allow drying time', 'Apply final coat', 'Inspect finish quality'],
  'generator mechanic': ['Check fuel level and oil', 'Inspect spark plugs', 'Test battery voltage', 'Start and monitor RPM', 'Check output voltage', 'Document work done'],
};
const GENERIC_CHECKLIST = ['Confirm the job with the customer', 'Prepare the work area', 'Do the work', 'Check the result with the customer', 'Clean up'];

export function checklistFor(serviceType: string): string[] {
  const s = serviceType.toLowerCase();
  const key = Object.keys(CHECKLISTS).find((k) => s.includes(k.toLowerCase()));
  return key ? CHECKLISTS[key] : GENERIC_CHECKLIST;
}

export function arrived(f: StageFacts, now: Date): StageResult {
  const items = checklistFor(f.service_type);
  const checklist = items.map((task, i) => ({ step: i + 1, task, completed: false, photo_required: i === items.length - 1 }));
  const clock = pktClock(now);
  return {
    body: {
      status: 'arrived',
      booking_id: f.booking_id,
      provider_name: f.provider_name,
      service_type: f.service_type,
      user_email: f.user_email,
      arrival_time: clock,
      arrival_timestamp: now.toISOString(),
      customer_location: f.location,
      service_checklist: checklist,
      photo_evidence_placeholder: { before_photo: 'PHOTO_UPLOAD_SLOT — Before work begins', after_photo: 'PHOTO_UPLOAD_SLOT — After work completed' },
      simulated_whatsapp: `Provider Arrived — GharFix\n${f.provider_name} pahunch gaye hain!\nArrival: ${clock}\nService: ${f.service_type}\nBooking: ${f.booking_id}\nKaam shuru ho raha hai.`,
      workflow: 'WF5-Arrived',
      timestamp: now.toISOString(),
    },
    patch: { last_action: 'arrived', current_status: 'arrived', trace_key: traceKey(f.booking_id, 'arrived'), arrival_time: now.toISOString(), updated_at: now.toISOString() },
  };
}

export interface CompletedInput {
  before_photo_url: string | null;
  after_photo_url: string | null;
  checklist_completed: boolean;
}

export function completed(f: StageFacts, input: CompletedInput, now: Date): StageResult {
  let durationText = 'Not recorded';
  const arrivedAt = f.arrival_time ? Date.parse(f.arrival_time.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(f.arrival_time) ? f.arrival_time : `${f.arrival_time}Z`) : NaN;
  if (!Number.isNaN(arrivedAt)) {
    const durationMins = Math.round((now.getTime() - arrivedAt) / 60000);
    durationText = durationMins > 0 ? `${durationMins} minutes` : 'Under 1 minute';
  }
  const quotedPrice = f.price_pkr;
  const finalPrice = f.final_price_pkr ?? quotedPrice;
  const priceVariance = finalPrice - quotedPrice;
  const priceStatus = priceVariance === 0 ? 'exact' : priceVariance > 0 ? 'overrun' : 'underrun';
  const clock = pktClock(now);
  return {
    body: {
      status: 'completed',
      booking_id: f.booking_id,
      provider_name: f.provider_name,
      service_type: f.service_type,
      user_email: f.user_email,
      location: f.location,
      completion_time: clock,
      completion_timestamp: now.toISOString(),
      duration: durationText,
      payment: {
        quoted_pkr: quotedPrice,
        final_pkr: finalPrice,
        variance_pkr: priceVariance,
        price_status: priceStatus,
        price_note: priceVariance > 0
          ? `Final price PKR ${priceVariance} zyada hai quote se. Dispute ke liye WF6 mein report karein.`
          : priceVariance < 0 ? `Final price PKR ${Math.abs(priceVariance)} kam hai — discount!` : 'Final price matches quote exactly.',
      },
      photo_evidence_placeholder: {
        before_photo: input.before_photo_url || 'BEFORE_PHOTO — Not uploaded',
        after_photo: input.after_photo_url || 'AFTER_PHOTO — Not uploaded',
      },
      checklist_completed: input.checklist_completed,
      feedback_requested: true,
      feedback_payload_example: { action: 'feedback', booking_id: f.booking_id, provider_id: f.provider_id, provider_name: f.provider_name, rating: 5, review: 'Bahut acha kaam kiya' },
      simulated_whatsapp: `Service Complete — GharFix\n${f.provider_name} ne kaam mukammal kar diya!\nService: ${f.service_type}\nFinal Amount: PKR ${finalPrice}\nBooking: ${f.booking_id}\nApni feedback zaroor dein!`,
      workflow: 'WF5-Completed',
      timestamp: now.toISOString(),
    },
    patch: { last_action: 'completed', current_status: 'completed', trace_key: traceKey(f.booking_id, 'completed'), completion_time: now.toISOString(), updated_at: now.toISOString() },
  };
}

export const POSITIVE_KEYWORDS = ['acha', 'badhiya', 'zabardast', 'great', 'excellent', 'good', 'perfect', 'fast', 'professional', 'recommend', 'satisfied', 'happy', 'best', 'top', 'waqt par', 'punctual'];
export const NEGATIVE_KEYWORDS = ['bura', 'ganda', 'late', 'delay', 'kharab', 'worst', 'bad', 'slow', 'unprofessional', 'disappointed', 'overcharge', 'zyada charge', 'no show', 'nahi aaya', 'bakwaas'];

export interface FeedbackInput {
  rating: number;
  review: string;
  transcript_text: string;
  transcript_included: boolean;
  images: string[];
}

export function feedback(f: StageFacts, input: FeedbackInput, now: Date, previousStatus: string | null): StageResult & { escalate: boolean } {
  const { rating, review, images } = input;
  const transcript = input.transcript_text;
  const providerName = f.provider_name || 'Provider';
  const imageCount = images.length;
  const hasImages = imageCount > 0;
  const transcriptIncluded = input.transcript_included || transcript.trim().length > 0;

  const fullText = `${review} ${transcript}`.toLowerCase();
  const positiveFound = POSITIVE_KEYWORDS.filter((w) => fullText.includes(w));
  const negativeFound = NEGATIVE_KEYWORDS.filter((w) => fullText.includes(w));
  const sentiment = negativeFound.length > positiveFound.length ? 'negative'
    : positiveFound.length > negativeFound.length ? 'positive'
    : rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral';

  // n8n: (4.1 * 28 + rating) / 29 for every provider. Here: what the booking recorded, if anything.
  const oldRating = f.provider_rating;
  const reviewCount = f.provider_review_count;
  const known = oldRating !== null && reviewCount !== null;
  const newRating = known ? Number(((oldRating * reviewCount + rating) / (reviewCount + 1)).toFixed(2)) : rating;
  const delta = known ? Number((newRating - oldRating).toFixed(2)) : null;

  let matchingImpact = 'none';
  let flagForReview = false;
  if (rating <= 2) { matchingImpact = 'score_penalized'; flagForReview = true; }
  else if (rating >= 5 && sentiment === 'positive') matchingImpact = 'score_boosted';

  const triggerDispute = rating <= 2 || (sentiment === 'negative' && negativeFound.length >= 2);

  const result = {
    status: 'feedback_received',
    booking_id: f.booking_id,
    provider_id: f.provider_id,
    provider_name: providerName,
    service_type: f.service_type,
    user_email: f.user_email,
    submitted_rating: rating,
    review_text: review,
    transcript_text: transcript,
    transcript_included: transcriptIncluded,
    sentiment,
    sentiment_signals: { positive_keywords_found: positiveFound, negative_keywords_found: negativeFound },
    images_attached: imageCount,
    image_count: imageCount,
    has_image_evidence: hasImages,
    evidence_summary: hasImages ? `${imageCount} photo(s) attached as evidence` : transcriptIncluded ? 'Voice transcript included as evidence' : 'Text review only',
    reputation_update: {
      old_rating: oldRating,
      new_rating: newRating,
      delta,
      review_count_new: known ? reviewCount + 1 : 1,
      direction: delta === null ? 'First rating on record' : delta >= 0 ? 'Improved' : 'Declined',
    },
    matching_impact: {
      impact_type: matchingImpact,
      flag_for_manual_review: flagForReview,
      future_ranking_note: matchingImpact === 'score_penalized'
        ? `${providerName} will rank lower in future searches until rating recovers.`
        : matchingImpact === 'score_boosted' ? `${providerName} gets a ranking boost — excellent review!` : 'No change to ranking.',
    },
    escalate_to_wf6: triggerDispute,
    escalation_reason: triggerDispute ? 'Low rating or negative review keywords detected' : null,
    customer_message: rating >= 4
      ? `Shukriya! ${rating}-star review save ho gaya.${hasImages ? ' Photos bhi save ho gayi hain.' : ''} ${providerName} ko future mein priority di jaegi.`
      : rating === 3 ? `Shukriya feedback ke liye. Hum ${providerName} ki service improve karne ki koshish karenge.`
      : 'Humein afsos hai. Hum is mamle ko investigate karenge aur aap se rabta karenge.',
    workflow: 'WF5-Feedback',
    timestamp: now.toISOString(),
  };

  return {
    body: result,
    escalate: triggerDispute,
    patch: {
      customer_rating: rating,
      customer_review: review,
      customer_transcript: transcript,
      feedback_sentiment: sentiment,
      images_attached: String(imageCount),
      transcript_included: String(transcriptIncluded),
      image_base64_data: hasImages ? JSON.stringify(images) : null,
      provider_new_rating: newRating,
      flagged_for_review: flagForReview,
      status: 'feedback_done',
      previous_status: previousStatus,
      last_action: 'feedback',
      current_status: 'feedback_done',
      tracking_status: 'tracked',
      tracked_once: true,
      tracking_locked: true,
      trace_key: traceKey(f.booking_id, 'feedback'),
      updated_at: now.toISOString(),
    },
  };
}
