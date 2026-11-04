import { describe, expect, it } from 'vitest';
import { createLogger, maskEmails, memoryLogger, redact, type LogRecord } from '../lib/log';

describe('redact', () => {
  it('replaces values whose key looks like a secret, at any depth', () => {
    expect(
      redact({
        apikey: 'abc',
        headers: { Authorization: 'Bearer abc', 'Content-Type': 'application/json' },
        nested: [{ service_role_key: 'abc' }],
        idempotency_key_present: true,
      }),
    ).toEqual({
      apikey: '[redacted]',
      headers: { Authorization: '[redacted]', 'Content-Type': 'application/json' },
      nested: [{ service_role_key: '[redacted]' }],
      idempotency_key_present: true,
    });
  });

  it('masks email addresses inside any string, including error messages', () => {
    expect(maskEmails('sent to booking-test@example.test ok')).toBe('sent to b***@example.test ok');
    expect(redact(new Error('550 rejected booking-test@example.test'))).toEqual({
      name: 'Error',
      message: '550 rejected b***@example.test',
    });
  });
});

describe('createLogger', () => {
  it('writes one record per call with level, event, time and base fields', () => {
    const records: LogRecord[] = [];
    const log = createLogger({ fn: 'khadmat-booking' }, (r) => records.push(r), () => new Date('2026-11-04T00:00:00Z'));
    log.child({ request_id: 'r1' }).warn('booking.email_failed', { to: 'booking-test@example.test' });
    expect(records).toEqual([
      {
        fn: 'khadmat-booking',
        request_id: 'r1',
        to: 'b***@example.test',
        level: 'warn',
        event: 'booking.email_failed',
        time: '2026-11-04T00:00:00.000Z',
      },
    ]);
  });

  it('memoryLogger collects records for assertions', () => {
    const log = memoryLogger();
    log.info('a');
    log.error('b', { token: 'x' });
    expect(log.records.map((r) => [r.level, r.event, r.token])).toEqual([
      ['info', 'a', undefined],
      ['error', 'b', '[redacted]'],
    ]);
  });
});
