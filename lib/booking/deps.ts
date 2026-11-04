import type { HttpResult } from '../http/errors.js';
import { internalError } from '../http/errors.js';
import type { LocalHandler } from '../http/proxy.js';
import type { Logger } from '../log.js';
import { emailSenderFromEnv, type EmailSender } from '../email/index.js';
import { defaultBookingId, handleBookingRequest, type BookingDeps } from './handler.js';
import { createSupabaseRepository, supabaseConfigFromEnv } from './repository.js';

export type Env = Record<string, string | undefined>;
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface BookingDepsOptions {
  env: Env;
  log: Logger;
  fetch?: FetchLike;
  email?: EmailSender;
}

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
        return internalError();
      }
    }
    return handleBookingRequest(body, { ...deps, log: deps.log.child({ request_id: meta.requestId }) });
  };
}
