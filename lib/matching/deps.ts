import type { Env, FetchLike } from '../booking/deps.js';
import { createSupabaseRepository, supabaseConfigFromEnv, type CapacityReader } from '../booking/repository.js';
import type { LocalHandler } from '../http/proxy.js';
import type { Logger } from '../log.js';
import { recoveringDirectory, resilientCapacity, resilientDirectory, resilientGeocoder, type IncidentRecorder } from '../resilience/index.js';
import { googleConfigFromEnv, osmConfigFromEnv } from './config.js';
import { MapsUnavailableError, withDirectoryFallback, type ProviderDirectory } from './directory.js';
import { createGooglePlacesDirectory } from './google.js';
import { createDemoDirectory, withDemoFallback } from './demo.js';
import { handleProviderMatch, type MatchDeps } from './handler.js';
import { createNominatimGeocoder, createOverpassDirectory } from './osm.js';

export interface MatchDepsOptions {
  env: Env;
  log: Logger;
  fetch?: FetchLike;
  recorder?: IncidentRecorder;
}

interface MatchParts {
  deps: MatchDeps;
  /** The OpenStreetMap directory, before demo fallback and incident wrapping. */
  overpass: ProviderDirectory;
  /** Google Places, only when GOOGLE_MAPS_API_KEY is set; tried before OpenStreetMap. */
  google: ProviderDirectory | null;
  demo: ProviderDirectory | null;
}

/**
 * GOOGLE_PLACES_FAULT=timeout | 503: make every Google Places search fail
 * that way, to show the fallback and incident flow in a demo. Exactly those
 * two values; anything else (or unset) changes nothing. Never in production.
 */
export function withFaultInjection(directory: ProviderDirectory, fault: string | undefined, log: Logger): ProviderDirectory {
  if (fault !== 'timeout' && fault !== '503') return directory;
  return {
    async searchNearby() {
      log.warn('google.fault_injected', { fault, variable: 'GOOGLE_PLACES_FAULT' });
      throw fault === 'timeout'
        ? new MapsUnavailableError('directory', 'google places timed out (fault injected by GOOGLE_PLACES_FAULT)', null, true)
        : new MapsUnavailableError('directory', 'google places answered HTTP 503 (fault injected by GOOGLE_PLACES_FAULT)', 503);
    },
  };
}

function buildMatchParts({ env, log, fetch }: MatchDepsOptions): MatchParts {
  const config = osmConfigFromEnv(env, log);
  const osm = { fetch, log, userAgent: config.userAgent };
  let capacity: CapacityReader;
  try {
    capacity = createSupabaseRepository(supabaseConfigFromEnv(env), { fetch, log });
  } catch (err) {
    log.warn('match.capacity_not_configured', { error: err });
    capacity = { activeBookingCounts: async () => { throw err; } };
  }
  const overpass = createOverpassDirectory(config.overpassUrls, { ...osm, timeoutMs: config.overpassTimeoutMs, budgetMs: config.overpassBudgetMs });
  const googleConfig = googleConfigFromEnv(env, log);
  const google = googleConfig ? withFaultInjection(createGooglePlacesDirectory({ ...googleConfig, fetch, log }), env.GOOGLE_PLACES_FAULT, log) : null;
  if (google) log.info('match.google_places_enabled', { fallback: 'OpenStreetMap when Google fails' });
  const real = google ? withDirectoryFallback(google, overpass, log) : overpass;
  // Off unless exactly "1": demo providers are fictional and must never appear by accident.
  const demo = env.USE_DEMO_PROVIDERS === '1' ? createDemoDirectory() : null;
  if (demo) log.warn('match.demo_providers_enabled', { dataset: 'db/seed/demo_providers.json', used_when: 'OpenStreetMap returns zero providers or fails' });
  return {
    overpass,
    google,
    demo,
    deps: {
      geocoder: createNominatimGeocoder(config.nominatimUrl, { ...osm, timeoutMs: config.nominatimTimeoutMs }),
      directory: demo ? withDemoFallback(real, demo, log) : real,
      capacity,
      now: () => new Date(),
      log,
    },
  };
}

/**
 * Google Places (if GOOGLE_MAPS_API_KEY is set), else or on failure
 * OpenStreetMap for places, Supabase for today's capacity. Without Supabase
 * env vars matching still runs; every response then says
 * capacity_checked: false.
 */
export function createMatchDeps(opts: MatchDepsOptions): MatchDeps {
  return buildMatchParts(opts).deps;
}

/**
 * khadmat-provider-match. Built once per warm instance; per request, the map
 * calls are wrapped so failures become incidents (with this request's id),
 * and only then may the demo fallback cover an OpenStreetMap failure.
 */
export function createMatchRoute(opts: MatchDepsOptions): LocalHandler {
  let parts: MatchParts | null = null;
  return async (body, meta) => {
    parts ??= buildMatchParts(opts);
    const { deps, overpass, google, demo } = parts;
    const log = deps.log.child({ request_id: meta.requestId });
    if (!opts.recorder) return handleProviderMatch(body, { ...deps, log });
    const ctx = { workflow: 'khadmat-provider-match', requestId: meta.requestId, recorder: opts.recorder };
    const osmDirectory = resilientDirectory(overpass, ctx);
    // One incident per Google failure, auto_fixed when OpenStreetMap served the customer and the
    // error was temporary. The demo fallback stays outside: demo data never counts as a fix.
    const directory = google ? recoveringDirectory(google, osmDirectory, ctx, 'google.searchText', 'OpenStreetMap', log) : osmDirectory;
    return handleProviderMatch(body, {
      ...deps,
      log,
      geocoder: resilientGeocoder(deps.geocoder, ctx),
      directory: demo ? withDemoFallback(directory, demo, log) : directory,
      capacity: resilientCapacity(deps.capacity, ctx),
    });
  };
}
