import { EMAIL_WAIT_MS, type Env, type FetchLike } from '../booking/deps.js';
import { createBookingRecords, type BookingRecords } from '../booking/records.js';
import { createSupabaseRest, supabaseConfigFromEnv, type SupabaseRest } from '../booking/repository.js';
import { guarded, NO_RETRY_POLICY } from '../resilience/index.js';
import { handleRescheduleRequest } from '../reschedule/handler.js';
import { createWaitlist, type Waitlist } from '../reschedule/waitlist.js';
import type { EmailSender } from '../email/types.js';
import { internalError } from '../http/errors.js';
import type { LocalHandler } from '../http/proxy.js';
import type { Logger } from '../log.js';
import { resilientEmail, resilientRecords, type IncidentRecorder } from '../resilience/index.js';
import { errorClass, payloadHash } from '../resilience/incidents.js';
import { handleQualityRequest } from '../quality/handler.js';
import { handleDisputeRequest } from './handler.js';

export interface RecordsRouteOptions {
  env: Env;
  log: Logger;
  fetch?: FetchLike;
  email: EmailSender;
  recorder?: IncidentRecorder;
}

/**
 * Shared by the routes that act on one existing booking (disputes, quality
 * loop, reschedule): Supabase records built on first use, a configuration
 * error answered with a 500 and recorded, and incident wrapping per request.
 */
export function createRecordsRoute(
  workflow: string,
  opts: RecordsRouteOptions,
  run: (body: Record<string, unknown>, deps: RecordsDeps, meta: import('../http/proxy.js').RouteMeta) => Promise<import('../http/errors.js').HttpResult<unknown>>,
): LocalHandler {
  let rest: SupabaseRest | null = null;
  let records: BookingRecords | null = null;
  return async (body, meta) => {
    if (!rest || !records) {
      try {
        rest = createSupabaseRest(supabaseConfigFromEnv(opts.env), { fetch: opts.fetch });
        records = createBookingRecords(rest);
      } catch (err) {
        opts.log.error(`${workflow}.config_error`, { error: err, request_id: meta.requestId });
        await opts.recorder?.record(
          { workflow, step: 'config', error_class: errorClass(err), retryable: false, auto_fixed: false, request_id: meta.requestId, payload_hash: payloadHash(workflow, 'config', errorClass(err)) },
          { tried: 'Not retried: configuration does not fix itself.', detail: err instanceof Error ? err.message : undefined },
        );
        return internalError();
      }
    }
    const log = opts.log.child({ request_id: meta.requestId });
    const waitlist = createWaitlist(rest);
    if (!opts.recorder) return run(body, { records, waitlist, email: opts.email, log, emailTimeoutMs: EMAIL_WAIT_MS }, meta);
    const ctx = { workflow, requestId: meta.requestId, recorder: opts.recorder };
    return run(body, {
      records: resilientRecords(records, ctx),
      // An insert without a unique key: never retried, so a retry cannot add the customer twice.
      waitlist: { add: (entry) => guarded(ctx, 'supabase.addToWaitlist', NO_RETRY_POLICY, () => waitlist.add(entry), `booking ${entry.booking_id}`) },
      email: resilientEmail(opts.email, ctx, EMAIL_WAIT_MS),
      log,
      emailTimeoutMs: EMAIL_WAIT_MS + 500,
    }, meta);
  };
}

export interface RecordsDeps {
  records: BookingRecords;
  waitlist: Waitlist;
  email: EmailSender;
  log: Logger;
  emailTimeoutMs: number;
}

export function createDisputeRoute(opts: RecordsRouteOptions): LocalHandler {
  return createRecordsRoute('khadmat-dispute', opts, (body, deps) => handleDisputeRequest(body, { ...deps, now: () => new Date() }));
}

/** khadmat-quality (WF5). Escalations go to WF6 in-process, with the same records, email and incident context. */
export function createQualityRoute(opts: RecordsRouteOptions): LocalHandler {
  return createRecordsRoute('khadmat-quality', opts, (body, deps) => {
    const now = () => new Date();
    return handleQualityRequest(body, { ...deps, now, escalate: (b) => handleDisputeRequest(b, { ...deps, now, log: deps.log.child({ escalated_from: 'khadmat-quality' }) }) });
  });
}

/** khadmat-reschedule (WF7). The replacement booking goes through `bookingRoute` (khadmat-booking) in-process. */
export function createRescheduleRoute(opts: RecordsRouteOptions, bookingRoute: LocalHandler): LocalHandler {
  return createRecordsRoute('khadmat-reschedule', opts, (body, deps, meta) =>
    handleRescheduleRequest(body, { ...deps, now: () => new Date(), booking: (b) => bookingRoute(b, meta) }));
}
