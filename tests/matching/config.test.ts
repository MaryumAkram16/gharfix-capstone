import { describe, expect, it } from 'vitest';
import { OSM_DEFAULTS, osmConfigFromEnv } from '../../lib/matching/config';
import { DEFAULT_NOMINATIM_URL, DEFAULT_OVERPASS_FALLBACK_URL, DEFAULT_OVERPASS_URL, DEFAULT_USER_AGENT } from '../../lib/matching/osm';
import { memoryLogger } from '../../lib/log';

describe('osmConfigFromEnv', () => {
  it('defaults: public Nominatim, Overpass plus one mirror, 5 s / 8 s / 12 s', () => {
    expect(osmConfigFromEnv({})).toEqual({
      nominatimUrl: DEFAULT_NOMINATIM_URL,
      nominatimTimeoutMs: 5000,
      overpassUrls: [DEFAULT_OVERPASS_URL, DEFAULT_OVERPASS_FALLBACK_URL],
      overpassTimeoutMs: 8000,
      overpassBudgetMs: 12000,
      userAgent: DEFAULT_USER_AGENT,
    });
    expect(OSM_DEFAULTS).toEqual({ nominatimTimeoutMs: 5000, overpassTimeoutMs: 8000, overpassBudgetMs: 12000 });
  });

  it('reads every override', () => {
    expect(osmConfigFromEnv({
      NOMINATIM_URL: 'https://geo.internal.test', NOMINATIM_TIMEOUT_MS: '3000',
      OVERPASS_URL: 'https://overpass.internal.test/api/interpreter', OVERPASS_FALLBACK_URL: 'https://overpass2.internal.test/api/interpreter',
      OVERPASS_TIMEOUT_MS: '6000', OVERPASS_BUDGET_MS: '20000', OSM_USER_AGENT: 'GharFix-test/1.0',
    })).toEqual({
      nominatimUrl: 'https://geo.internal.test', nominatimTimeoutMs: 3000,
      overpassUrls: ['https://overpass.internal.test/api/interpreter', 'https://overpass2.internal.test/api/interpreter'],
      overpassTimeoutMs: 6000, overpassBudgetMs: 20000, userAgent: 'GharFix-test/1.0',
    });
  });

  it('OVERPASS_FALLBACK_URL=off (or the same URL as the main one) means a single instance', () => {
    expect(osmConfigFromEnv({ OVERPASS_FALLBACK_URL: 'off' }).overpassUrls).toEqual([DEFAULT_OVERPASS_URL]);
    expect(osmConfigFromEnv({ OVERPASS_FALLBACK_URL: 'OFF' }).overpassUrls).toEqual([DEFAULT_OVERPASS_URL]);
    expect(osmConfigFromEnv({ OVERPASS_FALLBACK_URL: DEFAULT_OVERPASS_URL }).overpassUrls).toEqual([DEFAULT_OVERPASS_URL]);
  });

  it.each([
    ['NOMINATIM_TIMEOUT_MS', 'soon'], ['NOMINATIM_TIMEOUT_MS', '10'], ['OVERPASS_TIMEOUT_MS', '120000'],
    ['OVERPASS_TIMEOUT_MS', '7.5'], ['OVERPASS_URL', 'not a url'], ['OVERPASS_URL', 'ftp://x.test'], ['NOMINATIM_URL', 'javascript:alert(1)'],
  ])('invalid %s=%j falls back to the default with a warning', (name, value) => {
    const log = memoryLogger();
    expect(osmConfigFromEnv({ [name]: value }, log)).toEqual(osmConfigFromEnv({}));
    expect(log.records).toEqual([expect.objectContaining({ level: 'warn', event: 'osm.config_invalid', variable: name })]);
  });

  it('never makes the budget shorter than one attempt', () => {
    expect(osmConfigFromEnv({ OVERPASS_TIMEOUT_MS: '9000', OVERPASS_BUDGET_MS: '3000' }).overpassBudgetMs).toBe(9000);
  });
});
