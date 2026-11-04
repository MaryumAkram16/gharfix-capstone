import { BookingConflictError, RepositoryError } from '../booking/repository.js';
import { IntentParserError } from '../intent/types.js';
import { MapsUnavailableError } from '../matching/directory.js';
import { exponentialBackoff, type RetryPolicy } from './retry.js';

// Which calls may be retried. The rule: only operations that cannot cause a
// second side effect when repeated.
//   - Supabase reads: yes.
//   - The booking insert: only when the row carries an idempotency_key. A
//     repeat after an unclear failure (timeout) either inserts once or hits
//     bookings_idempotency_key_key, which the handler turns into a replay.
//     Without a key, a repeat could create a second booking: never retried.
//   - Gemini: yes (a model call has no side effects), but not after a
//     timeout, which already spent the whole time budget.
//   - SMTP and any other write (markConfirmationSent, alert emails): never.
//     A retried send could email the customer twice; unsent confirmations
//     are re-sent by api/reconcile.ts, which checks confirmation_sent_at.

export const NO_RETRY: RetryPolicy = { attempts: 1, backoff: () => 0, isRetryable: () => false };

const supabaseTransient = (err: unknown) => err instanceof RepositoryError && err.kind === 'unavailable';

/** 3 tries, waiting 250 ms then 750 ms. */
export const SUPABASE_READ: RetryPolicy = { attempts: 3, backoff: exponentialBackoff(250), isRetryable: supabaseTransient };

/** Same as reads; only ever used for rows that carry an idempotency_key. */
export const SUPABASE_INSERT_WITH_KEY: RetryPolicy = { ...SUPABASE_READ };

/** 2 tries, 500 ms apart, on 429 / 5xx / network errors. */
export const GEMINI: RetryPolicy = {
  attempts: 2,
  backoff: () => 500,
  isRetryable: (err) => err instanceof IntentParserError && err.reason === 'unavailable' && !err.timedOut,
};

export function insertPolicy(row: { idempotency_key: string | null }): RetryPolicy {
  return row.idempotency_key ? SUPABASE_INSERT_WITH_KEY : NO_RETRY;
}

/**
 * Is the error itself temporary (outage, rate limit, timeout)? Recorded as
 * workflow_incidents.retryable whether or not the call was allowed to retry:
 * "transient, but not retried because a repeat could double-book" is useful.
 */
export function isTransient(err: unknown): boolean {
  if (err instanceof RepositoryError) return err.kind === 'unavailable';
  if (err instanceof IntentParserError) return err.reason === 'unavailable';
  if (err instanceof MapsUnavailableError) return true;
  if (err instanceof Error) {
    const code = (err as Error & { code?: unknown }).code;
    return err.name === 'TimeoutError' || ['ETIMEDOUT', 'ECONNECTION', 'ECONNRESET', 'ESOCKET', 'EDNS'].includes(String(code));
  }
  return false;
}

/** Outcomes that are business results, not failures: no incident. */
export function isExpectedOutcome(err: unknown): boolean {
  if (err instanceof BookingConflictError) return true; // slot taken / key replay
  if (err instanceof IntentParserError && err.reason === 'blocked') return true; // content the model refused
  return false;
}

export function describePolicy(policy: RetryPolicy, attemptsMade: number, waits: number[]): string {
  if (policy.attempts <= 1) return 'Not retried: repeating this call could act twice (double booking or a duplicate email).';
  if (attemptsMade <= 1) return 'Not retried: the error was not a temporary one.';
  return `Tried ${attemptsMade} times${waits.length ? `, waiting ${waits.map((w) => `${w} ms`).join(' then ')} between tries` : ''}.`;
}
