import { createApp } from '../lib/app.js';
import { handleScoreRefreshRequest } from '../lib/dashboard/refresh-http.js';
import { requestIdOf, toResponse } from '../lib/http/web.js';
import { createLogger } from '../lib/log.js';

// POST (or GET) /api/provider-scores with "Authorization: Bearer <CRON_SECRET>".
// WF8b: recomputes every provider's scores into provider_scores; returns { providers, rows_written }.
// Called nightly by .github/workflows/provider-scores.yml (n8n ran it at 02:00).

export const config = { maxDuration: 60 };

const app = createApp();
const log = createLogger({ app: 'gharfix', fn: 'provider-scores' });

async function handle(request: Request): Promise<Response> {
  return toResponse(await handleScoreRefreshRequest(request.headers.get('authorization'), process.env.CRON_SECRET, app.refreshScores, requestIdOf(request), log));
}

export const POST = handle;
export const GET = handle;
