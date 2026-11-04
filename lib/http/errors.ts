// HTTP results for the Vercel functions. Handlers in lib/ return an HttpResult
// instead of touching a response object, so they can be tested directly.
//
// Bodies keep the n8n convention: a string `status` field the frontend
// switches on ("confirmed", "slot_taken", "validation_error", ...). The HTTP
// status code is new: n8n answered 200 for everything.

export interface HttpResult<B = Record<string, unknown>> {
  status: number;
  body: B;
}

export type ErrorCode =
  | 'validation_error'
  | 'payload_too_large'
  | 'slot_taken'
  | 'idempotency_key_reused'
  | 'service_unavailable'
  | 'internal_error';

/** One place that decides the HTTP status code for each error. */
export const STATUS_FOR: Record<ErrorCode, number> = {
  validation_error: 400,
  payload_too_large: 413,
  slot_taken: 409,
  idempotency_key_reused: 422,
  service_unavailable: 503,
  internal_error: 500,
};

export function ok<B extends Record<string, unknown>>(body: B): HttpResult<B> {
  return { status: 200, body };
}

/** An error response: `{ status: code, message, ...extra }` with the matching HTTP status. */
export function fail(code: ErrorCode, message: string, extra: Record<string, unknown> = {}): HttpResult {
  return { status: STATUS_FOR[code], body: { ...extra, status: code, message } };
}

export function validationError(message: string, fields: string[]): HttpResult {
  return fail('validation_error', message, { fields });
}

export function serviceUnavailable(): HttpResult {
  return fail('service_unavailable', 'Booking service is temporarily unavailable. Please try again in a minute.', {
    retryable: true,
  });
}

/** Generic 500. Never put the underlying error text in the body. */
export function internalError(): HttpResult {
  return fail('internal_error', 'Something went wrong. Please try again.');
}
