import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSurgeHour, pakistanHour, priceServices } from '../../lib/matching/pricing';
import { scoreProvider, scoreServices } from '../../lib/matching/scoring';
import type { Provider } from '../../lib/matching/types';

// "Identical" checked, not assumed: these tests run the original n8n Code
// nodes from n8n-workflows/WF1-3_*.json and compare their output with the
// TypeScript port on the same inputs. n8n could only handle providers with
// every field filled in (it invented the missing ones), so the inputs here
// are complete providers.

const workflow = JSON.parse(
  readFileSync(resolve(__dirname, '../../n8n-workflows/WF1-3_Intent_Provider_Matching_Pricing_Agent.json'), 'utf8'),
) as { nodes: Array<{ name: string; parameters: { jsCode?: string } }> };

function n8nNode(name: string) {
  const code = workflow.nodes.find((n) => n.name === name)?.parameters.jsCode;
  if (!code) throw new Error(`n8n node not found: ${name}`);
  // The workflow's own code (checked into this repo), run with n8n's $ / $input stubbed.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('$', '$input', code) as (...args: unknown[]) => Array<{ json: any }>;
  return (nodes: Record<string, unknown>, input?: unknown) =>
    fn((n: string) => ({ first: () => ({ json: nodes[n] }) }), { first: () => ({ json: input }) })[0].json;
}

const runN8nScoring = n8nNode('Calculate Provider Scores');
const runN8nPricing = n8nNode('WF3 — Pricing Agent (inline)1');

const NOW = new Date('2026-11-04T10:30:00Z');

function provider(over: Partial<Provider>): Provider {
  return {
    id: 'p', name: 'P', owner: 'P', services: ['plumber'], complexity_levels: ['basic'], areas: ['G-13'],
    coordinates: { lat: 33.65, lng: 73.01 }, address: '', base_rate_pkr: 900, base_rate_source: 'gharfix_default',
    rating: 4.2, review_count: 30, last_review_date: '2026-11-02', on_time_score: 0.8, cancellation_rate: 0.05,
    availability_slots: ['09:00', '11:00'], active_bookings: 0, max_daily_bookings: 4, at_capacity: false,
    distance_km: 2.4, distance_type: 'straight_line', verified: false, reputation_score: 70,
    google_maps_url: '', osm_url: '', place_id: 'p', photos: [], source: 'openstreetmap', data_gaps: [],
    ...over,
  };
}

const PROVIDERS: Provider[] = [
  provider({ id: 'a', name: 'Near, new review', distance_km: 0.8, rating: 4.9, last_review_date: '2026-11-03', base_rate_pkr: 600 }),
  provider({ id: 'b', name: 'Far, cheap', distance_km: 11.2, rating: 3.6, last_review_date: '2026-09-01', base_rate_pkr: 400, cancellation_rate: 0.25 }),
  provider({ id: 'c', name: 'Full today', active_bookings: 4, rating: 4.5, last_review_date: '2026-10-30', base_rate_pkr: 1300 }),
  provider({ id: 'd', name: 'No slots', availability_slots: [], rating: 4.0, last_review_date: '2026-10-10', base_rate_pkr: 2000 }),
  provider({ id: 'e', name: 'Electric only', services: ['electrician'], complexity_levels: ['basic', 'intermediate'], base_rate_pkr: 1000 }),
  provider({ id: 'f', name: 'Does everything', services: ['plumber', 'electrician', 'AC repair'], complexity_levels: ['basic', 'intermediate', 'complex'], on_time_score: 0.99, distance_km: 5 }),
  // Review-recency boundaries relative to NOW (2026-11-04T10:30Z): 3, 4, 7, 8, 30 and 31 days old.
  ...['2026-11-01', '2026-10-31', '2026-10-28', '2026-10-27', '2026-10-05', '2026-10-04'].map((d, i) =>
    provider({ id: `r${i}`, name: `Reviewed ${d}`, last_review_date: d, rating: 3.9, distance_km: 3 + i / 10, base_rate_pkr: [700, 701, 1500, 1501, 1001, 999][i] })),
];

const PROVIDER_SETS = [PROVIDERS.slice(0, 6), PROVIDERS.slice(6)];
expect(PROVIDER_SETS.every((set) => set.length <= 7)).toBe(true);

const INTENTS = [
  { services: ['plumber'], job_complexity: 'basic', budget_sensitivity: 'medium' },
  { services: ['plumber'], job_complexity: 'complex', budget_sensitivity: 'high' },
  { services: ['electrician'], job_complexity: 'intermediate', budget_sensitivity: 'low' },
  { services: ['plumber', 'electrician'], job_complexity: 'intermediate', budget_sensitivity: 'high' },
  { services: ['AC repair', 'plumber', 'electrician'], job_complexity: null, budget_sensitivity: null },
];

