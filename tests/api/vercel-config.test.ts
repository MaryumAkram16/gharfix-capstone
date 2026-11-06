import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OSM_DEFAULTS } from '../../lib/matching/config';
import * as intent from '../../api/intent';
import * as providerMatch from '../../api/provider-match';
import * as proxy from '../../api/proxy';

// Vercel reads `export const config = { maxDuration }` from Node.js /api
// route files. Every function that can run provider matching needs 60 s.

describe('Vercel maxDuration', () => {
  it.each([
    ['api/proxy.ts', proxy],
    ['api/intent.ts', intent],
    ['api/provider-match.ts', providerMatch],
  ])('%s exports config.maxDuration = 60', (_file, mod) => {
    expect((mod as { config?: unknown }).config).toEqual({ maxDuration: 60 });
  });

  it('is set only on the functions that run provider matching (the others keep the platform default)', () => {
    const dir = resolve(__dirname, '../../api');
    const withConfig = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /export const config = \{ maxDuration: 60 \};/.test(readFileSync(resolve(dir, f), 'utf8')));
    expect(withConfig.sort()).toEqual(['intent.ts', 'provider-match.ts', 'proxy.ts']);
  });

  it('a provider search with default timeouts ends well inside 60 s', () => {
    const searchMs = OSM_DEFAULTS.nominatimTimeoutMs + OSM_DEFAULTS.overpassBudgetMs;
    expect(searchMs).toBe(25_000);
    expect(searchMs).toBeLessThan(60_000 / 2);
  });
});
