import { RepositoryError } from '../booking/repository.js';
import type { BookingRecord, BookingRecords } from '../booking/records.js';
import { BOOKING_ID } from '../dispute/validate.js';
import type { EmailSender } from '../email/types.js';
import { fail, internalError, ok, serviceUnavailable, validationError, type HttpResult } from '../http/errors.js';
import type { Logger } from '../log.js';
import { withTimeout } from '../resilience/retry.js';
import { stageEmail } from './email.js';
import { arrived, completed, enRoute, feedback, guardStage, stageFacts, STAGES, trackingPosition, type FeedbackInput, type Stage, type StageResult } from './stages.js';

// khadmat-quality (WF5). Order: validate -> read the booking -> check the
// caller's email -> Trace Guard -> build the stage response -> save it
// (compare-and-set on status and tracking position) -> email -> respond.
// Feedback with a low rating or negative keywords is escalated to WF6
// in-process (n8n POSTed to its own, now dead, host).
//
// A repeated stage (en_route twice, e.g. the tracking page reopened) answers
// with that stage again, marked already_recorded, without saving or emailing.

export interface QualityDeps {
  records: BookingRecords;
  email: EmailSender;
  now: () => Date;
  log: Logger;
  emailTimeoutMs?: number;
  /** WF6, in-process. Gets the booking's own email. */
  escalate: (body: Record<string, unknown>) => Promise<HttpResult<unknown>>;
}

const MAX_IMAGES = 3;
const MAX_IMAGE_CHARS = 1_500_000;
const IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

function lockedBody(bookingId: string, message: string) {
  return { status: 'tracking_locked', tracking_locked: true, show_track_button: false, show_feedback_button: false, message, booking_id: bookingId };
}

function photoUrl(v: unknown): string | null {
  return typeof v === 'string' && /^https:\/\/\S{1,500}$/.test(v) ? v : null;
}

function feedbackInput(body: Record<string, unknown>): { value?: FeedbackInput; problems?: string[] } {
  const problems: string[] = [];
  const rating = typeof body.rating === 'number' ? body.rating : typeof body.rating === 'string' && body.rating.trim() ? Number(body.rating) : NaN;
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) problems.push('rating');
  const str = (v: unknown, max: number, field: string) => {
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string') { problems.push(field); return ''; }
    return v.trim().slice(0, max);
  };
  const review = str(body.review, 2000, 'review');
  const transcript = str(body.transcript_text, 5000, 'transcript_text');
  const raw = Array.isArray(body.image_base64_array) ? body.image_base64_array : [];
  // n8n kept any string over 100 characters. Here: up to 3 JPEG/PNG/WebP data URLs of sane size.
  const images = raw.filter((img): img is string => typeof img === 'string' && img.length > 100 && img.length <= MAX_IMAGE_CHARS && IMAGE.test(img));
  if (raw.length > MAX_IMAGES) problems.push('image_base64_array');
  if (problems.length) return { problems };
  return { value: { rating, review, transcript_text: transcript, transcript_included: body.transcript_included === true, images } };
}

async function sendEmail(stage: Stage, row: BookingRecord, body: Record<string, unknown>, deps: QualityDeps, log: Logger): Promise<string> {
  if (!row.user_email) return 'skipped';
  try {
    await withTimeout(Promise.resolve().then(() => deps.email.send(stageEmail(stage, row.user_email!, body))), deps.emailTimeoutMs ?? 5000, 'quality email');
  } catch (err) {
    log.error('quality.email_failed', { error: err });
    return 'failed';
  }
  return deps.email.logsOnly ? 'logged' : 'sent';
}

