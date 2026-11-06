import type { Env, FetchLike } from '../booking/deps.js';
import { createSupabaseRest, supabaseConfigFromEnv } from '../booking/repository.js';
import { internalError } from '../http/errors.js';
import type { LocalHandler } from '../http/proxy.js';
import type { Logger } from '../log.js';
import { resilientDashboardStore, type IncidentRecorder } from '../resilience/index.js';
import { errorClass, payloadHash } from '../resilience/incidents.js';
import { handleDashboardRequest, refreshProviderScores, type RefreshResult } from './handler.js';
import { createDashboardStore, type DashboardStore } from './store.js';

export interface DashboardOptions {
  env: Env;
  log: Logger;
  fetch?: FetchLike;
  recorder?: IncidentRecorder;
}

function storeFactory(workflow: string, opts: DashboardOptions) {
  let store: DashboardStore | null = null;
  return async (requestId: string | null): Promise<DashboardStore | null> => {
    if (!store) {
      try {
        store = createDashboardStore(createSupabaseRest(supabaseConfigFromEnv(opts.env), { fetch: opts.fetch }));
      } catch (err) {
        opts.log.error(`${workflow}.config_error`, { error: err, request_id: requestId });
        await opts.recorder?.record(
          { workflow, step: 'config', error_class: errorClass(err), retryable: false, auto_fixed: false, request_id: requestId, payload_hash: payloadHash(workflow, 'config', errorClass(err)) },
          { tried: 'Not retried: configuration does not fix itself.', detail: err instanceof Error ? err.message : undefined },
        );
        return null;
      }
    }
    return opts.recorder ? resilientDashboardStore(store, { workflow, requestId, recorder: opts.recorder }) : store;
  };
}

/** khadmat-provider-dashboard (WF8). */
export function createDashboardRoute(opts: DashboardOptions): LocalHandler {
  const getStore = storeFactory('khadmat-provider-dashboard', opts);
  return async (body, meta) => {
    const store = await getStore(meta.requestId);
    if (!store) return internalError();
    return handleDashboardRequest(body, { store, now: () => new Date(), log: opts.log.child({ request_id: meta.requestId }) });
  };
}

export type ScoreRefresher = (requestId: string | null) => Promise<RefreshResult>;

/** WF8b, for api/provider-scores.ts. Throws on a configuration or Supabase failure (recorded first). */
export function createScoreRefresher(opts: DashboardOptions): ScoreRefresher {
  const getStore = storeFactory('provider-scores-nightly', opts);
  return async (requestId) => {
    const store = await getStore(requestId);
    if (!store) throw new Error('Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    return refreshProviderScores({ store, now: () => new Date(), log: opts.log.child({ request_id: requestId }) });
  };
}
