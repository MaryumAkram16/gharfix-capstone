import { createHash, randomInt } from 'node:crypto';
import { fail, internalError, ok, serviceUnavailable, validationError, type HttpResult } from '../http/errors';
import type { Logger } from '../log';
import { buildReceipt, confirmationEmail, type EmailMessage, type Receipt } from './receipt';
import {
  BookingConflictError, RepositoryError, type BookingRepository, type BookingRow, type NewBooking,
} from './repository';
import {
  addDays, alternativeDates, buildSlotList, findConflict, pakistanDate, serviceBlock,
  type AlternativeDate, type ServiceBlock,
} from './schedule';
import { normaliseSlot } from './slot';
import { validateConfirm, validateGetSlots, type ConfirmRequest, type Validated } from './validate';

// khadmat-booking (WF4) without n8n: get_slots and confirm.
// Everything with side effects comes in through BookingDeps.

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export interface BookingDeps {
  db: BookingRepository;
  email: EmailSender;
  newBookingId: (now: Date) => string;
  now: () => Date;
  log: Logger;
  /** How long the confirmation email may hold up the response. Default 5000. */
  emailTimeoutMs?: number;
}

const DEFAULT_EMAIL_TIMEOUT_MS = 5000;
const ALTERNATIVE_DAYS = 3;
const SLOT_TAKEN_MESSAGE = 'Yeh slot abhi kisi aur ne book kar liya. Kripya doosra slot chunein.';