afterEach(() => vi.useRealTimers());

function withoutAdditions<T extends { unknown_factors?: unknown }>(p: T) {
  const { unknown_factors: _u, ...rest } = p;
  return rest;
}

describe('scoring matches n8n "Calculate Provider Scores"', () => {
  it.each(INTENTS.map((i) => [i.services.join('+'), i.job_complexity, i.budget_sensitivity, i] as const))(
    '%s / complexity %s / budget %s',
    (_s, _c, _b, intent) => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      // n8n only returns the top match + 6 alternatives, so compare in sets of
      // at most 7: every provider's score is then visible in both outputs.
      for (const set of PROVIDER_SETS) {
        const n8n = runN8nScoring({
          'WF2 — HTTP Trigger1': { body: { ...intent, location: 'G-13' } },
          'Map Places → Provider Schema1': { providers: set },
        });
        const ours = scoreServices(intent.services, set, intent, NOW);

        expect(n8n.status).toBe('success');
        expect(ours.map((s) => ({
          ...s,
          top_match: s.top_match && withoutAdditions(s.top_match),
          alternatives: s.alternatives.map(withoutAdditions),
        }))).toEqual(n8n.services);
      }
    },
  );

  it('reports nothing unknown when every field is known', () => {
    expect(scoreProvider(PROVIDERS[0], 'plumber', INTENTS[0], NOW).unknown_factors).toEqual([]);
  });
});

describe('pricing matches n8n "WF3 — Pricing Agent"', () => {
  // n8n read getHours() from the server clock; the port takes the hour as an argument.
  it.each([
    '2026-11-04T08:59:00', '2026-11-04T09:00:00', '2026-11-04T11:59:00', '2026-11-04T12:00:00', '2026-11-04T14:00:00',
    '2026-11-04T16:59:00', '2026-11-04T17:00:00', '2026-11-04T19:59:00', '2026-11-04T20:00:00',
  ])(
    'at local time %s',
    (local) => {
      for (const intent of INTENTS) {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(local));
        for (const set of PROVIDER_SETS) {
          const matches = scoreServices(intent.services, set, intent, NOW);
          const n8n = runN8nPricing({ 'WF2 — HTTP Trigger1': { body: { ...intent, location: 'G-13' } } }, { services: matches });
          expect(priceServices(matches, { job_complexity: intent.job_complexity, location: 'G-13' }, new Date().getHours())).toEqual(n8n);
        }
      }
    },
  );

  it('handles a service with no provider the same way', () => {
    const matches = [{ service: 'tutor', requested_complexity: 'basic', top_match: null, alternatives: [], total_evaluated: 0, status: 'no_providers_found' as const }];
    const n8n = runN8nPricing({ 'WF2 — HTTP Trigger1': { body: { job_complexity: 'basic', location: 'G-13' } } }, { services: matches });
    expect(priceServices(matches, { job_complexity: 'basic', location: 'G-13' }, 14)).toEqual(n8n);
  });
});

describe('unknown factors (what OSM cannot provide)', () => {
  const unknown = provider({ rating: null, review_count: null, last_review_date: null, on_time_score: null, cancellation_rate: null, reputation_score: null });

  it('add nothing to the total and show as null in the breakdown', () => {
    const s = scoreProvider(unknown, 'plumber', INTENTS[0], NOW);
    expect(s.score_breakdown).toEqual({
      distance: 76, availability: 100, review: null, reliability: null, specialization: 100, price: 80, cancellation: null, total: 58,
    });
    // 76*0.2 + 100*0.2 + 100*0.15 + 80*0.1 = 58.2
    expect(s.computed_score).toBe(58);
    expect(s.unknown_factors).toEqual(['review', 'reliability', 'cancellation']);
  });

  it('do not change the ranking between providers that all lack them', () => {
    const near = { ...unknown, id: 'near', distance_km: 1 };
    const far = { ...unknown, id: 'far', distance_km: 6 };
    expect(scoreServices(['plumber'], [far, near], INTENTS[0], NOW)[0].top_match!.id).toBe('near');
  });
});

describe('pakistanHour', () => {
  it('converts UTC to Asia/Karachi (UTC+5, no DST)', () => {
    expect(pakistanHour(new Date('2026-11-04T04:00:00Z'))).toBe(9);
    expect(pakistanHour(new Date('2026-11-04T19:30:00Z'))).toBe(0);
    expect(isSurgeHour(pakistanHour(new Date('2026-11-04T04:00:00Z')))).toBe(true);
    expect(isSurgeHour(pakistanHour(new Date('2026-11-04T09:00:00Z')))).toBe(false); // 14:00 PKT
  });
});
