import type { Logger } from '../log.js';
import { normaliseSlot } from './slot.js';

// Bookings in Supabase over PostgREST, with plain fetch. Query strings are
// built with URLSearchParams and bodies with JSON.stringify, so user text is
// never spliced into a URL or a JSON string.
//
// The handler only sees the BookingRepository interface; tests swap in a fake.

/** Statuses that occupy a provider's slot (same filter as WF4). */
export const ACTIVE_STATUSES = ['confirmed', 'in_progress'] as const;

/**
 * Unique constraints the repository understands. bookings_booking_id_key is in
 * db/bookings.sql; the other two come from the booking-integrity migration.
 */
export const CONSTRAINTS = {
  slot: 'bookings_active_slot_key',
  idempotencyKey: 'bookings_idempotency_key_key',
  bookingId: 'bookings_booking_id_key',
} as const;

export interface NewBooking {
  booking_id: string;
  user_name: string;
  user_email: string | null;
  service_type: string;
  provider_id: string;
  provider_name: string;
  location: string;
  /** Normalised "HH:MM". */
  slot: string;
  booking_date: string;
  price_pkr: number;
  status: 'confirmed';
  created_at: string;
  idempotency_key: string | null;
  request_fingerprint: string | null;
  provider_rating: number | null;
  provider_review_count: number | null;
  provider_address: string;
  provider_distance_km: number | null;
  provider_reputation_score: number | null;
  provider_verified: boolean;
  provider_google_maps_url: string;
  provider_coordinates_lat: number | null;
  provider_coordinates_lng: number | null;
}

/** A row as read back. Older rows may hold "4:00 PM" style slots and null fields. */
export type BookingRow = Omit<NewBooking, 'status'> & { status: string | null; [column: string]: unknown };

export interface BookingRepository {
  /** Active booked slots ("HH:MM") per date for one provider. Every requested date is a key. */
  bookedSlots(providerId: string, dates: string[]): Promise<Map<string, string[]>>;
  findByIdempotencyKey(key: string): Promise<BookingRow | null>;
  /** Throws BookingConflictError on a unique violation, RepositoryError otherwise. */
  insert(row: NewBooking): Promise<BookingRow>;
}

export type ConflictTarget = 'slot' | 'idempotency_key' | 'booking_id' | 'unknown';

/** Postgres refused the insert because it would duplicate a unique key. */
export class BookingConflictError extends Error {
  readonly name = 'BookingConflictError';
  constructor(
    readonly target: ConflictTarget,
    readonly constraint: string | null,
    readonly pgCode: string,
  ) {
    super(`Booking conflicts with an existing row (${constraint ?? 'unknown constraint'})`);
  }
}

/**
 * The database could not answer. `unavailable` is worth retrying (network,
 * timeout, 5xx, 429); `unexpected` is a bug or misconfiguration (bad key,
 * missing column) and retrying will not help.
 */
export class RepositoryError extends Error {
  readonly name = 'RepositoryError';
  constructor(
    readonly kind: 'unavailable' | 'unexpected',
    message: string,
    readonly httpStatus: number | null = null,
    readonly pgCode: string | null = null,
  ) {
    super(message);
  }
}

export interface SupabaseConfig {
  url: string;
  serviceRoleKey: string;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 8000;

/** Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Errors name the variable, never its value. */
export function supabaseConfigFromEnv(env: Record<string, string | undefined> = process.env): SupabaseConfig {
  const url = env.SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const missing = [!url && 'SUPABASE_URL', !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean);
  if (missing.length) throw new Error(`Missing environment variable(s): ${missing.join(', ')}`);
  try {
    new URL(url!);
  } catch {
    throw new Error('SUPABASE_URL is not a valid URL');
  }
  const timeout = Number(env.SUPABASE_TIMEOUT_MS);
  return { url: url!, serviceRoleKey: serviceRoleKey!, timeoutMs: timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS };
}

/** PostgREST list literal: in.("a","b"), quoting each value so commas or parens cannot break out. */
export function pgIn(values: readonly string[]): string {
  return `in.(${values.map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')})`;
}

const CONSTRAINT_IN_MESSAGE = /unique constraint "([^"]+)"/;

