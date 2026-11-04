import { createBookingRoute, type Env, type FetchLike } from './booking/deps.js';
import type { EmailSender } from './email/types.js';
import type { HttpResult } from './http/errors.js';
import { createN8nForwarder, routeProxy, type LocalHandler, type RouteMeta } from './http/proxy.js';
import { createIntentRoute } from './intent/deps.js';
import { createLogger, type LogSink } from './log.js';
import { createMatchRoute } from './matching/deps.js';

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
}

export function createApp({ env = process.env, fetch, email, logSink }: AppOptions = {}): App {
  const log = createLogger({ app: 'gharfix' }, logSink);
  const booking = createBookingRoute({ env, fetch, email, log: log.child({ fn: 'khadmat-booking' }) });
  const providerMatch = createMatchRoute({ env, fetch, log: log.child({ fn: 'khadmat-provider-match' }) });
  const intent = createIntentRoute({ env, fetch, log: log.child({ fn: 'khadmat-intent' }) }, providerMatch);
  const n8nBase = env.N8N_WEBHOOK_BASE_URL?.trim();
  const forward = n8nBase ? createN8nForwarder({ baseUrl: n8nBase, fetch, log: log.child({ fn: 'proxy' }) }) : null;

  const local = { 'khadmat-booking': booking, 'khadmat-intent': intent, 'khadmat-provider-match': providerMatch };
  return {
    booking,
    intent,
    providerMatch,
    proxy: (body, meta) => routeProxy(body, { local, forward, log }, meta),
  };
}
