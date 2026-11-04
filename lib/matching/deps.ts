import type { Env, FetchLike } from '../booking/deps.js';
import { createSupabaseRepository, supabaseConfigFromEnv, type CapacityReader } from '../booking/repository.js';
import type { LocalHandler } from '../http/proxy.js';
import type { Logger } from '../log.js';
import { resilientCapacity, resilientDirectory, resilientGeocoder, type IncidentRecorder } from '../resilience/index.js';
import { osmConfigFromEnv } from './config.js';
import type { ProviderDirectory } from './directory.js';
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
  demo: ProviderDirectory | null;
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
  // Off unless exactly "1": demo providers are fictional and must never appear by accident.
  const demo = env.USE_DEMO_PROVIDERS === '1' ? createDemoDirectory() : null;
  if (demo) log.warn('match.demo_providers_enabled', { dataset: 'db/seed/demo_providers.json', used_when: 'OpenStreetMap returns zero providers or fails' });
  return {
    overpass,
    demo,
    deps: {
      geocoder: createNominatimGeocoder(config.nominatimUrl, { ...osm, timeoutMs: config.nominatimTimeoutMs }),
      directory: demo ? withDemoFallback(overpass, demo, log) : overpass,
      capacity,
      now: () => new Date(),
      log,
    },
  };
}

/**
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
    const { deps, overpass, demo } = parts;
    const log = deps.log.child({ request_id: meta.requestId });
    if (!opts.recorder) return handleProviderMatch(body, { ...deps, log });
    const ctx = { workflow: 'khadmat-provider-match', requestId: meta.requestId, recorder: opts.recorder };
    const directory = resilientDirectory(overpass, ctx);
    return handleProviderMatch(body, {
      ...deps,
      log,
      geocoder: resilientGeocoder(deps.geocoder, ctx),
      directory: demo ? withDemoFallback(directory, demo, log) : directory,
      capacity: resilientCapacity(deps.capacity, ctx),
    });
  };
}
