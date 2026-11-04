import type { Env, FetchLike } from '../booking/deps.js';
import { createSupabaseRepository, supabaseConfigFromEnv, type CapacityReader } from '../booking/repository.js';
import type { LocalHandler } from '../http/proxy.js';
import type { Logger } from '../log.js';
import { resilientCapacity, type IncidentRecorder } from '../resilience/index.js';
import { createDemoDirectory, withDemoFallback } from './demo.js';
import { handleProviderMatch, type MatchDeps } from './handler.js';
import { createNominatimGeocoder, createOverpassDirectory, DEFAULT_NOMINATIM_URL, DEFAULT_OVERPASS_URL, DEFAULT_USER_AGENT } from './osm.js';

export interface MatchDepsOptions {
  env: Env;
  log: Logger;
  fetch?: FetchLike;
  recorder?: IncidentRecorder;
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
  const overpass = createOverpassDirectory(env.OVERPASS_URL?.trim() || DEFAULT_OVERPASS_URL, osm);
  // Off unless exactly "1": demo providers are fictional and must never appear by accident.
  const demoEnabled = env.USE_DEMO_PROVIDERS === '1';
  if (demoEnabled) log.warn('match.demo_providers_enabled', { dataset: 'db/seed/demo_providers.json' });
  return {
    geocoder: createNominatimGeocoder(env.NOMINATIM_URL?.trim() || DEFAULT_NOMINATIM_URL, osm),
    directory: demoEnabled ? withDemoFallback(overpass, createDemoDirectory(), log) : overpass,
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
    const capacity = opts.recorder
      ? resilientCapacity(deps.capacity, { workflow: 'khadmat-provider-match', requestId: meta.requestId, recorder: opts.recorder })
      : deps.capacity;
    return handleProviderMatch(body, { ...deps, capacity, log: deps.log.child({ request_id: meta.requestId }) });
  };
}
