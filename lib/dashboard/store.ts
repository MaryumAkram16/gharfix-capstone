import { RepositoryError, type SupabaseRest } from '../booking/repository.js';
import type { DashBooking } from './engine.js';

// Supabase reads for WF8/WF8b and the provider_scores upsert. n8n spliced the
// provider id into the `or=(...)` filter unquoted; here it is quoted, so ids
// like "osm:node/1" or "google:ChIJ..." (or a crafted one with commas and
// parentheses) cannot change the filter.

const COLUMNS = [
  'booking_id', 'user_name', 'user_email', 'service_type', 'provider_id', 'provider_name', 'location', 'slot', 'booking_date',
  'price_pkr', 'final_price_pkr', 'status', 'current_status', 'customer_rating', 'flagged_for_review', 'cancellation_reason',
  'provider_action_locked', 'tracking_locked', 'reassigned_to_provider_id', 'reassigned_from_provider_id', 'new_provider_name',
  'new_provider_id', 'rescheduled_to_booking_id', 'created_at', 'provider_rating', 'provider_review_count', 'provider_address',
  'provider_distance_km', 'provider_verified', 'provider_reputation_score', 'provider_google_maps_url',
].join(',');

/** Upper bound per read: the dashboard and the nightly job stay bounded as the table grows. */
export const MAX_ROWS = 10_000;

export interface DashboardStore {
  providerBookings(providerId: string): Promise<DashBooking[]>;
  /** Completed jobs across the platform (earnings average and slot demand). */
  platformDone(): Promise<DashBooking[]>;
  /** Every booking, for the nightly refresh. */
  allBookings(): Promise<DashBooking[]>;
  upsertScores(rows: Array<Record<string, unknown>>): Promise<void>;
}

const quoted = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function list(body: unknown): DashBooking[] {
  if (!Array.isArray(body)) throw new RepositoryError('unexpected', 'Supabase returned a non-array body');
  return body as DashBooking[];
}

export function createDashboardStore(rest: SupabaseRest): DashboardStore {
  return {
    async providerBookings(providerId) {
      const params = new URLSearchParams({
        select: COLUMNS,
        or: `(provider_id.eq.${quoted(providerId)},reassigned_to_provider_id.eq.${quoted(providerId)})`,
        order: 'created_at.desc',
        limit: String(MAX_ROWS),
      });
      return list(await rest.request('bookings', 'GET', params));
    },
    async platformDone() {
      const params = new URLSearchParams({
        select: 'slot,price_pkr,final_price_pkr,status,current_status',
        or: '(status.in.(completed,feedback_done),current_status.in.(completed,feedback_done))',
        limit: String(MAX_ROWS),
      });
      return list(await rest.request('bookings', 'GET', params));
    },
    async allBookings() {
      const params = new URLSearchParams({ select: COLUMNS, order: 'created_at.desc', limit: String(MAX_ROWS) });
      return list(await rest.request('bookings', 'GET', params));
    },
    async upsertScores(rows) {
      if (rows.length === 0) return;
      const params = new URLSearchParams({ on_conflict: 'provider_id' });
      await rest.request('provider_scores', 'POST', params, rows, { Prefer: 'resolution=merge-duplicates,return=minimal' });
    },
  };
}
