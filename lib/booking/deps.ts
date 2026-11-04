import type { HttpResult } from '../http/errors.js';
import { internalError } from '../http/errors.js';
import type { LocalHandler } from '../http/proxy.js';
import type { Logger } from '../log.js';
import { emailSenderFromEnv, type EmailSender } from '../email/index.js';
import { resilientEmail, resilientRepository, type IncidentRecorder } from '../resilience/index.js';
import { errorClass, payloadHash } from '../resilience/incidents.js';
import { defaultBookingId, handleBookingRequest, type BookingDeps } from './handler.js';
import { createSupabaseRepository, supabaseConfigFromEnv } from './repository.js';

export type Env = Record<string, string | undefined>;
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface BookingDepsOptions {
  env: Env;
  log: Logger;
  fetch?: FetchLike;
  email?: EmailSender;
  /** When set, Supabase and SMTP calls go through lib/resilience (retries where safe, incidents, alerts). */
  recorder?: IncidentRecorder;
}

/** How long the customer's confirm request waits for the email (lib/resilience times the send out). */
export const EMAIL_WAIT_MS = 5000;

/** Real dependencies from environment variables. Throws (naming the variable) if Supabase is not configured. */
export function createBookingDeps({ env, log, fetch, email }: BookingDepsOptions): BookingDeps {
  const db = createSupabaseRepository(supabaseConfigFromEnv(env), { fetch, log });
  return {
    db,
    email: email ?? emailSenderFromEnv(env, log),
    newBookingId: defaultBookingId,
    now: () => new Date(),
    log,
  };
}

/**
 * The khadmat-booking route. Dependencies are built on the first request and
 * reused while the function instance stays warm. A configuration error is
 * logged and answered with a 500, and retried on the next request.
 */
export function createBookingRoute(
  opts: BookingDepsOptions,
  makeDeps: (opts: BookingDepsOptions) => BookingDeps = createBookingDeps,
): LocalHandler {
  let deps: BookingDeps | null = null;
  return async (body, meta): Promise<HttpResult<unknown>> => {
    if (!deps) {
      try {
        deps = makeDeps(opts);
      } catch (err) {
        opts.log.error('booking.config_error', { error: err, request_id: meta.requestId });
        await opts.recorder?.record(
          { workflow: 'khadmat-booking', step: 'config', error_class: errorClass(err), retryable: false, auto_fixed: false, request_id: meta.requestId, payload_hash: payloadHash('khadmat-booking', 'config', errorClass(err)) },
          // Our config errors name the variable, never its value.
          { tried: 'Not retried: configuration does not fix itself.', detail: err instanceof Error ? err.message : undefined },
        );
        return internalError();
      }
    }
    const log = deps.log.child({ request_id: meta.requestId });
    if (!opts.recorder) return handleBookingRequest(body, { ...deps, log });
    const ctx = { workflow: 'khadmat-booking', requestId: meta.requestId, recorder: opts.recorder };
    return handleBookingRequest(body, {
      ...deps,
      log,
      db: resilientRepository(deps.db, ctx),
      email: resilientEmail(deps.email, ctx, EMAIL_WAIT_MS),
      // The wrapper times the send out at EMAIL_WAIT_MS and records it; this is only a backstop.
      emailTimeoutMs: EMAIL_WAIT_MS + 500,
    });
  };
}
