import { createSupabaseRest, RepositoryError, type SupabaseConfig, type SupabaseRest } from './repository.js';

// One booking at a time, for the workflows that act on an existing booking
// (WF5 quality loop, WF6 disputes, WF7 cancel/reschedule). n8n PATCHed
// `bookings?booking_id=eq.{{ ... }}` with the id spliced into the URL and the
// body built as a JSON string; here the id goes through URLSearchParams and
// the body through JSON.stringify.
//
// Facts these workflows decide on (price, customer email, provider, date)
// are read from this row, never taken from the request.

/** The columns these workflows read. Older rows may have nulls anywhere. */
export interface BookingRecord {
  booking_id: string;
  status: string | null;
  user_name: string | null;
  user_email: string | null;
  service_type: string | null;
  provider_id: string | null;
  provider_name: string | null;
  location: string | null;
  slot: string | null;
  booking_date: string | null;
  price_pkr: number | null;
  final_price_pkr: number | null;
  customer_rating: number | null;
  feedback_sentiment: string | null;
  [column: string]: unknown;
}

/** Columns a workflow may write. Anything else is a bug, so the type says so. */
export interface BookingPatch {
  status?: string;
  previous_status?: string | null;
  flagged_for_review?: boolean;
  updated_at?: string;
  eta_minutes?: number | null;
  arrival_time?: string | null;
  completion_time?: string | null;
  final_price_pkr?: number | null;
  customer_rating?: number | null;
  customer_review?: string | null;
  feedback_sentiment?: string | null;
  cancellation_reason?: string | null;
  new_provider_id?: string | null;
  new_provider_name?: string | null;
  new_slot?: string | null;
  rescheduled_to_booking_id?: string | null;
  reassigned_from_provider_id?: string | null;
  reassigned_to_provider_id?: string | null;
  rescheduled_by?: string | null;
  tracking_status?: string | null;
  current_status?: string | null;
  last_action?: string | null;
}

export interface ProviderHistory {
  /** Bookings with this provider, any status. */
  total: number;
  /** How many of them ended as no_show or provider_cancelled. */
  noShowOrCancelled: number;
}

export interface BookingRecords {
  find(bookingId: string): Promise<BookingRecord | null>;
  /**
   * Update one booking. With `ifStatus`, only while its status is still one of
   * those (a compare-and-set, so two requests cannot both move it). Returns
   * the updated row, or null when no row matched.
   */
  update(bookingId: string, patch: BookingPatch, ifStatus?: readonly string[]): Promise<BookingRecord | null>;
  providerHistory(providerId: string): Promise<ProviderHistory>;
}

export const PROVIDER_FAULT_STATUSES = ['no_show', 'provider_cancelled'] as const;

function quote(values: readonly string[]): string {
  return `in.(${values.map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')})`;
}

function rows(body: unknown): BookingRecord[] {
  if (!Array.isArray(body)) throw new RepositoryError('unexpected', 'Supabase returned a non-array body');
  return body as BookingRecord[];
}

export function createBookingRecords(rest: SupabaseRest): BookingRecords {
  return {
    async find(bookingId) {
      const params = new URLSearchParams({ select: '*', booking_id: `eq.${bookingId}`, limit: '1' });
      return rows(await rest.request('bookings', 'GET', params))[0] ?? null;
    },

    async update(bookingId, patch, ifStatus) {
      const params = new URLSearchParams({ booking_id: `eq.${bookingId}` });
      if (ifStatus) params.set('status', quote(ifStatus));
      const result = rows(await rest.request('bookings', 'PATCH', params, patch, { Prefer: 'return=representation' }));
      return result[0] ?? null;
    },

    async providerHistory(providerId) {
      // Only the status column: this can be a provider's whole history.
      const params = new URLSearchParams({ select: 'status', provider_id: `eq.${providerId}` });
      const all = rows(await rest.request('bookings', 'GET', params));
      const faults = all.filter((r) => (PROVIDER_FAULT_STATUSES as readonly string[]).includes(String(r.status))).length;
      return { total: all.length, noShowOrCancelled: faults };
    },
  };
}

export function createSupabaseBookingRecords(config: SupabaseConfig, opts: { fetch?: (input: string, init: RequestInit) => Promise<Response> } = {}): BookingRecords {
  return createBookingRecords(createSupabaseRest(config, opts));
}
