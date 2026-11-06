import { createApp } from '../lib/app.js';
import { readJsonBody, requestIdOf, toResponse } from '../lib/http/web.js';

// POST /api/proxy  { endpoint, ...body }: what the frontend calls for every
// webhook. See lib/http/proxy.ts for routing.

// Vercel function settings (Node.js /api route: exported config object).
// This function routes khadmat-intent and khadmat-provider-match, which run provider matching: Nominatim (5 s) + Overpass (20 s across
// both instances) by default, plus Supabase and, for intents, Gemini. 60 s
// leaves room for that; see lib/matching/config.ts.
export const config = { maxDuration: 60 };

const app = createApp();
// Dispute uploads carry base64 images; Vercel itself caps bodies at 4.5 MB.
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (body.error) return toResponse(body.error);
  return toResponse(await app.proxy(body.value, { requestId: requestIdOf(request) }));
}
