import { createApp } from '../lib/app.js';
import { readJsonBody, requestIdOf, toResponse } from '../lib/http/web.js';

// POST /api/intent  { raw_message, ... }: same body and responses as WF1
// (khadmat-intent). The frontend still goes through /api/proxy.

const app = createApp();
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (body.error) return toResponse(body.error);
  const record = body.value && typeof body.value === 'object' && !Array.isArray(body.value) ? (body.value as Record<string, unknown>) : {};
  return toResponse(await app.intent(record, { requestId: requestIdOf(request) }));
}
