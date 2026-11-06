import { createSupabaseRest, supabaseConfigFromEnv } from '../booking/repository.js';
import type { EmailSender } from '../email/types.js';
import type { Logger } from '../log.js';
import { createSupabaseIncidentStore, type IncidentStore } from './incidents.js';
import { createIncidentRecorder, DEFAULT_DEDUPE_WINDOW_MS, type IncidentRecorder } from './recorder.js';

export {
  guarded, resilientCapacity, resilientDashboardStore, resilientRecords, resilientDirectory, resilientEmail, resilientGeocoder, resilientParser, resilientRepository, type GuardContext,
} from './guard.js';
export type { IncidentRecorder } from './recorder.js';
export { NO_RETRY as NO_RETRY_POLICY } from './policies.js';

type Env = Record<string, string | undefined>;
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * The incident recorder for this deployment. Incidents go to Supabase when it
 * is configured; alerts go to ALERT_EMAIL through `alertSender` (Gmail, or the
 * console fallback, which only logs). ALERT_DEDUPE_MINUTES (default 60) sets
 * the de-duplication window.
 */
export function recorderFromEnv({ env, log, fetch, alertSender }: { env: Env; log: Logger; fetch?: FetchLike; alertSender: EmailSender | null }): IncidentRecorder {
  let store: IncidentStore | null = null;
  try {
    store = createSupabaseIncidentStore(createSupabaseRest(supabaseConfigFromEnv(env), { fetch }));
  } catch {
    // No Supabase: incidents are only logged, and de-duplication is per instance.
  }
  // Unset: the recorder logs incident.alert_not_configured when an alert would have gone out.
  const alertTo = env.ALERT_EMAIL?.trim() || null;
  const minutes = Number(env.ALERT_DEDUPE_MINUTES);
  return createIncidentRecorder({
    store,
    alertSender,
    alertTo,
    log: log.child({ fn: 'incidents' }),
    dedupeWindowMs: minutes > 0 ? minutes * 60_000 : DEFAULT_DEDUPE_WINDOW_MS,
  });
}
