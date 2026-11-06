import type { Logger } from '../log.js';
import {
  DEFAULT_NOMINATIM_TIMEOUT_MS, DEFAULT_NOMINATIM_URL, DEFAULT_OVERPASS_BUDGET_MS, DEFAULT_OVERPASS_FALLBACK_URL,
  DEFAULT_OVERPASS_TIMEOUT_MS, DEFAULT_OVERPASS_URL, DEFAULT_USER_AGENT,
} from './osm.js';

// OpenStreetMap endpoints and timeouts from env vars; none of them is
// required. Defaults:
//   Nominatim 5 s + Overpass 15 s per instance, 20 s across both instances
// so a provider search ends within about 25 s, inside the 60 s maxDuration
// set on the functions that run it (api/proxy.ts, api/intent.ts,
// api/provider-match.ts). The public Overpass servers are slow under load,
// which is why the per-instance default is generous; the 20 s budget still
// leaves the mirror at least 5 s after a full main-instance timeout.
// Invalid values fall back to the default with a warning, never a crash.

type Env = Record<string, string | undefined>;

export interface OsmConfig {
  nominatimUrl: string;
  nominatimTimeoutMs: number;
  /** Tried in order; the second is the mirror. */
  overpassUrls: string[];
  overpassTimeoutMs: number;
  overpassBudgetMs: number;
  userAgent: string;
}

export const OSM_DEFAULTS = {
  nominatimTimeoutMs: DEFAULT_NOMINATIM_TIMEOUT_MS,
  overpassTimeoutMs: DEFAULT_OVERPASS_TIMEOUT_MS,
  overpassBudgetMs: DEFAULT_OVERPASS_BUDGET_MS,
} as const;

const MIN_MS = 1000;
const MAX_MS = 60000;

function url(env: Env, name: string, fallback: string, log?: Logger): string {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:' || u.protocol === 'http:') return raw;
  } catch {
    // fall through
  }
  log?.warn('osm.config_invalid', { variable: name, using: fallback });
  return fallback;
}

function ms(env: Env, name: string, fallback: number, log?: Logger): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= MIN_MS && n <= MAX_MS) return n;
  log?.warn('osm.config_invalid', { variable: name, using: fallback, allowed: `${MIN_MS}-${MAX_MS} ms` });
  return fallback;
}

export function osmConfigFromEnv(env: Env, log?: Logger): OsmConfig {
  const primary = url(env, 'OVERPASS_URL', DEFAULT_OVERPASS_URL, log);
  const mirrorRaw = env.OVERPASS_FALLBACK_URL?.trim();
  const mirror = mirrorRaw?.toLowerCase() === 'off' ? null : url(env, 'OVERPASS_FALLBACK_URL', DEFAULT_OVERPASS_FALLBACK_URL, log);
  const overpassTimeoutMs = ms(env, 'OVERPASS_TIMEOUT_MS', OSM_DEFAULTS.overpassTimeoutMs, log);
  const budget = ms(env, 'OVERPASS_BUDGET_MS', OSM_DEFAULTS.overpassBudgetMs, log);
  return {
    nominatimUrl: url(env, 'NOMINATIM_URL', DEFAULT_NOMINATIM_URL, log),
    nominatimTimeoutMs: ms(env, 'NOMINATIM_TIMEOUT_MS', OSM_DEFAULTS.nominatimTimeoutMs, log),
    overpassUrls: mirror && mirror !== primary ? [primary, mirror] : [primary],
    overpassTimeoutMs,
    // The budget can never be shorter than one attempt.
    overpassBudgetMs: Math.max(budget, overpassTimeoutMs),
    userAgent: env.OSM_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
  };
}

export const DEFAULT_GOOGLE_PLACES_TIMEOUT_MS = 8000;

export interface GoogleConfig {
  apiKey: string;
  timeoutMs: number;
}

/** null unless GOOGLE_MAPS_API_KEY is set: Google Places is opt-in (it needs a billing-enabled key). */
export function googleConfigFromEnv(env: Env, log?: Logger): GoogleConfig | null {
  const apiKey = env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey) return null;
  return { apiKey, timeoutMs: ms(env, 'GOOGLE_PLACES_TIMEOUT_MS', DEFAULT_GOOGLE_PLACES_TIMEOUT_MS, log) };
}
