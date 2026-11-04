import { createApp } from '../lib/app.js';
import { readJsonBody, requestIdOf, toResponse } from '../lib/http/web.js';

// POST /api/proxy  { endpoint, ...body }: what the frontend calls for every
// webhook. See lib/http/proxy.ts for routing.

const app = createApp();
// Dispute uploads carry base64 images; Vercel itself caps bodies at 4.5 MB.
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (body.error) return toResponse(body.error);
  return toResponse(await app.proxy(body.value, { requestId: requestIdOf(request) }));
}