/** WF4's id format: BK-<year>-<epoch ms>-<3 random digits>. */
export function defaultBookingId(now: Date): string {
  return `BK-${now.getUTCFullYear()}-${now.getTime()}-${String(randomInt(1000)).padStart(3, '0')}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Hash of everything that defines the booking, so a replayed key can be told
 * apart from a key reused for a different request. Candidate slots only
 * shape the slot_taken alternatives, so they are left out.
 */
export function requestFingerprint(req: ConfirmRequest): string {
  const { idempotencyKey: _key, candidateSlots: _slots, ...defining } = req;
  return createHash('sha256').update(stableStringify(defining)).digest('hex');
}

/** Postgres `timestamp without time zone` comes back without an offset; Supabase runs in UTC. */
function toIsoUtc(value: unknown, fallback: Date): string {
  if (typeof value !== 'string' || value === '') return fallback.toISOString();
  const hasZone = /(Z|[+-]\d{2}(:?\d{2})?)$/.test(value);
  const d = new Date(hasZone ? value : `${value}Z`);
  return Number.isNaN(d.getTime()) ? fallback.toISOString() : d.toISOString();
}

/** Fresh bookings and replays both build the receipt from the stored row, so they match exactly. */
function receiptFromRow(row: BookingRow, now: Date): Receipt {
  return buildReceipt({
    bookingId: row.booking_id,
    serviceType: row.service_type ?? '',
    providerId: row.provider_id ?? '',
    providerName: row.provider_name ?? '',
    bookingDate: row.booking_date ?? '',
    slot: normaliseSlot(row.slot) ?? String(row.slot),
    location: row.location ?? '',
    pricePkr: row.price_pkr ?? 0,
    userName: row.user_name ?? 'Guest User',
    userEmail: row.user_email ?? null,
    createdAt: toIsoUtc(row.created_at, now),
  });
}

function toNewBooking(req: ConfirmRequest, bookingId: string, now: Date, fingerprint: string | null): NewBooking {
  return {
    booking_id: bookingId,
    user_name: req.userName,
    user_email: req.userEmail,
    service_type: req.serviceType,
    provider_id: req.providerId,
    provider_name: req.providerName,
    location: req.location,
    slot: req.slot,
    booking_date: req.bookingDate,
    price_pkr: req.pricePkr,
    status: 'confirmed',
    created_at: now.toISOString(),
    idempotency_key: req.idempotencyKey,
    request_fingerprint: fingerprint,
    provider_rating: req.provider.rating,
    provider_review_count: req.provider.reviewCount,
    provider_address: req.provider.address,
    provider_distance_km: req.provider.distanceKm,
    provider_reputation_score: req.provider.reputationScore,
    provider_verified: req.provider.verified,
    provider_google_maps_url: req.provider.googleMapsUrl,
    provider_coordinates_lat: req.provider.lat,
    provider_coordinates_lng: req.provider.lng,
  };
}

// The project tsconfig is not strict, so `if (!v.ok)` does not narrow Validated<T>.
function invalid<T>(v: Validated<T>): HttpResult | null {
  if (v.ok) return null;
  const f = v as Extract<Validated<T>, { ok: false }>;
  return validationError(f.message, f.fields);
}

function valid<T>(v: Validated<T>): T {
  return (v as Extract<Validated<T>, { ok: true }>).value;
}

async function getSlots(body: unknown, deps: BookingDeps): Promise<HttpResult> {
  const v = validateGetSlots(body);
  const bad = invalid(v);
  if (bad) return bad;
  const req = valid(v);

  const block = serviceBlock(req.serviceType);
  const booked = (await deps.db.bookedSlots(req.providerId, [req.bookingDate])).get(req.bookingDate) ?? [];
  const slots = buildSlotList(req.candidateSlots, booked, block.totalBlockMins);
  const freeCount = slots.filter((s) => s.available).length;

  return ok({
    status: 'slots_ready',
    action: 'get_slots',
    provider_id: req.providerId,
    provider_name: req.providerName,
    service_type: req.serviceType,
    location: req.location,
    price_pkr: req.pricePkr,
    booking_date: req.bookingDate,
    availability_slots: req.candidateSlots,
    slots,
    free_count: freeCount,
    booked_count: booked.length,
    job_duration_mins: block.jobDurationMins,
    travel_buffer_mins: block.travelBufferMins,
    total_block_mins: block.totalBlockMins,
    message: freeCount === 0 ? 'Koi slot available nahi hai is date pe.' : `${freeCount} slot(s) available — slot chunein`,
    workflow: 'WF4-StepA',
  });
}

async function slotTaken(req: ConfirmRequest, block: ServiceBlock, deps: BookingDeps, log: Logger): Promise<HttpResult> {
  const now = deps.now();
  const today = pakistanDate(now);
  const dates = Array.from({ length: ALTERNATIVE_DAYS }, (_, i) => addDays(today, i + 1));
  let alternatives: AlternativeDate[] = [];
  try {
    const bookedByDate = await deps.db.bookedSlots(req.providerId, dates);
    alternatives = alternativeDates(today, bookedByDate, req.candidateSlots, block.totalBlockMins);
  } catch (err) {
    // The conflict itself is certain; missing suggestions should not turn it into a 503.
    log.warn('booking.alternatives_unavailable', { error: err });
  }
  return fail('slot_taken', SLOT_TAKEN_MESSAGE, {
    slot_requested: req.slot,
    provider_name: req.providerName,
    booking_date: req.bookingDate,
    action_required: 'get_slots',
    hint: 'Call get_slots again to see updated availability',
    alternative_dates: alternatives,
    waitlist: { available: true, message: 'Waitlist mein add kar dein? Slot khali hone par inform kar denge.' },
    workflow: 'WF4-SlotTakenFallback',
    timestamp: now.toISOString(),
  });
}

function replay(existing: BookingRow, fingerprint: string | null, deps: BookingDeps, log: Logger): HttpResult {
  if (existing.request_fingerprint !== fingerprint) {
    log.warn('booking.idempotency_key_reused');
    return fail('idempotency_key_reused', 'This idempotency_key was already used for a different booking request.');
  }
  log.info('booking.replayed', { booking_id: existing.booking_id });
  return ok(receiptFromRow(existing, deps.now()) as unknown as Record<string, unknown>);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`email send timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Best effort: the booking is already committed, so an email problem is logged, never returned. */
async function sendConfirmation(receipt: Receipt, deps: BookingDeps, log: Logger): Promise<void> {
  const message = confirmationEmail(receipt);
  if (!message) {
    log.info('booking.email_skipped', { booking_id: receipt.booking_id, reason: 'no_address' });
    return;
  }
  try {
    await withTimeout(Promise.resolve().then(() => deps.email.send(message)), deps.emailTimeoutMs ?? DEFAULT_EMAIL_TIMEOUT_MS);
    log.info('booking.email_sent', { booking_id: receipt.booking_id });
  } catch (err) {
    log.error('booking.email_failed', { booking_id: receipt.booking_id, to: message.to, error: err });
  }
}

async function confirm(body: unknown, deps: BookingDeps): Promise<HttpResult> {
  const v = validateConfirm(body);
  const bad = invalid(v);
  if (bad) return bad;
  const req = valid(v);
  const key = req.idempotencyKey;
  const fingerprint = key ? requestFingerprint(req) : null;
  const log = deps.log.child({
    action: 'confirm',
    provider_id: req.providerId,
    booking_date: req.bookingDate,
    slot: req.slot,
    idempotency_key_present: key !== null,
  });

  if (key) {
    const existing = await deps.db.findByIdempotencyKey(key);
    if (existing) return replay(existing, fingerprint, deps, log);
  }

  // Pre-check gives the friendly answer in the common case. The unique index
  // in the database is what actually stops two requests winning the same slot.
  const block = serviceBlock(req.serviceType);
  const booked = (await deps.db.bookedSlots(req.providerId, [req.bookingDate])).get(req.bookingDate) ?? [];
  const conflict = findConflict(req.slot, booked, block.totalBlockMins);
  if (conflict) {
    log.info('booking.slot_taken', { reason: 'precheck', conflict });
    return slotTaken(req, block, deps, log);
  }

  let row: BookingRow | undefined;
  for (let attempt = 0; row === undefined; attempt++) {
    const now = deps.now();
    const bookingId = deps.newBookingId(now);
    try {
      row = await deps.db.insert(toNewBooking(req, bookingId, now, fingerprint));
    } catch (err) {
      if (!(err instanceof BookingConflictError)) throw err;
      if (err.target === 'slot') {
        log.info('booking.slot_taken', { reason: 'unique_index', constraint: err.constraint });
        return slotTaken(req, block, deps, log);
      }
      if (err.target === 'idempotency_key' && key) {
        // A concurrent request with the same key won the insert.
        const existing = await deps.db.findByIdempotencyKey(key);
        if (existing) return replay(existing, fingerprint, deps, log);
      }
      if (err.target === 'booking_id' && attempt === 0) {
        log.warn('booking.id_collision', { booking_id: bookingId });
        continue;
      }
      throw err;
    }
  }

  const receipt = receiptFromRow(row, deps.now());
  log.info('booking.confirmed', { booking_id: receipt.booking_id });
  await sendConfirmation(receipt, deps, log);
  return ok(receipt as unknown as Record<string, unknown>);
}

/** Entry point for POST khadmat-booking. Never throws. */
export async function handleBookingRequest(body: unknown, deps: BookingDeps): Promise<HttpResult> {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const action = record.action === undefined || record.action === null || record.action === '' ? 'get_slots' : record.action;
  try {
    if (action === 'get_slots') return await getSlots(record, deps);
    if (action === 'confirm') return await confirm(record, deps);
    return validationError('Invalid fields: action (expected get_slots or confirm)', ['action']);
  } catch (err) {
    if (err instanceof RepositoryError && err.kind === 'unavailable') {
      deps.log.error('booking.db_unavailable', { action, error: err, http_status: err.httpStatus });
      return serviceUnavailable();
    }
    deps.log.error('booking.unhandled_error', {
      action,
      error: err,
      ...(err instanceof RepositoryError ? { http_status: err.httpStatus, pg_code: err.pgCode } : {}),
      ...(err instanceof BookingConflictError ? { constraint: err.constraint, pg_code: err.pgCode } : {}),
    });
    return internalError();
  }
}
