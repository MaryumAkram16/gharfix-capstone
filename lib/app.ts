import { createBookingRoute, type Env, type FetchLike } from './booking/deps.js';
import type { EmailSender } from './email/types.js';
import type { HttpResult } from './http/errors.js';
import { createN8nForwarder, routeProxy, type LocalHandler, type RouteMeta } from './http/proxy.js';
import { createIntentRoute } from './intent/deps.js';
import { emailSenderFromEnv } from './email/index.js';
import { createLogger, type LogSink } from './log.js';
import { recorderFromEnv } from './resilience/index.js';
import { createMatchRoute } from './matching/deps.js';
import { createReconcileRunner } from './reconcile/deps.js';
import type { ReconcileRunner } from './reconcile/handler.js';

// Wires the routes from environment variables. api/*.ts (Vercel) and
// server.ts (local dev) both use this, so they behave the same.

export interface AppOptions {
  env?: Env;
  fetch?: FetchLike;
  email?: EmailSender;
  logSink?: LogSink;
}

export interface App {
  booking: LocalHandler;
  intent: LocalHandler;
  providerMatch: LocalHandler;
  proxy: (body: unknown, meta: RouteMeta) => Promise<HttpResult<unknown>>;
  /** api/reconcile.ts: re-send unsent confirmations. Not reachable through /api/proxy. */
  reconcile: ReconcileRunner;
}

export function createApp({ env = process.env, fetch, email, logSink }: AppOptions = {}): App {
  const log = createLogger({ app: 'gharfix' }, logSink);
  // One sender for confirmations and alerts (Gmail, or the console fallback).
  const mailer = email ?? emailSenderFromEnv(env, log.child({ fn: 'email' }));
  const recorder = recorderFromEnv({ env, log, fetch, alertSender: mailer });
  const booking = createBookingRoute({ env, fetch, email: mailer, recorder, log: log.child({ fn: 'khadmat-booking' }) });
  const providerMatch = createMatchRoute({ env, fetch, recorder, log: log.child({ fn: 'khadmat-provider-match' }) });
  const intent = createIntentRoute({ env, fetch, recorder, log: log.child({ fn: 'khadmat-intent' }) }, providerMatch);
  const n8nBase = env.N8N_WEBHOOK_BASE_URL?.trim();
  const forward = n8nBase ? createN8nForwarder({ baseUrl: n8nBase, fetch, log: log.child({ fn: 'proxy' }) }) : null;

  const local = { 'khadmat-booking': booking, 'khadmat-intent': intent, 'khadmat-provider-match': providerMatch };
  const reconcile = createReconcileRunner({ env, fetch, email: mailer, recorder, log: log.child({ fn: 'reconcile' }) });
  return {
    booking,
    intent,
    providerMatch,
    reconcile,
    proxy: (body, meta) => routeProxy(body, { local, forward, log }, meta),
  };
}
