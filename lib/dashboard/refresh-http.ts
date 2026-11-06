import { fail, ok, type HttpResult } from '../http/errors.js';
import type { Logger } from '../log.js';
import { bearerMatches } from '../reconcile/handler.js';
import type { ScoreRefresher } from './deps.js';

/** HTTP shell for api/provider-scores.ts: the same CRON_SECRET bearer check as reconcile, then run. */
export async function handleScoreRefreshRequest(authorization: string | null, cronSecret: string | undefined, run: ScoreRefresher, requestId: string | null, log: Logger): Promise<HttpResult> {
  if (!cronSecret?.trim()) {
    log.error('scores.not_configured', { missing: 'CRON_SECRET' });
    return fail('internal_error', 'Score refresh is not configured (CRON_SECRET is not set).');
  }
  if (!bearerMatches(authorization, cronSecret.trim())) {
    log.warn('scores.unauthorized', { request_id: requestId });
    return fail('unauthorized', 'Missing or wrong bearer token.');
  }
  try {
    return ok({ status: 'ok', ...(await run(requestId)) });
  } catch (err) {
    log.error('scores.failed', { error: err, request_id: requestId });
    return fail('service_unavailable', 'Could not refresh provider scores; the next scheduled run will try again.', { retryable: true });
  }
}
