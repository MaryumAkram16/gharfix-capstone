import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeDashboard, maskEmail, scoreRow, type DashBooking } from '../../lib/dashboard/engine';

// Against the original "WF8 — Optimization Engine" node. n8n only counted
// status = 'completed' (a status nothing sets) and also counted customer
// cancellations, so the shared fixture uses status 'completed' and no
// customer cancellations; the differences are tested below.

const workflow = JSON.parse(readFileSync(resolve(__dirname, '../../n8n-workflows/WF8_Provider_Optimization_Agent.json'), 'utf8')) as {
  nodes: Array<{ name: string; parameters: { jsCode?: string } }>;
};
const code = workflow.nodes.find((n) => n.name === 'WF8 — Optimization Engine')!.parameters.jsCode!;
function n8nEngine(intake: Record<string, unknown>, mine: DashBooking[], platform: DashBooking[], profile: unknown = { error: 'none' }) {
  const nodes: Record<string, unknown[]> = {
    'WF8 — Intake & Validator': [intake], 'Fetch Provider Bookings': mine, 'Fetch Platform Bookings': platform, 'Code in JavaScript': [profile],
  };
  const $ = (n: string) => ({ first: () => ({ json: nodes[n][0] }), all: () => nodes[n].map((json) => ({ json })) });
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return (new Function('$', 'console', code) as any)($, { log: () => {} })[0].json;
}

const NOW = new Date('2026-11-06T06:00:00Z'); // same date in UTC and Pakistan
const P = 'osm:node/1';
const b = (id: string, over: Partial<DashBooking>): DashBooking => ({
  booking_id: id, provider_id: P, provider_name: 'Ali Plumbers', user_name: 'Ayesha Khan', user_email: `${id}@example.test`,
  service_type: 'plumber', location: 'G-13', slot: '09:00', booking_date: '2026-11-01', price_pkr: 1500, status: 'confirmed', ...over,
});
const MINE: DashBooking[] = [
  b('t1', { booking_date: '2026-11-06', slot: '09:00' }),
  b('t2', { booking_date: '2026-11-06', slot: '14:00', status: 'in_progress' }),
  b('c1', { status: 'completed', final_price_pkr: 1800, customer_rating: 5, user_email: 'repeat@example.test' }),
  b('c2', { status: 'completed', price_pkr: 1200, customer_rating: 2, flagged_for_review: true, user_email: 'repeat@example.test' }),
  b('c3', { status: 'completed', price_pkr: 2000 }),
  b('ns', { status: 'no_show' }),
  b('lost', { status: 'rescheduled', provider_action_locked: true }),
  b('gain', { provider_id: 'osm:node/9', reassigned_to_provider_id: P, status: 'completed', price_pkr: 1000, customer_rating: 4 }),
];
const PLATFORM: DashBooking[] = [...MINE.filter((x) => x.status === 'completed'), b('o1', { provider_id: 'x', status: 'completed', price_pkr: 3000, slot: '16:00' }), b('o2', { provider_id: 'x', status: 'completed', price_pkr: 2500, slot: '16:00' })];
const intake = { provider_id: P, provider_name: 'Ali Plumbers', base_rate_pkr: 900, max_daily_bookings: 4 };

describe('WF8 engine matches n8n on the same bookings', () => {
  const ours = computeDashboard(intake, MINE, PLATFORM, NOW);
  const theirs = n8nEngine({ ...intake, today: '2026-11-06' }, MINE, PLATFORM);

  it.each(['workload', 'earnings', 'cancellations', 'reschedule_impact', 'rate_optimization'] as const)('%s', (k) => {
    expect(ours[k]).toEqual(theirs[k]);
  });

  it('reputation (n8n read the Google rating from a WF2 call; none here)', () => {
    const { rating_source: _a, google_rating: _b, google_review_count: _c, ...r } = ours.reputation;
    const { rating_source: _d, google_rating: _e, google_review_count: _f, ...t } = theirs.reputation;
    expect(r).toEqual(t);
  });

  it('demand forecast, tips and the bookings list (minus masked names)', () => {
    expect(ours.demand_forecast.recommended_slots).toEqual(theirs.demand_forecast.recommended_slots);
    expect(ours.optimization_tips).toEqual(theirs.optimization_tips);
    expect(ours.bookings.map(({ user_name: _u, ...x }) => x)).toEqual(theirs.bookings.map(({ user_name: _u, ...x }: any) => x));
  });

  it('loyalty counts match, but emails are masked (n8n exposed them)', () => {
    expect(ours.loyalty.repeat_customers).toBe(theirs.loyalty.repeat_customers);
    expect(theirs.loyalty.repeat_customer_list[0].email).toBe('repeat@example.test');
    expect(ours.loyalty.repeat_customer_list).toEqual([{ email: 'r***@example.test', bookings: 2 }]);
    expect(JSON.stringify(ours)).not.toMatch(/[a-z0-9]{2,}@example\.test/);
    expect(ours.bookings[0].user_name).toBe('Ayesha');
  });
});

