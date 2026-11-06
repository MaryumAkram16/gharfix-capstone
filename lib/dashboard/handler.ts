import { RepositoryError } from '../booking/repository.js';
import { internalError, ok, serviceUnavailable, validationError, type HttpResult } from '../http/errors.js';
import type { Logger } from '../log.js';
import { computeDashboard, isDone, providerIds, scoreRow, type DashBooking } from './engine.js';
import type { DashboardStore } from './store.js';

// khadmat-provider-dashboard (WF8) and the nightly provider_scores refresh (WF8b).

export interface DashboardDeps {
  store: DashboardStore;
  now: () => Date;
  log: Logger;
}

function int(v: unknown, min: number, max: number, fallback: number): number | undefined {
  if (v === undefined || v === null || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

/** Entry point for POST khadmat-provider-dashboard. Never throws. */
export async function handleDashboardRequest(body: Record<string, unknown>, deps: DashboardDeps): Promise<HttpResult<unknown>> {
  const problems: string[] = [];
  const providerId = typeof body.provider_id === 'string' ? body.provider_id.trim() : '';
  if (!providerId || providerId.length > 200) problems.push('provider_id');
  // n8n defaults: base rate PKR 900, 4 bookings a day.
  const baseRate = int(body.base_rate_pkr, 100, 100_000, 900);
  if (baseRate === undefined) problems.push('base_rate_pkr');
  const maxDaily = int(body.max_daily_bookings, 1, 20, 4);
  if (maxDaily === undefined) problems.push('max_daily_bookings');
  if (problems.length) return validationError(`Invalid fields: ${problems.join(', ')}`, problems);
  const providerName = typeof body.provider_name === 'string' && body.provider_name.trim() ? body.provider_name.trim().slice(0, 200) : 'Provider';
  const log = deps.log.child({ provider_id: providerId });

  try {
    const [mine, platform] = await Promise.all([deps.store.providerBookings(providerId), deps.store.platformDone()]);
    const dashboard = computeDashboard({ provider_id: providerId, provider_name: providerName, base_rate_pkr: baseRate!, max_daily_bookings: maxDaily! }, mine, platform, deps.now());
    log.info('dashboard.done', { bookings: mine.length, completed: dashboard.earnings.total_completed_jobs });
    return ok(dashboard);
  } catch (err) {
    if (err instanceof RepositoryError && err.kind === 'unavailable') {
      log.error('dashboard.db_unavailable', { error: err });
      return serviceUnavailable();
    }
    log.error('dashboard.unhandled_error', { error: err });
    return internalError();
  }
}

export interface RefreshResult { providers: number; rows_written: number }

/** WF8b: recompute every provider's scores and upsert them. Throws when Supabase fails (the caller answers 503). */
export async function refreshProviderScores(deps: DashboardDeps): Promise<RefreshResult> {
  const now = deps.now();
  const all = await deps.store.allBookings();
  const platform = all.filter(isDone);
  const rows = providerIds(all).map((id) => {
    const mine = all.filter((b: DashBooking) => b.provider_id === id || b.reassigned_to_provider_id === id);
    const name = mine.find((b) => b.provider_id === id)?.provider_name ?? mine[0]?.new_provider_name;
    return scoreRow(computeDashboard({ provider_id: id, provider_name: typeof name === 'string' && name ? name : id, base_rate_pkr: 900, max_daily_bookings: 4 }, mine, platform, now));
  });
  // In chunks, so one request never carries thousands of rows.
  for (let i = 0; i < rows.length; i += 500) await deps.store.upsertScores(rows.slice(i, i + 500));
  deps.log.info('scores.refreshed', { providers: rows.length });
  return { providers: rows.length, rows_written: rows.length };
}
