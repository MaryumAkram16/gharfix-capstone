import type { CapacityReader, ReconcileReader, BookingRepository } from '../booking/repository.js';
import type { EmailSender } from '../email/types.js';
import type { IntentParser } from '../intent/types.js';
import type { Geocoder, ProviderDirectory } from '../matching/directory.js';
import { errorClass, payloadHash } from './incidents.js';
import { GEMINI, NO_RETRY, SUPABASE_READ, describePolicy, insertPolicy, isExpectedOutcome, isTransient } from './policies.js';
import type { IncidentRecorder } from './recorder.js';
import { withRetry, withTimeout, type RetryPolicy, type RetryReport } from './retry.js';

// guarded(): withRetry + incident recording around one external call.
//   - success on the first try: nothing recorded
//   - success after a retry: incident with auto_fixed = true (no alert)
//   - ends in an expected outcome (slot taken, key replay): nothing recorded,
//     or auto_fixed if a retry got it there
//   - final failure: incident with auto_fixed = false (+ deduped alert)
// The original error is always rethrown, so handlers behave as before.

export interface GuardContext {
  workflow: string;
  requestId: string | null;
  recorder: IncidentRecorder;
  sleep?: (ms: number) => Promise<void>;
}

export async function guarded<T>(ctx: GuardContext, step: string, policy: RetryPolicy, fn: () => Promise<T>, detail?: string): Promise<T> {
  let report: RetryReport | null = null;
  let value: T;
  try {
    value = await withRetry(() => fn(), { ...policy, sleep: ctx.sleep, onFinish: (r) => { report = r; } });
  } catch (err) {
    const r = report as RetryReport | null;
    const first = r?.errors[0] ?? err;
    if (isExpectedOutcome(err)) {
      if (r && r.attempts > 1) await record(ctx, step, first, true, true, describePolicy(policy, r.attempts, r.waits), detail);
      throw err;
    }
    await record(ctx, step, err, isTransient(err), false, describePolicy(policy, r?.attempts ?? 1, r?.waits ?? []), detail ?? errMessage(err));
    throw err;
  }
  const r = report as RetryReport | null;
  if (r && r.attempts > 1) {
    await record(ctx, step, r.errors[0], true, true, describePolicy(policy, r.attempts, r.waits), detail);
  }
  return value;
}

function errMessage(err: unknown): string | undefined {
  return err instanceof Error ? err.message.slice(0, 200) : undefined;
}

async function record(ctx: GuardContext, step: string, err: unknown, retryable: boolean, autoFixed: boolean, tried: string, detail?: string) {
  const cls = errorClass(err);
  await ctx.recorder.record(
    {
      workflow: ctx.workflow,
      step,
      error_class: cls,
      retryable,
      auto_fixed: autoFixed,
      request_id: ctx.requestId,
      payload_hash: payloadHash(ctx.workflow, step, cls),
    },
    { tried: autoFixed ? `${tried} A retry succeeded.` : tried, detail },
  );
}

type Repo = BookingRepository & Partial<CapacityReader & ReconcileReader>;

/** Supabase with the retry rules from policies.ts. */
export function resilientRepository<R extends Repo>(repo: R, ctx: GuardContext): R {
  const wrapped: Repo = {
    bookedSlots: (providerId, dates) => guarded(ctx, 'supabase.bookedSlots', SUPABASE_READ, () => repo.bookedSlots(providerId, dates)),
    findByIdempotencyKey: (key) => guarded(ctx, 'supabase.findByIdempotencyKey', SUPABASE_READ, () => repo.findByIdempotencyKey(key)),
    insert: (row) => guarded(ctx, 'supabase.insert', insertPolicy(row), () => repo.insert(row), `booking ${row.booking_id}`),
    markConfirmationSent: (id, at) => guarded(ctx, 'supabase.markConfirmationSent', NO_RETRY, () => repo.markConfirmationSent(id, at), `booking ${id}`),
  };
  if (repo.activeBookingCounts) {
    const read = repo.activeBookingCounts.bind(repo);
    wrapped.activeBookingCounts = (date, ids) => guarded(ctx, 'supabase.activeBookingCounts', SUPABASE_READ, () => read(date, ids));
  }
  if (repo.findUnconfirmed) {
    const read = repo.findUnconfirmed.bind(repo);
    wrapped.findUnconfirmed = (w) => guarded(ctx, 'supabase.findUnconfirmed', SUPABASE_READ, () => read(w));
  }
  return wrapped as R;
}

export function resilientCapacity(capacity: CapacityReader, ctx: GuardContext): CapacityReader {
  return { activeBookingCounts: (date, ids) => guarded(ctx, 'supabase.activeBookingCounts', SUPABASE_READ, () => capacity.activeBookingCounts(date, ids)) };
}

/** OpenStreetMap: not retried here (the directory already tries a mirror), but every final failure is an incident. */
export function resilientDirectory(directory: ProviderDirectory, ctx: GuardContext): ProviderDirectory {
  return { searchNearby: (search) => guarded(ctx, 'osm.searchNearby', NO_RETRY, () => directory.searchNearby(search)) };
}

export function resilientGeocoder(geocoder: Geocoder, ctx: GuardContext): Geocoder {
  return { geocode: (query) => guarded(ctx, 'osm.geocode', NO_RETRY, () => geocoder.geocode(query)) };
}

export function resilientParser(parser: IntentParser, ctx: GuardContext): IntentParser {
  return { name: parser.name, parse: (message) => guarded(ctx, 'gemini.parse', GEMINI, () => parser.parse(message)) };
}

/**
 * SMTP: never retried (a retry could email twice), but every failure is an
 * incident. The send is time-boxed here so a hanging SMTP server is recorded
 * too, not just cut off by the caller.
 */
export function resilientEmail(sender: EmailSender, ctx: GuardContext, timeoutMs: number): EmailSender {
  return {
    logsOnly: sender.logsOnly,
    send: (message) => guarded(ctx, 'smtp.send', NO_RETRY, () => withTimeout(Promise.resolve().then(() => sender.send(message)), timeoutMs, 'email send')),
  };
}