/** Entry point for POST khadmat-quality. Never throws. */
export async function handleQualityRequest(body: Record<string, unknown>, deps: QualityDeps): Promise<HttpResult<unknown>> {
  // n8n default: no action means en_route.
  const action = body.action === undefined || body.action === null || body.action === '' ? 'en_route' : body.action;
  const problems: string[] = [];
  if (!(STAGES as readonly unknown[]).includes(action)) problems.push('action');
  const bookingId = typeof body.booking_id === 'string' ? body.booking_id.trim() : '';
  if (!BOOKING_ID.test(bookingId)) problems.push('booking_id');
  const fb = action === 'feedback' ? feedbackInput(body) : {};
  if (fb.problems) problems.push(...fb.problems);
  if (problems.length) return validationError(`Invalid fields: ${problems.join(', ')}`, problems);
  const stage = action as Stage;
  const userEmail = typeof body.user_email === 'string' ? body.user_email.trim().toLowerCase() : '';
  const log = deps.log.child({ booking_id: bookingId, action: stage });

  try {
    const row = await deps.records.find(bookingId);
    if (!row) return fail('not_found', 'Booking not found.', { booking_id: bookingId });
    const owner = row.user_email?.trim().toLowerCase();
    if (owner && owner !== userEmail) {
      log.warn('quality.email_mismatch');
      return fail('forbidden', 'This booking was made with a different email address.');
    }

    const guard = guardStage(row, stage);
    if (guard.kind === 'locked') return ok(lockedBody(bookingId, guard.message));
    if (guard.kind === 'invalid_state') {
      // n8n's Trace Guard body, now with a 409 (n8n never enforced it).
      return { status: 409, body: { status: 'blocked_invalid_state', message: guard.message, booking_id: bookingId, tracking_locked: false } };
    }

    const now = deps.now();
    const f = stageFacts(row);
    const built: StageResult & { escalate?: boolean } =
      stage === 'en_route' ? enRoute(f, now)
      : stage === 'arrived' ? arrived(f, now)
      : stage === 'completed' ? completed(f, { before_photo_url: photoUrl(body.before_photo_url), after_photo_url: photoUrl(body.after_photo_url), checklist_completed: body.checklist_completed === true }, now)
      : feedback(f, fb.value!, now, row.status);

    if (guard.kind === 'repeat') {
      log.info('quality.already_recorded');
      return ok({ ...built.body, already_recorded: true });
    }

    const saved = await deps.records.update(bookingId, built.patch, { status: [String(row.status)], current_status: typeof row.current_status === 'string' ? row.current_status : null });
    if (!saved) {
      log.warn('quality.changed_meanwhile', { read_position: trackingPosition(row) });
      return fail('conflict', 'This booking changed while your request was processed. Please refresh and try again.', { retryable: true });
    }

    if (stage !== 'feedback') {
      const email = await sendEmail(stage, row, built.body, deps, log);
      log.info('quality.stage_saved', { email });
      return ok({ ...built.body, email });
    }

    // Feedback: the frontend reads the feedback fields at the top level; n8n nested them under `feedback`. Both are sent.
    const fbBody = built.body;
    const common = { ...fbBody, tracking_locked: true, show_track_button: false, show_feedback_button: false, booking_id: bookingId, feedback: fbBody };
    if (built.escalate) {
      const dispute = await deps.escalate({
        trigger: 'low_rating_auto_escalation', dispute_type: 'quality_complaint', auto_escalated: true, booking_id: bookingId,
        user_email: row.user_email ?? '', rating: fbBody.submitted_rating, review: fbBody.review_text, sentiment: fbBody.sentiment,
      });
      if (dispute.status === 200) {
        log.info('quality.feedback_escalated');
        return ok({ ...common, status: 'feedback_saved_and_escalated', wf6_triggered: true, dispute: dispute.body, message: `${fbBody.customer_message}.` });
      }
      // The feedback is saved either way; WF6 recorded its own failure.
      log.error('quality.escalation_failed', { http_status: dispute.status });
      return ok({ ...common, status: 'feedback_saved', wf6_triggered: false, escalation_failed: true, message: 'Shukriya! Aapka feedback save ho gaya. Hamari team aap se rabta karegi.' });
    }
    const email = await sendEmail('feedback', row, fbBody, deps, log);
    log.info('quality.feedback_saved', { email });
    return ok({ ...common, status: 'feedback_saved', email, message: 'Shukriya! Aapka feedback save ho gaya. Tracking complete.' });
  } catch (err) {
    if (err instanceof RepositoryError && err.kind === 'unavailable') {
      log.error('quality.db_unavailable', { error: err });
      return serviceUnavailable();
    }
    log.error('quality.unhandled_error', { error: err });
    return internalError();
  }
}
