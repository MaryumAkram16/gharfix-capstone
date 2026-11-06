import type { Logger } from '../log.js';
import { MapsUnavailableError, type GeocodeResult, type Geocoder, type NearbySearch, type ProviderDirectory } from './directory.js';
import { elementMatches, overpassQuery, ruleFor, type ServiceRule } from './osmServices.js';
import { haversineKm } from './providers.js';
import type { Place } from './types.js';

// OpenStreetMap implementations of Geocoder and ProviderDirectory.
//
// Public endpoints have usage policies: Nominatim allows at most 1 request a
// second and needs an identifying User-Agent; Overpass is fair-use. Results
// are cached per instance, and both URLs can point at a self-hosted or
// commercial instance through env vars.
//   https://operations.osmfoundation.org/policies/nominatim/
//   https://dev.overpass-api.de/overpass-doc/en/preface/commons.html

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export const DEFAULT_NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
export const DEFAULT_OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
/** Tried when the main instance fails (public mirror listed on the OSM wiki; set OVERPASS_FALLBACK_URL=off to disable). */
export const DEFAULT_OVERPASS_FALLBACK_URL = 'https://overpass.kumi.systems/api/interpreter';

/** Defaults when OVERPASS_TIMEOUT_MS / OVERPASS_BUDGET_MS / NOMINATIM_TIMEOUT_MS are not set (lib/matching/config.ts). */
export const DEFAULT_OVERPASS_TIMEOUT_MS = 15000; // per Overpass instance
export const DEFAULT_OVERPASS_BUDGET_MS = 20000; // across the main instance and the mirror
export const DEFAULT_NOMINATIM_TIMEOUT_MS = 5000;
export const DEFAULT_USER_AGENT = 'GharFix/0.1 (portfolio project; +https://github.com/MaryumAkram16/gharfix-capstone)';

export interface OsmOptions {
  fetch?: FetchLike;
  userAgent?: string;
  /** Per request (per mirror, for Overpass). */
  timeoutMs?: number;
  log?: Logger;
}

export interface OverpassOptions extends OsmOptions {
  /** Total time across all mirrors. A mirror is skipped when less than MIN_MIRROR_MS of it is left. */
  budgetMs?: number;
  now?: () => number;
}

export const MIN_MIRROR_MS = 2000;

async function call(service: 'geocoder' | 'directory', fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number) {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    throw new MapsUnavailableError(service, `${service} ${timedOut ? 'timed out' : 'network error'}`, null, timedOut);
  }
  if (!res.ok) throw new MapsUnavailableError(service, `${service} answered HTTP ${res.status}`, res.status);
  try {
    return (await res.json()) as unknown;
  } catch {
    throw new MapsUnavailableError(service, `${service} returned a non-JSON body`, res.status);
  }
}

class LruCache<V> {
  private map = new Map<string, V>();
  constructor(private max: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: V) {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return 'invalid-url'; }
}

