import type { Logger } from '../log.js';
import type { NearbySearch, ProviderDirectory } from './directory.js';
import { ruleFor } from './osmServices.js';
import { haversineKm } from './providers.js';
import type { Place } from './types.js';

// Optional demo directory: fictional, clearly labelled providers in Lahore
// and Islamabad (db/seed/demo_providers.json). It is wired in only when
// USE_DEMO_PROVIDERS=1 (lib/matching/deps.ts), and consulted only when the
// real directory (OpenStreetMap) returns zero providers. It is never used
// when OpenStreetMap is unreachable: that stays a 503.

export interface DemoProvider {
  id: string;
  name: string;
  city: string;
  area: string;
  lat: number;
  lng: number;
  services: string[];
  address: string;
}

export interface DemoDataset {
  _notice: string;
  dataset: 'gharfix-demo-providers';
  version: 1;
  providers: DemoProvider[];
}

// Rough boxes around the two cities, to catch a typo'd coordinate in the seed file.
const CITY_BOUNDS: Record<string, { lat: [number, number]; lng: [number, number] }> = {
  Lahore: { lat: [31.2, 31.8], lng: [74.0, 74.6] },
  Islamabad: { lat: [33.5, 33.85], lng: [72.8, 73.3] },
};

/** Throws with the first problem found. Demo data must be unmistakably demo data. */
export function validateDemoDataset(raw: unknown): DemoDataset {
  const d = raw as Partial<DemoDataset> | null;
  if (!d || typeof d !== 'object') throw new Error('demo dataset: not an object');
  if (d.dataset !== 'gharfix-demo-providers' || d.version !== 1) throw new Error('demo dataset: wrong dataset/version');
  if (typeof d._notice !== 'string' || !d._notice.startsWith('DEMO DATA')) throw new Error('demo dataset: missing DEMO DATA notice');
  if (!Array.isArray(d.providers) || d.providers.length === 0) throw new Error('demo dataset: no providers');

  const ids = new Set<string>();
  for (const p of d.providers) {
    const where = `demo dataset: provider ${JSON.stringify(p?.id)}`;
    if (typeof p.id !== 'string' || !p.id.startsWith('demo:') || ids.has(p.id)) throw new Error(`${where}: id must be unique and start with "demo:"`);
    ids.add(p.id);
    if (typeof p.name !== 'string' || !p.name.startsWith('[DEMO] ')) throw new Error(`${where}: name must start with "[DEMO] "`);
    const bounds = CITY_BOUNDS[p.city];
    if (!bounds) throw new Error(`${where}: city must be Lahore or Islamabad`);
    if (!(p.lat >= bounds.lat[0] && p.lat <= bounds.lat[1] && p.lng >= bounds.lng[0] && p.lng <= bounds.lng[1])) {
      throw new Error(`${where}: coordinates outside ${p.city}`);
    }
    if (!Array.isArray(p.services) || p.services.length === 0 || !p.services.every((s) => typeof s === 'string' && s.trim())) {
      throw new Error(`${where}: services must be non-empty strings`);
    }
    if (typeof p.area !== 'string' || typeof p.address !== 'string') throw new Error(`${where}: area and address are required`);
    // Ratings, reviews and prices would be invented numbers: not allowed even in demo data.
    for (const forbidden of ['rating', 'review_count', 'reviews', 'price', 'base_rate_pkr', 'on_time_score', 'cancellation_rate']) {
      if (forbidden in p) throw new Error(`${where}: must not contain "${forbidden}"`);
    }
  }
  return d as DemoDataset;
}

/** Loaded on first use only, so a deployment without the flag never reads the file. */
export async function loadDemoDataset(): Promise<DemoDataset> {
  const mod = await import('../../db/seed/demo_providers.json', { with: { type: 'json' } });
  return validateDemoDataset(mod.default);
}

/** Does a demo provider offer the requested service? Same rule table as the OSM search. */
function offers(provider: DemoProvider, requested: string): boolean {
  const rule = ruleFor(requested);
  const wanted = requested.toLowerCase().trim();
  return provider.services.some((s) => s.toLowerCase() === wanted || (rule !== null && ruleFor(s) === rule));
}

export function createDemoDirectory(load: () => Promise<DemoDataset> = loadDemoDataset): ProviderDirectory {
  let dataset: Promise<DemoDataset> | null = null;
  return {
    async searchNearby({ services, center, radiusM, limit }: NearbySearch): Promise<Place[]> {
      dataset ??= load().catch((err) => { dataset = null; throw err; });
      const { providers } = await dataset;
      return providers
        .map((p) => ({ p, d: haversineKm(center, { lat: p.lat, lng: p.lng }), matched: services.filter((s) => offers(p, s)) }))
        .filter(({ d, matched }) => d * 1000 <= radiusM && matched.length > 0)
        .sort((a, b) => a.d - b.d)
        .slice(0, limit)
        .map(({ p, matched }) => ({
          id: p.id,
          name: p.name,
          lat: p.lat,
          lng: p.lng,
          address: p.address,
          matchedServices: matched,
          sourceUrl: '',
          source: 'demo_seed' as const,
        }));
    },
  };
}

/**
 * The real directory first. Only when it answers with zero providers is the
 * demo directory asked. Errors from the real directory propagate unchanged.
 */
export function withDemoFallback(primary: ProviderDirectory, demo: ProviderDirectory, log?: Logger): ProviderDirectory {
  return {
    async searchNearby(search) {
      const real = await primary.searchNearby(search);
      if (real.length > 0) return real;
      const fallback = await demo.searchNearby(search);
      log?.warn('match.demo_fallback_used', { services: search.services, demo_results: fallback.length });
      return fallback;
    },
  };
}
