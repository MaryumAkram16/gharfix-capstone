import { fail, validationError, type HttpResult } from './errors.js';

// Adapters between web-standard Request/Response (what Vercel functions use)
// and the HttpResult values that lib/ handlers return.

/** `error` is null on success. (Not a discriminated union: the tsconfig is not strict, so those do not narrow.) */
export interface JsonBody {
  value: unknown;
  error: HttpResult | null;
}

/**
 * Reads a JSON request body, refusing anything over `maxBytes`. An empty body
 * reads as {}, so the booking handler reports which fields are missing.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBody> {
  const tooLarge = (): JsonBody => ({
    value: null,
    error: fail('payload_too_large', `Request body must be at most ${maxBytes} bytes`),
  });

  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();

  let text: string;
  try {
    text = await request.text();
  } catch {
    return { value: null, error: validationError('Request body could not be read', ['body']) };
  }
  if (Buffer.byteLength(text, 'utf8') > maxBytes) return tooLarge();
  if (text.trim() === '') return { value: {}, error: null };

  try {
    return { value: JSON.parse(text) as unknown, error: null };
  } catch {
    return { value: null, error: validationError('Request body must be valid JSON', ['body']) };
  }
}

/** JSON bodies are serialised with JSON.stringify; a string body (from a forwarded webhook) is sent as text. */
export function toResponse(result: HttpResult<unknown>): Response {
  const headers = { 'Cache-Control': 'no-store' };
  if (typeof result.body === 'string') {
    return new Response(result.body, { status: result.status, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  return new Response(JSON.stringify(result.body ?? null), {
    status: result.status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** Vercel's per-request id, for correlating log lines. */
export function requestIdOf(request: Request): string | null {
  return request.headers.get('x-vercel-id');
}