/** Nominatim search, limited to Pakistan. */
export function createNominatimGeocoder(baseUrl = DEFAULT_NOMINATIM_URL, opts: OsmOptions = {}): Geocoder {
  const { fetch: fetchImpl = fetch, userAgent = DEFAULT_USER_AGENT, timeoutMs = DEFAULT_NOMINATIM_TIMEOUT_MS } = opts;
  const cache = new LruCache<GeocodeResult | null>(200);
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/search`;

  return {
    async geocode(query) {
      const key = query.trim().toLowerCase();
      const hit = cache.get(key);
      if (hit !== undefined) return hit;

      const params = new URLSearchParams({ q: query.trim(), format: 'jsonv2', limit: '1', countrycodes: 'pk', 'accept-language': 'en' });
      const body = await call('geocoder', fetchImpl, `${endpoint}?${params}`, { method: 'GET', headers: { 'User-Agent': userAgent, Accept: 'application/json' } }, timeoutMs);
      const first = Array.isArray(body) ? (body[0] as { lat?: string; lon?: string; display_name?: string } | undefined) : undefined;
      const lat = Number(first?.lat);
      const lng = Number(first?.lon);
      const result = first && Number.isFinite(lat) && Number.isFinite(lng)
        ? { lat, lng, formatted_address: first.display_name ?? query, source: 'openstreetmap_nominatim' }
        : null;
      cache.set(key, result);
      return result;
    },
  };
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function address(tags: Record<string, string>): string {
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  return [street, tags['addr:place'], tags['addr:suburb'], tags['addr:city']].filter(Boolean).join(', ');
}

/**
 * Overpass "around" search using the service -> tag/name table in
 * osmServices.ts. `urls` are tried in order: when one is unavailable (timeout,
 * network, 429, 5xx, Overpass's own timeout remark) the next mirror is tried,
 * within `budgetMs` overall. Anything else (a bug) is thrown immediately.
 */
export function createOverpassDirectory(urls: string | string[] = DEFAULT_OVERPASS_URL, opts: OverpassOptions = {}): ProviderDirectory {
  const { fetch: fetchImpl = fetch, userAgent = DEFAULT_USER_AGENT, timeoutMs = DEFAULT_OVERPASS_TIMEOUT_MS, log, now = () => Date.now() } = opts;
  const mirrors = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  const budgetMs = opts.budgetMs ?? timeoutMs * mirrors.length;

  async function fetchFrom(url: string, rules: ServiceRule[], center: NearbySearch['center'], radiusM: number, attemptMs: number) {
    // Server-side timeout a little under ours, so Overpass gives up first and says why.
    const query = overpassQuery(rules, center.lat, center.lng, radiusM, Math.max(2, Math.floor(attemptMs / 1000) - 2));
    const body = (await call('directory', fetchImpl, url, {
      method: 'POST',
      headers: { 'User-Agent': userAgent, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ data: query }).toString(),
    }, attemptMs)) as { elements?: OverpassElement[]; remark?: string };
    // Overpass reports its own timeouts as HTTP 200 with a remark and no elements.
    if (body.remark && /error|timed out|timeout/i.test(body.remark) && !(body.elements?.length)) {
      throw new MapsUnavailableError('directory', `directory: ${body.remark.slice(0, 120)}`, null, /timed out|timeout/i.test(body.remark));
    }
    return body;
  }

  return {
    async searchNearby({ services, center, radiusM, limit }: NearbySearch) {
      const rules = services.map((s) => ({ service: s, rule: ruleFor(s) })).filter((r) => r.rule !== null);
      if (rules.length === 0) return [];

      const started = now();
      let body: { elements?: OverpassElement[]; remark?: string } | null = null;
      let lastError: MapsUnavailableError | null = null;
      for (const [i, url] of mirrors.entries()) {
        const left = budgetMs - (now() - started);
        if (i > 0 && left < MIN_MIRROR_MS) {
          log?.warn('osm.mirror_skipped', { mirror: hostOf(url), budget_left_ms: left });
          break;
        }
        try {
          body = await fetchFrom(url, rules.map((r) => r.rule!), center, radiusM, Math.min(timeoutMs, left));
          if (i > 0) log?.warn('osm.mirror_used', { mirror: hostOf(url), after_failures: i });
          break;
        } catch (err) {
          if (!(err instanceof MapsUnavailableError)) throw err;
          lastError = err;
          log?.warn('osm.mirror_failed', { mirror: hostOf(url), error: err, timed_out: err.timedOut });
        }
      }
      if (!body) {
        const e = lastError ?? new MapsUnavailableError('directory', 'directory: no Overpass URL configured');
        throw new MapsUnavailableError('directory', `${e.message} (${mirrors.length} Overpass instance(s) tried)`, e.httpStatus, e.timedOut);
      }

      const seen = new Set<string>();
      const places: Array<Place & { d: number }> = [];
      for (const el of body.elements ?? []) {
        const tags = el.tags ?? {};
        const name = (tags.name ?? tags['name:en'] ?? '').trim();
        const lat = el.lat ?? el.center?.lat;
        const lng = el.lon ?? el.center?.lon;
        const id = `osm:${el.type}/${el.id}`;
        if (!name || lat === undefined || lng === undefined || seen.has(id)) continue;
        const matchedServices = rules.filter((r) => elementMatches(r.rule!, el)).map((r) => r.service);
        if (matchedServices.length === 0) continue;
        seen.add(id);
        places.push({
          id, name, lat, lng, address: address(tags), matchedServices,
          sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
          source: 'openstreetmap',
          d: haversineKm(center, { lat, lng }),
        });
      }
      places.sort((a, b) => a.d - b.d);
      log?.info('osm.search', { services, results: places.length, elements: body.elements?.length ?? 0 });
      return places.slice(0, limit).map(({ d: _d, ...p }) => p);
    },
  };
}
