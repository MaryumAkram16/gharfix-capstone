import { DEFAULT_SLOTS } from './schedule';
import { normaliseSlot } from './slot';

export type Validated<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; fields: string[] };

export interface GetSlotsRequest {
  providerId: string;
  bookingDate: string;
  serviceType?: string;
  providerName?: string;
  location?: string;
  pricePkr: number;
  candidateSlots: string[];
}

export interface ProviderDetails {
  rating: number | null;
  reviewCount: number | null;
  address: string;
  distanceKm: number | null;
  reputationScore: number | null;
  verified: boolean;
  googleMapsUrl: string;
  lat: number | null;
  lng: number | null;
}

export interface ConfirmRequest {
  providerId: string;
  providerName: string;
  serviceType: string;
  location: string;
  pricePkr: number;
  slot: string;
  bookingDate: string;
  userName: string;
  userEmail: string | null;
  idempotencyKey: string | null;
  candidateSlots: string[];
  provider: ProviderDetails;
}

const MAX_TEXT = 500;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function text(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Collects missing and invalid fields so one response lists every problem. */
class Problems {
  missing: string[] = [];
  invalid: string[] = [];

  result<T>(value: T): Validated<T> {
    if (this.missing.length === 0 && this.invalid.length === 0) return { ok: true, value };
    const parts: string[] = [];
    if (this.missing.length) parts.push(`Missing fields: ${this.missing.join(', ')}`);
    if (this.invalid.length) parts.push(`Invalid fields: ${this.invalid.join(', ')}`);
    return { ok: false, message: parts.join('. '), fields: [...this.missing, ...this.invalid] };
  }

  /** Required, non-empty, at most MAX_TEXT characters. */
  requiredText(body: Record<string, unknown>, field: string, value: unknown = body[field]): string {
    const t = text(value);
    if (t === undefined) this.missing.push(field);
    else if (t.length > MAX_TEXT) this.invalid.push(field);
    return t ?? '';
  }

  optionalText(field: string, value: unknown): string | undefined {
    const t = text(value);
    if (t !== undefined && t.length > MAX_TEXT) {
      this.invalid.push(field);
      return undefined;
    }
    return t;
  }

  bookingDate(body: Record<string, unknown>): string {
    if (text(body.booking_date) === undefined) this.missing.push('booking_date');
    else if (!isValidDate(body.booking_date)) this.invalid.push('booking_date');
    return typeof body.booking_date === 'string' ? body.booking_date : '';
  }

  /** price_pkr as WF4 read it (parseInt), but negative or non-numeric values are rejected. */
  price(body: Record<string, unknown>, required: boolean): number {
    const raw = body.price_pkr;
    if (raw === undefined || raw === null || raw === '') {
      if (required) this.missing.push('price_pkr');
      return 0;
    }
    const n = typeof raw === 'number' ? Math.trunc(raw) : parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n < 0) {
      this.invalid.push('price_pkr');
      return 0;
    }
    return n;
  }

  /** availability_slots normalised to HH:MM, de-duplicated; DEFAULT_SLOTS when absent. */
  candidateSlots(body: Record<string, unknown>): string[] {
    const raw = body.availability_slots;
    if (raw === undefined || raw === null) return DEFAULT_SLOTS;
    if (!Array.isArray(raw) || raw.length === 0) {
      this.invalid.push('availability_slots');
      return DEFAULT_SLOTS;
    }
    const slots = raw.map(normaliseSlot);
    if (slots.some((s) => s === null)) {
      this.invalid.push('availability_slots');
      return DEFAULT_SLOTS;
    }
    return [...new Set(slots as string[])];
  }
}

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

export function validateGetSlots(input: unknown): Validated<GetSlotsRequest> {
  const body = asRecord(input);
  const p = new Problems();
  const providerId = p.requiredText(body, 'provider_id', body.place_id ?? body.provider_id);
  const bookingDate = p.bookingDate(body);
  const value: GetSlotsRequest = {
    providerId,
    bookingDate,
    serviceType: p.optionalText('service_type', body.service_type),
    providerName: p.optionalText('provider_name', body.provider_name),
    location: p.optionalText('location', body.location),
    pricePkr: p.price(body, false),
    candidateSlots: p.candidateSlots(body),
  };
  return p.result(value);
}

export function validateConfirm(input: unknown): Validated<ConfirmRequest> {
  const body = asRecord(input);
  const p = new Problems();

  const providerId = p.requiredText(body, 'provider_id', body.provider_id ?? body.place_id);
  const providerName = p.requiredText(body, 'provider_name');
  const serviceType = p.requiredText(body, 'service_type');
  const location = p.requiredText(body, 'location');
  const pricePkr = p.price(body, true);

  let slot = '';
  if (text(body.slot) === undefined) {
    p.missing.push('slot');
  } else {
    const normalised = normaliseSlot(body.slot);
    if (normalised === null) p.invalid.push('slot');
    else slot = normalised;
  }

  const bookingDate = p.bookingDate(body);

  let userEmail: string | null = p.optionalText('user_email', body.user_email) ?? null;
  if (userEmail !== null && !/^[^\s@]+@[^\s@]+$/.test(userEmail)) {
    p.invalid.push('user_email');
    userEmail = null;
  }

  let idempotencyKey: string | null = null;
  if (body.idempotency_key !== undefined && body.idempotency_key !== null) {
    if (typeof body.idempotency_key === 'string' && IDEMPOTENCY_KEY_PATTERN.test(body.idempotency_key)) {
      idempotencyKey = body.idempotency_key;
    } else {
      p.invalid.push('idempotency_key');
    }
  }

  const coords = asRecord(body.coordinates);
  const value: ConfirmRequest = {
    providerId,
    providerName,
    serviceType,
    location,
    pricePkr,
    slot,
    bookingDate,
    userName: p.optionalText('user_name', body.user_name) ?? 'Guest User',
    userEmail,
    idempotencyKey,
    candidateSlots: p.candidateSlots(body),
    provider: {
      rating: numberOrNull(body.rating ?? body.provider_rating),
      reviewCount: numberOrNull(body.review_count ?? body.provider_review_count),
      address: p.optionalText('address', body.address ?? body.provider_address) ?? '',
      distanceKm: numberOrNull(body.distance_km ?? body.provider_distance_km),
      reputationScore: numberOrNull(body.reputation_score ?? body.provider_reputation_score),
      verified: body.verified === true,
      googleMapsUrl: p.optionalText('google_maps_url', body.google_maps_url ?? body.provider_google_maps_url) ?? '',
      lat: numberOrNull(coords.lat),
      lng: numberOrNull(coords.lng),
    },
  };
  return p.result(value);
}
