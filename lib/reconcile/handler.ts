import { timingSafeEqual, createHash } from 'node:crypto';
import { deliverConfirmation, receiptFromRow } from '../booking/handler.js';
import type { BookingRepository, ReconcileReader } from '../booking/repository.js';
import type { EmailSender } from '../email/types.js';
import { fail, ok, type HttpResult } from '../http/errors.js';
import type { Logger } from '../log.js';

// Re-sends booking confirmations that never went out (SMTP was down, timed
// out, or only the console fallback was configured). Called every 15 minutes
// by .github/workflows/reconcile.yml through api/reconcile.ts.
//
// Safe to run any number of times: it only picks bookings whose
// confirmation_sent_at is NULL, and sets it after a real SMTP send
// (first write wins). Window:
//   - older than 5 minutes: never races the booking request's own send
//   - newer than 24 hours: customers from before db/002 are never re-emailed

export const MIN_AGE_MS = 5 * 60 * 1000;
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const BATCH_LIMIT = 20;
export const TIME_BUDGET_MS = 40_000;

export interface ReconcileDeps {
  db: ReconcileReader & Pick<BookingRepository, 'markConfirmationSent'>;
  email: EmailSender;
  now: () => Date;
  log: Logger;
  /** Which addresses get mail. Default: valid syntax, not a reserved test domain. */
  deliverable?: (email: string) => boolean;
  emailTimeoutMs?: number;
}

export interface ReconcileResult {
  /** Bookings due a confirmation, with a real address. */
  found: number;
  /** Sent now and recorded. */
  fixed: number;
  /** Send failed (or only logged); left for the next run. */
  failed: number;
  /** Matched the query but the address is a test/reserved domain: never mailed. */
  skipped: number;
  /** Not attempted this run because the time budget ran out. */
  deferred: number;
}

// RFC 2606 / 6761 reserved names: test bookings (BK-TEST-..., @example.test) must never be mailed.
const RESERVED = /(^|\.)(test|example|invalid|localhost)$|(^|\.)example\.(com|net|org)$/i;

export function isDeliverableAddress(email: string): boolean {
  const m = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec(email.trim());
  return m !== null && !RESERVED.test(m[1]);
}

export async function reconcileConfirmations(deps: ReconcileDeps, opts: { limit?: number; budgetMs?: number } = {}): Promise<ReconcileResult> {
  const { limit = BATCH_LIMIT, budgetMs = TIME_BUDGET_MS } = opts;
  const deliverable = deps.deliverable ?? isDeliverableAddress;
  const started = deps.now();
  const rows = await deps.db.findUnconfirmed({
    createdBefore: new Date(started.getTime() - MIN_AGE_MS),
    createdAfter: new Date(started.getTime() - MAX_AGE_MS),
    limit,
  });

  const result: ReconcileResult = { found: 0, fixed: 0, failed: 0, skipped: 0, deferred: 0 };
  const due = rows.filter((row) => {
    const ok = typeof row.user_email === 'string' && deliverable(row.user_email);
    if (!ok) result.skipped++;
    return ok;
  });
  result.found = due.length;

  for (const [i, row] of due.entries()) {
    if (deps.now().getTime() - started.getTime() > budgetMs) {
      result.deferred = due.length - i;
      break;
    }
    const log = deps.log.child({ booking_id: row.booking_id });
    const outcome = await deliverConfirmation(receiptFromRow(row, deps.now()), deps, log);
    if (outcome === 'sent') result.fixed++;
    else result.failed++; // 'failed', or 'logged' (console fallback: nothing reached the customer)
  }

  deps.log.info('reconcile.done', { ...result, email_configured: !deps.email.logsOnly });
  return result;
}

/** Bearer-token check against CRON_SECRET, in constant time. */
export function bearerMatches(authorization: string | null, secret: string): boolean {
  const presented = /^Bearer (.+)$/.exec(authorization ?? '')?.[1] ?? '';
  // Compare digests so the lengths always match and timing reveals nothing.
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(secret).digest();
  return presented !== '' && timingSafeEqual(a, b);
}

export type ReconcileRunner = (requestId: string | null) => Promise<ReconcileResult>;

/** HTTP shell for api/reconcile.ts: auth, then run. */
export async function handleReconcileRequest(
  authorization: string | null,
  cronSecret: string | undefined,
  run: ReconcileRunner,
  requestId: string | null,
  log: Logger,
): Promise<HttpResult> {
  if (!cronSecret?.trim()) {
    log.error('reconcile.not_configured', { missing: 'CRON_SECRET' });
    return fail('internal_error', 'Reconcile is not configured (CRON_SECRET is not set).');
  }
  if (!bearerMatches(authorization, cronSecret.trim())) {
    log.warn('reconcile.unauthorized', { request_id: requestId });
    return fail('unauthorized', 'Missing or wrong bearer token.');
  }
  try {
    return ok({ status: 'ok', ...(await run(requestId)) });
  } catch (err) {
    // findUnconfirmed failed after its retries (already recorded as an incident).
    log.error('reconcile.failed', { error: err, request_id: requestId });
    return fail('service_unavailable', 'Could not read bookings; the next scheduled run will try again.', { retryable: true });
  }
}