export function conflictTarget(constraint: string | null): ConflictTarget {
  if (constraint === CONSTRAINTS.slot) return 'slot';
  if (constraint === CONSTRAINTS.idempotencyKey) return 'idempotency_key';
  if (constraint === CONSTRAINTS.bookingId) return 'booking_id';
  return 'unknown';
}

interface PostgrestError {
  code?: string;
  message?: string;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface SupabaseRepositoryOptions {
  fetch?: FetchLike;
  log?: Logger;
}

export function createSupabaseRepository(
  config: SupabaseConfig,
  { fetch: fetchImpl = fetch, log }: SupabaseRepositoryOptions = {},
): BookingRepository {
  const endpoint = new URL('/rest/v1/bookings', config.url).toString();
  const headers = {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  async function request(method: 'GET' | 'POST', params: URLSearchParams | null, body?: unknown, extra?: Record<string, string>) {
    const url = params ? `${endpoint}?${params.toString()}` : endpoint;
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method,
        headers: { ...headers, ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'network error';
      throw new RepositoryError('unavailable', `Supabase ${method} ${reason}`);
    }

    if (res.ok) {
      try {
        return (await res.json()) as unknown;
      } catch {
        throw new RepositoryError('unexpected', `Supabase ${method} returned a non-JSON body`, res.status);
      }
    }

    let pg: PostgrestError = {};
    try {
      pg = (await res.json()) as PostgrestError;
    } catch {
      // Gateways in front of Supabase answer 5xx with HTML; the status is enough.
    }

    if (pg.code === '23505' || pg.code === '23P01') {
      const constraint = CONSTRAINT_IN_MESSAGE.exec(pg.message ?? '')?.[1] ?? null;
      // 23P01 is an exclusion constraint: only ever used for slot overlaps.
      const target = pg.code === '23P01' ? 'slot' : conflictTarget(constraint);
      throw new BookingConflictError(target, constraint, pg.code);
    }
    const kind = res.status >= 500 || res.status === 429 || res.status === 408 ? 'unavailable' : 'unexpected';
    throw new RepositoryError(kind, `Supabase ${method} failed with HTTP ${res.status}`, res.status, pg.code ?? null);
  }

  return {
    async bookedSlots(providerId, dates) {
      const result = new Map<string, string[]>(dates.map((d) => [d, []]));
      if (dates.length === 0) return result;
      const params = new URLSearchParams({
        select: 'slot,booking_date',
        provider_id: `eq.${providerId}`,
        booking_date: dates.length === 1 ? `eq.${dates[0]}` : pgIn(dates),
        status: pgIn(ACTIVE_STATUSES),
      });
      const rows = (await request('GET', params)) as Array<{ slot: unknown; booking_date: string }>;
      if (!Array.isArray(rows)) throw new RepositoryError('unexpected', 'Supabase GET returned a non-array body');
      for (const row of rows) {
        const slot = normaliseSlot(row.slot);
        if (slot === null) {
          // An unreadable slot cannot be placed on the timeline; surface it rather than guess.
          log?.warn('booking.unparseable_slot', { provider_id: providerId, booking_date: row.booking_date, slot: row.slot });
          continue;
        }
        result.get(row.booking_date)?.push(slot);
      }
      return result;
    },

    async findByIdempotencyKey(key) {
      const params = new URLSearchParams({ select: '*', idempotency_key: `eq.${key}`, limit: '1' });
      const rows = (await request('GET', params)) as BookingRow[];
      return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    },

    async insert(row) {
      const rows = (await request('POST', null, row, { Prefer: 'return=representation' })) as BookingRow[];
      if (!Array.isArray(rows) || rows.length !== 1) {
        throw new RepositoryError('unexpected', 'Supabase POST did not return the inserted row');
      }
      return rows[0];
    },
  };
}
