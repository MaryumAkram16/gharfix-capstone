import type { Env, FetchLike } from '../booking/deps.js';
import { createSupabaseRepository, supabaseConfigFromEnv, type CapacityReader } from '../booking/repository.js';
import type { LocalHandler } from '../http/proxy.js';
import type { Logger } from '../log.js';
import { handleProviderMatch, type MatchDeps } from './handler.js';
import { createNominatimGeocoder, createOverpassDirectory, DEFAULT_NOMINATIM_URL, DEFAULT_OVERPASS_URL, DEFAULT_USER_AGENT } from './osm.js';

export interface MatchDepsOptions {
  env: Env;
  log: Logger;
  fetch?: FetchLike;
}

/**
 * OpenStreetMap for places, Supabase for today's capacity. Without Supabase
 * env vars matching still runs; every response then says
 * capacity_checked: false.
 */
export function createMatchDeps({ env, log, fetch }: MatchDepsOptions): MatchDeps {
  const osm = { fetch, log, userAgent: env.OSM_USER_AGENT?.trim() || DEFAULT_USER_AGENT };
  let capacity: CapacityReader;
  try {
    capacity = createSupabaseRepository(supabaseConfigFromEnv(env), { fetch, log });
  } catch (err) {
    log.warn('match.capacity_not_configured', { error: err });
    capacity = { activeBookingCounts: async () => { throw err; } };
  }
  return {
    geocoder: createNominatimGeocoder(env.NOMINATIM_URL?.trim() || DEFAULT_NOMINATIM_URL, osm),
    directory: createOverpassDirectory(env.OVERPASS_URL?.trim() || DEFAULT_OVERPASS_URL, osm),
    capacity,
    now: () => new Date(),
    log,
  };
}

/** khadmat-provider-match. Dependencies are built once per warm instance. */
export function createMatchRoute(opts: MatchDepsOptions): LocalHandler {
  let deps: MatchDeps | null = null;
  return async (body, meta) => {
    deps ??= createMatchDeps(opts);
    return handleProviderMatch(body, { ...deps, log: deps.log.child({ request_id: meta.requestId }) });
  };
}
