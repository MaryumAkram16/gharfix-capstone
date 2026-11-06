import { RepositoryError } from '../booking/repository.js';
import type { BookingRecord, BookingRecords } from '../booking/records.js';
import type { EmailSender } from '../email/types.js';
import { fail, internalError, ok, serviceUnavailable, validationError, type HttpResult } from '../http/errors.js';
import type { Logger } from '../log.js';
import { withTimeout } from '../resilience/retry.js';
import { decideDispute, STATUS_FOR_DISPUTE, type DisputeFacts, type Resolution } from './decide.js';
import { disputeEmail } from './email.js';
import { validateDispute } from './validate.js';

// khadmat-dispute (WF6). Order: validate -> read the booking -> check the
// caller's email matches it -> decide -> record the status (compare-and-set
// on the status read, so two submissions cannot both apply) -> email the
// customer at the booking's address -> respond with WF6's resolution JSON.
//
// A repeat of the same dispute (status already set to it) answers with the
// decision again, marked already_recorded, and does not email again.

export interface DisputeDeps {
  records: BookingRecords;
  email: EmailSender;
  now: () => Date;
  log: Logger;
  newTicketId?: () => string;
  emailTimeoutMs?: number;
}

export type EmailOutcome = 'sent' | 'logged' | 'failed' | 'skipped';

function facts(row: BookingRecord): DisputeFacts {
  const n = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    booking_id: row.booking_id,
    provider_id: row.provider_id ?? '',
    provider_name: row.provider_name ?? 'Your provider',
    user_email: row.user_email,
    user_name: row.user_name,
    service_type: row.service_type ?? '',
    location: row.location ?? '',
    booking_date: row.booking_date,
    slot: row.slot,
    price_pkr: n(row.price_pkr) ?? 0,
    final_price_pkr: n(row.final_price_pkr),
    customer_rating: n(row.customer_rating),
    feedback_sentiment: row.feedback_sentiment,
  };
}

async function sendEmail(row: BookingRecord, resolution: Resolution, deps: DisputeDeps, log: Logger): Promise<EmailOutcome> {
  if (!row.user_email) return 'skipped';
  try {
    const message = disputeEmail(row.user_email, row.user_name, row.provider_name ?? 'Your provider', resolution);
    await withTimeout(Promise.resolve().then(() => deps.email.send(message)), deps.emailTimeoutMs ?? 5000, 'dispute email');
  } catch (err) {
    log.error('dispute.email_failed', { error: err });
    return 'failed';
  }
  return deps.email.logsOnly ? 'logged' : 'sent';
}

/** Entry point for POST khadmat-dispute. Never throws. */
export async function handleDisputeRequest(body: Record<string, unknown>, deps: DisputeDeps): Promise<HttpResult<unknown>> {
  const v = validateDispute(body);
  if (v.problems) return validationError(`Invalid fields: ${v.problems.join(', ')}`, v.problems);
  const { bookingId, userEmail, claims } = v.value;
  const log = deps.log.child({ booking_id: bookingId, dispute_type: claims.dispute_type });

  try {
    const row = await deps.records.find(bookingId);
    if (!row) return fail('not_found', 'Booking not found.', { booking_id: bookingId });
    const owner = row.user_email?.trim().toLowerCase();
    if (owner && owner !== userEmail) {
      log.warn('dispute.email_mismatch');
      return fail('forbidden', 'This booking was made with a different email address.');
    }

    const f = facts(row);
    const history = claims.dispute_type === 'no_show' && f.provider_id ? await deps.records.providerHistory(f.provider_id) : null;
    const resolution = decideDispute(f, claims, {
      now: deps.now(),
      history,
      newTicketId: deps.newTicketId ?? (() => `TKT-${deps.now().getTime()}`),
    });

    const target = STATUS_FOR_DISPUTE[claims.dispute_type];
    if (row.status === target) {
      log.info('dispute.already_recorded');
      return ok({ ...resolution, already_recorded: true });
    }

    const updated = await deps.records.update(
      bookingId,
      { status: target, previous_status: row.status, flagged_for_review: true, updated_at: deps.now().toISOString() },
      row.status === null ? undefined : { status: [row.status] },
    );
    if (!updated) {
      log.warn('dispute.status_changed_meanwhile', { read_status: row.status });
      return fail('conflict', 'This booking changed while your request was processed. Please try again.', { retryable: true });
    }

    const email = await sendEmail(row, resolution, deps, log);
    log.info('dispute.recorded', { status: target, result: resolution.status, email });
    return ok({ ...resolution, email });
  } catch (err) {
    if (err instanceof RepositoryError && err.kind === 'unavailable') {
      log.error('dispute.db_unavailable', { error: err });
      return serviceUnavailable();
    }
    log.error('dispute.unhandled_error', { error: err });
    return internalError();
  }
}
