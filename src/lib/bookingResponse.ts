// Turns a khadmat-booking HTTP response into what BookingView should show.
// Pure (no React, no fetch) so it is unit-tested against the real handler's
// responses in tests/frontend/bookingResponse.test.ts.
//
// Rules:
// - Read the body first, then decide. A 409 slot_taken or a 400 has a body
//   worth showing, so `response.ok` alone is not enough.
// - Never invent a booking id. Only a 2xx with status "confirmed" and a real
//   booking_id is a booking; anything else is an error.
// - `retryable` means "Try again" is safe. Retries reuse the same
//   idempotency key, so if the first attempt did go through the server
//   replays it instead of booking twice.

export interface ConfirmedReceipt {
  booking_id: string;
  status: 'confirmed';
  booking_status?: string;
  replayed?: boolean;
  [field: string]: unknown;
}

export interface AlternativeDate {
  date: string;
  label: string;
  slots: string[];
}

export type BookingOutcome =
  | { kind: 'confirmed'; receipt: ConfirmedReceipt }
  | { kind: 'slot_taken'; message: string; alternatives: AlternativeDate[] }
  | { kind: 'error'; message: string; retryable: boolean };

export const MESSAGES = {
  slotTaken: 'Yeh slot abhi available nahi.',
  unavailable: 'Booking service is busy right now. Please try again.',
  network: 'Network error. Please check your connection and try again.',
  unexpected: 'We could not confirm your booking. Please try again.',
  invalid: 'Some booking details are missing or invalid. Please go back and check them.',
  keyReused: 'This booking request changed while it was being sent. Please go back and book again.',
} as const;

function parse(text: string): unknown {
  if (text.trim() === '') return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    // n8n sometimes wrapped the body in a one-element array.
    return Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function message(body: Record<string, unknown> | null, fallback: string): string {
  const m = body?.message;
  return typeof m === 'string' && m.trim() !== '' ? m : fallback;
}

export function interpretBookingResponse(httpStatus: number, text: string): BookingOutcome {
  const body = record(parse(text));
  const status = body?.status;
  const ok = httpStatus >= 200 && httpStatus < 300;

  if (status === 'slot_taken') {
    const alternatives = Array.isArray(body!.alternative_dates) ? (body!.alternative_dates as AlternativeDate[]) : [];
    return { kind: 'slot_taken', message: message(body, MESSAGES.slotTaken), alternatives };
  }

  if (ok && status === 'confirmed' && typeof body!.booking_id === 'string' && body!.booking_id.trim() !== '') {
    return { kind: 'confirmed', receipt: body as ConfirmedReceipt };
  }

  if (status === 'validation_error' || status === 'payload_too_large') {
    return { kind: 'error', message: message(body, MESSAGES.invalid), retryable: false };
  }
  if (status === 'idempotency_key_reused') {
    return { kind: 'error', message: MESSAGES.keyReused, retryable: false };
  }
  if (status === 'service_unavailable' || httpStatus >= 500 || httpStatus === 408 || httpStatus === 429) {
    return { kind: 'error', message: message(body, MESSAGES.unavailable), retryable: true };
  }
  if (httpStatus >= 400) {
    return { kind: 'error', message: message(body, MESSAGES.unexpected), retryable: false };
  }
  // A 2xx we cannot read as a booking: empty, not JSON, or no booking_id.
  // The booking may or may not exist, and retrying with the same key finds out.
  return { kind: 'error', message: MESSAGES.unexpected, retryable: true };
}

/** fetch() itself failed (offline, DNS, aborted). Retrying with the same key is safe. */
export function networkFailure(): BookingOutcome {
  return { kind: 'error', message: MESSAGES.network, retryable: true };
}

/**
 * A key for one booking attempt; reuse it for every retry of that attempt.
 * crypto.randomUUID only exists in secure contexts (https, localhost), so
 * plain-http dev on a LAN address falls back to getRandomValues.
 */
export function newIdempotencyKey(cryptoImpl: Pick<Crypto, 'getRandomValues'> & Partial<Pick<Crypto, 'randomUUID'>> = globalThis.crypto): string {
  if (typeof cryptoImpl.randomUUID === 'function') return cryptoImpl.randomUUID();
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
