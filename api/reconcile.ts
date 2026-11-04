import { createApp } from '../lib/app.js';
import { toResponse, requestIdOf } from '../lib/http/web.js';
import { createLogger } from '../lib/log.js';
import { handleReconcileRequest } from '../lib/reconcile/handler.js';

// POST (or GET) /api/reconcile with "Authorization: Bearer <CRON_SECRET>".
// Re-sends confirmations that never went out; returns { found, fixed, failed, skipped, deferred }.
// Called every 15 minutes by .github/workflows/reconcile.yml (Vercel Hobby cron is daily only;
// Vercel Cron sends the same bearer header, so a daily Vercel cron would also work).

const app = createApp();
const log = createLogger({ app: 'gharfix', fn: 'reconcile' });

async function handle(request: Request): Promise<Response> {
  return toResponse(await handleReconcileRequest(request.headers.get('authorization'), process.env.CRON_SECRET, app.reconcile, requestIdOf(request), log));
}

export const POST = handle;
export const GET = handle;
