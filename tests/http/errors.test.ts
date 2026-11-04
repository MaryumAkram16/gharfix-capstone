import { describe, expect, it } from 'vitest';
import { fail, internalError, ok, serviceUnavailable, STATUS_FOR, validationError } from '../../lib/http/errors';

describe('http results', () => {
  it('ok is a 200 with the body untouched', () => {
    expect(ok({ status: 'confirmed', booking_id: 'BK-TEST-1' })).toEqual({
      status: 200,
      body: { status: 'confirmed', booking_id: 'BK-TEST-1' },
    });
  });

  it('maps each error code to its HTTP status', () => {
    expect(STATUS_FOR).toEqual({
      validation_error: 400,
      slot_taken: 409,
      idempotency_key_reused: 422,
      service_unavailable: 503,
      internal_error: 500,
    });
  });

  it('fail puts the code in body.status and extra fields cannot override it', () => {
    const result = fail('slot_taken', 'taken', { status: 'confirmed', slot_requested: '16:00' });
    expect(result.status).toBe(409);
    expect(result.body).toEqual({ status: 'slot_taken', message: 'taken', slot_requested: '16:00' });
  });

  it('builds validation, 503 and 500 bodies', () => {
    expect(validationError('Missing fields: slot', ['slot'])).toEqual({
      status: 400,
      body: { status: 'validation_error', message: 'Missing fields: slot', fields: ['slot'] },
    });
    expect(serviceUnavailable().status).toBe(503);
    expect(serviceUnavailable().body.retryable).toBe(true);
    expect(internalError()).toEqual({
      status: 500,
      body: { status: 'internal_error', message: 'Something went wrong. Please try again.' },
    });
  });
});
