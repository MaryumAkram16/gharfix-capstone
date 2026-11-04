import type { Logger } from '../log.js';
import { fail, validationError, type HttpResult } from './errors.js';

// POST /api/proxy { endpoint, ...body }: the single entry point the frontend
// already uses. Ported endpoints run in-process; the rest are forwarded to an
// n8n instance if N8N_WEBHOOK_BASE_URL is set, otherwise answered with 503.

/** Every webhook the frontend calls. Anything else is rejected, so `endpoint` cannot steer the forward URL. */
export const ENDPOINTS = [
  'khadmat-intent',
  'khadmat-provider-match',
  'khadmat-booking',
  'khadmat-quality',
  'khadmat-dispute',
  'khadmat-reschedule',
  'khadmat-provider-dashboard',
] as const;

export type Endpoint = (typeof ENDPOINTS)[number];

export interface RouteMeta {
  requestId: string | null;
}

export type LocalHandler = (body: Record<string, unknown>, meta: RouteMeta) => Promise<HttpResult<unknown>>;
export type Forwarder = (endpoint: Endpoint, body: Record<string, unknown>) => Promise<HttpResult<unknown>>;

export interface ProxyOptions {
  local: Partial<Record<Endpoint, LocalHandler>>;
  forward: Forwarder | null;
  log: Logger;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isEndpoint(value: unknown): value is Endpoint {
  return typeof value === 'string' && (ENDPOINTS as readonly string[]).includes(value);
}

export async function routeProxy(input: unknown, opts: ProxyOptions, meta: RouteMeta): Promise<HttpResult<unknown>> {
  if (!isRecord(input)) return validationError('Request body must be a JSON object', ['body']);
  const { endpoint, ...body } = input;
  if (endpoint === undefined || endpoint === null || endpoint === '') {
    return validationError('Endpoint is required', ['endpoint']);
  }
  if (!isEndpoint(endpoint)) return validationError('Unknown endpoint', ['endpoint']);

  const local = opts.local[endpoint];
  if (local) return local(body, meta);
  if (opts.forward) return opts.forward(endpoint, body);

  opts.log.warn('proxy.endpoint_not_ported', { endpoint, request_id: meta.requestId });
  return fail('service_unavailable', `${endpoint} is not available yet.`, { endpoint, retryable: false });
}

export interface ForwarderOptions {
  baseUrl: string;
  log: Logger;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  now?: () => Date;
}

/**
 * Forwards to `${baseUrl}/${endpoint}` exactly once. POSTs are never retried
 * here: a retried confirm or reschedule could act twice. Clients that want to
 * retry send an idempotency key and retry themselves.
 */
export function createN8nForwarder({
  baseUrl,
  log,
  fetch: fetchImpl = fetch,
  timeoutMs = 25_000,
  now = () => new Date(),
}: ForwarderOptions): Forwarder {
  const base = baseUrl.replace(/\/+$/, '');
  return async (endpoint, body) => {
    // Same extra fields the Express proxy always added for n8n.
    const payload = {
      ...body,
      message: body.message || body.raw_message || '',
      timestamp: now().toISOString(),
      agent_id: 'khidmatgaar_v1',
    };
    let res: Response;
    try {
      res = await fetchImpl(`${base}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      log.error('proxy.forward_failed', { endpoint, timed_out: timedOut, error: err });
      return {
        status: timedOut ? 504 : 502,
        body: { status: 'service_unavailable', message: `${endpoint} did not respond. Please try again.`, endpoint, retryable: true },
      };
    }

    const text = await res.text().catch(() => '');
    let parsed: unknown = text;
    if (text !== '') {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Not JSON: pass the text through, as the Express proxy did.
      }
    }
    log.info('proxy.forwarded', { endpoint, http_status: res.status });
    return { status: res.status, body: parsed };
  };
}