describe('where the port differs from n8n', () => {
  it('counts jobs that really finished: WF5 leaves status feedback_done / current_status completed, never "completed"', () => {
    const real = [b('f1', { status: 'feedback_done', current_status: 'feedback_done', customer_rating: 5 }), b('f2', { status: 'confirmed', current_status: 'completed', price_pkr: 2000 }), b('f3', { status: 'disputed', current_status: 'feedback_done', customer_rating: 1 })];
    const ours = computeDashboard(intake, real, real, NOW);
    expect(ours.earnings).toMatchObject({ total_completed_jobs: 3, total_earnings_pkr: 5000 });
    expect(ours.reputation).toMatchObject({ in_app_avg_rating: 3, total_in_app_ratings: 2 });
    expect(n8nEngine({ ...intake, today: '2026-11-06' }, real, real).earnings.total_completed_jobs).toBe(0);
  });

  it('customer cancellations do not count against the provider', () => {
    const rows = [b('a', { status: 'cancelled' }), b('b', { status: 'confirmed' })];
    expect(computeDashboard(intake, rows, [], NOW).cancellations).toEqual({ total_cancelled: 0, cancellation_rate_pct: 0, status: 'GOOD' });
    expect(n8nEngine({ ...intake, today: '2026-11-06' }, rows, []).cancellations.cancellation_rate_pct).toBe(50);
  });

  it('no invented platform average: NOT_ENOUGH_DATA instead of PKR 1200 / FAIR', () => {
    const d = computeDashboard(intake, [b('a', {})], [], NOW);
    expect(d.earnings).toMatchObject({ platform_avg_pkr: null, earning_index: null, earning_fairness: 'NOT_ENOUGH_DATA', avg_per_job_pkr: 0, total_earnings_pkr: 0 });
    expect(n8nEngine({ ...intake, today: '2026-11-06' }, [b('a', {})], []).earnings).toMatchObject({ platform_avg_pkr: 1200, earning_fairness: 'FAIR' });
  });

  it('"4:00 PM" and "16:00" are the same slot, and "today" is the Pakistan date', () => {
    const late = new Date('2026-11-06T20:00:00Z'); // already 7 Nov in Pakistan
    const rows = [b('a', { booking_date: '2026-11-07', slot: '4:00 PM' })];
    expect(computeDashboard(intake, rows, rows, late).workload).toMatchObject({ bookings_today: 1, slots_booked_today: ['16:00'] });
  });

  it('profile from the latest booking snapshot, no live provider search', () => {
    const rows = [b('old', { created_at: '2026-10-01', provider_rating: 3.9 }), b('new', { created_at: '2026-11-01', provider_rating: 4.6, provider_review_count: 80, provider_google_maps_url: 'https://maps.google.com/?cid=1' })];
    expect(computeDashboard(intake, rows, [], NOW).profile).toMatchObject({ source: 'booking_snapshot', google_rating: 4.6, review_count: 80 });
    expect(computeDashboard(intake, rows, [], NOW).reputation).toMatchObject({ avg_rating: 4.6, rating_source: 'recorded_at_booking' });
  });

  it('texts say GharFix', () => {
    expect(computeDashboard(intake, MINE, PLATFORM, NOW).simulated_whatsapp).toContain('GharFix');
  });
});

describe('scoreRow (WF8b)', () => {
  it('has exactly the provider_scores columns, with raw', () => {
    const row = scoreRow(computeDashboard(intake, MINE, PLATFORM, NOW));
    const columns = readFileSync(resolve(__dirname, '../../db/provider_scores.sql'), 'utf8').match(/^\s{2}([a-z_]+)\s/gm)!.map((c) => c.trim());
    expect(Object.keys(row).sort()).toEqual([...new Set(columns)].sort());
    expect(row.raw).toMatchObject({ provider_id: P, total_completed_jobs: 4 });
  });
});

describe('maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmail('ayesha@gmail.com')).toBe('a***@gmail.com');
    expect(maskEmail('nope')).toBe('***');
  });
});
