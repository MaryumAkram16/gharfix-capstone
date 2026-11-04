import { EMAIL_WAIT_MS, type Env, type FetchLike } from '../booking/deps.js';
import { createSupabaseRepository, supabaseConfigFromEnv } from '../booking/repository.js';
import type { EmailSender } from '../email/types.js';
import type { Logger } from '../log.js';
import { resilientEmail, resilientRepository, type IncidentRecorder } from '../resilience/index.js';
import { reconcileConfirmations, type ReconcileRunner } from './handler.js';

export interface ReconcileDepsOptions {
  env: Env;
  log: Logger;
  email: EmailSender;
  recorder: IncidentRecorder;
  fetch?: FetchLike;
}

/**
 * Runs with the same safety rules as bookings: the Supabase read is retried,
 * the email send and the confirmation_sent_at update are not, and failures
 * become incidents/alerts. A missing Supabase config throws (500 + log).
 */
export function createReconcileRunner({ env, log, email, recorder, fetch }: ReconcileDepsOptions): ReconcileRunner {
  return async (requestId) => {
    const repo = createSupabaseRepository(supabaseConfigFromEnv(env), { fetch, log });
    const ctx = { workflow: 'reconcile', requestId, recorder };
    return reconcileConfirmations({
      db: resilientRepository(repo, ctx),
      email: resilientEmail(email, ctx, EMAIL_WAIT_MS),
      emailTimeoutMs: EMAIL_WAIT_MS + 500,
      now: () => new Date(),
      log: log.child({ request_id: requestId }),
    });
  };
}
