import { describe, expect, it, vi } from 'vitest';
import { BookingConflictError, CONSTRAINTS, RepositoryError, type NewBooking } from '../../lib/booking/repository';
import { IntentParserError } from '../../lib/intent/types';
import { guarded, resilientCapacity, resilientDirectory, resilientEmail, resilientGeocoder, resilientParser, resilientRepository, type GuardContext } from '../../lib/resilience/guard';
import { MapsUnavailableError } from '../../lib/matching/directory';
import { errorClass, payloadHash } from '../../lib/resilience/incidents';
import { isTransient, NO_RETRY, SUPABASE_READ } from '../../lib/resilience/policies';
import { FakeBookingDb } from '../fakes/bookingDb';
import { recorderKit } from '../fakes/resilience';

const down = () => new RepositoryError('unavailable', 'Supabase GET failed with HTTP 503', 503);

function ctxFor(kit: ReturnType<typeof recorderKit>, workflow = 'khadmat-booking'): GuardContext & { waits: number[] } {
  const waits: number[] = [];
  return { workflow, requestId: 'req-1', recorder: kit.recorder, sleep: async (ms) => { waits.push(ms); }, waits };
}

const newRow = (over: Partial<NewBooking> = {}): NewBooking => ({
  booking_id: 'BK-TEST-0001', user_name: 'Test User', user_email: 'booking-test@example.test', service_type: 'plumber',
  provider_id: 'osm:node/1', provider_name: 'P', location: 'G-13', slot: '16:00', booking_date: '2026-11-10', price_pkr: 900,
  status: 'confirmed', created_at: '2026-11-04T09:00:00.000Z', idempotency_key: null, request_fingerprint: null,
  provider_rating: null, provider_review_count: null, provider_address: '', provider_distance_km: null,
  provider_reputation_score: null, provider_verified: false, provider_google_maps_url: '', provider_coordinates_lat: null,
  provider_coordinates_lng: null, ...over,
});

describe('guarded', () => {
  it('a retry that succeeds on the second attempt records auto_fixed, and sends no alert', async () => {
    const kit = recorderKit();
    const ctx = ctxFor(kit);
    const fn = vi.fn().mockRejectedValueOnce(down()).mockResolvedValueOnce(['16:00']);

    await expect(guarded(ctx, 'supabase.bookedSlots', SUPABASE_READ, fn)).resolves.toEqual(['16:00']);

    expect(fn).toHaveBeenCalledTimes(2);
    expect(ctx.waits).toEqual([250]);
    expect(kit.store.rows).toEqual([expect.objectContaining({
      workflow: 'khadmat-booking', step: 'supabase.bookedSlots', error_class: 'RepositoryError:unavailable:503',
      retryable: true, auto_fixed: true, request_id: 'req-1',
      payload_hash: payloadHash('khadmat-booking', 'supabase.bookedSlots', 'RepositoryError:unavailable:503'),
    })]);
    expect(kit.alerts.sent).toEqual([]);
    expect(kit.log.records.find((r) => r.event === 'incident.recorded')).toMatchObject({ level: 'info', auto_fixed: true });
  });

  it('a non-retryable error is tried once, recorded, alerted, and rethrown unchanged', async () => {
    const kit = recorderKit();
    const ctx = ctxFor(kit);
    const badKey = new RepositoryError('unexpected', 'Supabase GET failed with HTTP 401', 401);
    const fn = vi.fn().mockRejectedValue(badKey);

    await expect(guarded(ctx, 'supabase.bookedSlots', SUPABASE_READ, fn)).rejects.toBe(badKey);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(ctx.waits).toEqual([]);
    expect(kit.store.rows).toEqual([expect.objectContaining({ error_class: 'RepositoryError:unexpected:401', retryable: false, auto_fixed: false })]);
    expect(kit.alerts.sent).toHaveLength(1);
    expect(kit.alerts.sent[0].text).toContain('Supabase rejected the key. Check SUPABASE_SERVICE_ROLE_KEY');
  });

  it('records a final failure after all retries, with what was tried', async () => {
    const kit = recorderKit();
    const fn = vi.fn().mockRejectedValue(down());
    await expect(guarded(ctxFor(kit), 'supabase.bookedSlots', SUPABASE_READ, fn)).rejects.toBeInstanceOf(RepositoryError);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(kit.store.rows).toEqual([expect.objectContaining({ retryable: true, auto_fixed: false })]);
    expect(kit.alerts.sent[0].text).toContain('What was tried: Tried 3 times, waiting 250 ms then 750 ms between tries.');
  });

  it('expected outcomes (slot taken) are not incidents', async () => {
    const kit = recorderKit();
    const taken = new BookingConflictError('slot', CONSTRAINTS.slot, '23505');
    await expect(guarded(ctxFor(kit), 'supabase.insert', NO_RETRY, async () => { throw taken; })).rejects.toBe(taken);
    expect(kit.store.rows).toEqual([]);
    expect(kit.alerts.sent).toEqual([]);
  });
});

describe('resilientRepository: only safe operations are retried', () => {
  function setup() {
    const kit = recorderKit();
    const db = new FakeBookingDb();
    const ctx = ctxFor(kit);
    return { kit, db, ctx, repo: resilientRepository(db, ctx) };
  }

  it('retries reads', async () => {
    const { db, repo, kit } = setup();
    let n = 0;
    db.failWhen = (op) => op === 'bookedSlots' && ++n === 1;
    await repo.bookedSlots('p', ['2026-11-10']);
    expect(db.calls).toEqual(['bookedSlots', 'bookedSlots']);
    expect(kit.store.rows[0]).toMatchObject({ step: 'supabase.bookedSlots', auto_fixed: true });
  });

  it('never retries an insert without an idempotency key', async () => {
    const { db, repo, kit } = setup();
    db.failWhen = (op) => op === 'insert';
    await expect(repo.insert(newRow())).rejects.toBeInstanceOf(RepositoryError);
    expect(db.calls).toEqual(['insert']);
    expect(kit.store.rows).toEqual([expect.objectContaining({ step: 'supabase.insert', retryable: true, auto_fixed: false })]);
    expect(kit.alerts.sent[0].text).toContain('Not retried: repeating this call could act twice');
  });

  it('retries an insert that carries an idempotency key', async () => {
    const { db, repo, kit } = setup();
    let n = 0;
    db.failWhen = (op) => op === 'insert' && ++n === 1;
    const row = await repo.insert(newRow({ idempotency_key: 'idem-test-retry-01' }));
    expect(row.booking_id).toBe('BK-TEST-0001');
    expect(db.calls).toEqual(['insert', 'insert']);
    expect(db.rows).toHaveLength(1);
    expect(kit.store.rows[0]).toMatchObject({ step: 'supabase.insert', auto_fixed: true });
  });

  it('a keyed retry after an unclear failure ends in a unique-key conflict, not a second row', async () => {
    const { db, repo, kit } = setup();
    // Attempt 1 "times out" although the row was written; attempt 2 hits the key's unique index.
    let n = 0;
    db.beforeInsert = null;
    const insert = db.insert.bind(db);
    db.insert = async (row) => {
      n++;
      if (n === 1) { db.insertNow(row); throw new RepositoryError('unavailable', 'Supabase POST timed out'); }
      return insert(row);
    };
    // The repeat carries the same booking_id, whose unique index Postgres checks first (as the fake does).
    // The handler then retries with a new id, hits the idempotency key and replays: tests/resilience/booking.test.ts.
    const err = await repo.insert(newRow({ idempotency_key: 'idem-test-retry-02' })).catch((e) => e);
    expect(err).toBeInstanceOf(BookingConflictError);
    expect(err.target).toBe('booking_id');
    expect(db.rows).toHaveLength(1);
    expect(kit.store.rows).toEqual([expect.objectContaining({ step: 'supabase.insert', auto_fixed: true })]);
  });

  it('never retries markConfirmationSent (a write)', async () => {
    const { db, repo } = setup();
    db.failWhen = (op) => op === 'markConfirmationSent';
    await expect(repo.markConfirmationSent('BK-TEST-0001', new Date())).rejects.toBeInstanceOf(RepositoryError);
    expect(db.calls).toEqual(['markConfirmationSent']);
  });

  it('retries the capacity read', async () => {
    const kit = recorderKit();
    const read = vi.fn().mockRejectedValueOnce(down()).mockResolvedValueOnce(new Map());
    await resilientCapacity({ activeBookingCounts: read }, ctxFor(kit, 'khadmat-provider-match')).activeBookingCounts('2026-11-04', ['a']);
    expect(read).toHaveBeenCalledTimes(2);
    expect(kit.store.rows[0]).toMatchObject({ workflow: 'khadmat-provider-match', auto_fixed: true });
  });
});

describe('resilientParser (Gemini)', () => {
  const intent = { services: ['plumber'] } as never;
  it.each([
    ['503 is retried', new IntentParserError('unavailable', 'Gemini answered HTTP 503', 503), 2],
    ['429 is retried', new IntentParserError('unavailable', 'Gemini answered HTTP 429', 429), 2],
    ['a timeout is not retried (it already used the time budget)', new IntentParserError('unavailable', 'Gemini timed out', null, true), 1],
    ['a bad key is not retried', new IntentParserError('config', 'Gemini answered HTTP 403', 403), 1],
    ['invalid output is not retried', new IntentParserError('invalid_output', 'Gemini output failed validation: urgency'), 1],
  ])('%s', async (_l, err, calls) => {
    const kit = recorderKit();
    const parse = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce(intent);
    const parser = resilientParser({ name: 'gemini', parse }, ctxFor(kit, 'khadmat-intent'));
    const result = await parser.parse('plumber').catch((e) => e);
    expect(parse).toHaveBeenCalledTimes(calls);
    if (calls === 2) {
      expect(result).toBe(intent);
      expect(kit.store.rows[0]).toMatchObject({ step: 'gemini.parse', auto_fixed: true });
    } else {
      expect(result).toBe(err);
      expect(kit.store.rows[0]).toMatchObject({ step: 'gemini.parse', auto_fixed: false });
    }
  });

  it('a prompt Gemini refuses is not an incident', async () => {
    const kit = recorderKit();
    const parser = resilientParser({ name: 'gemini', parse: async () => { throw new IntentParserError('blocked', 'Gemini blocked the prompt (SAFETY)'); } }, ctxFor(kit));
    await expect(parser.parse('x')).rejects.toBeInstanceOf(IntentParserError);
    expect(kit.store.rows).toEqual([]);
  });
});

describe('resilientEmail (SMTP)', () => {
  const message = { to: 'booking-test@example.test', subject: 's', html: '<p>h</p>', text: 't' };

  it('is never retried; a failure is recorded and rethrown', async () => {
    const kit = recorderKit();
    const send = vi.fn().mockRejectedValue(Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' }));
    await expect(resilientEmail({ send }, ctxFor(kit), 1000).send(message)).rejects.toThrow('Connection timeout');
    expect(send).toHaveBeenCalledTimes(1);
    expect(kit.store.rows[0]).toMatchObject({ step: 'smtp.send', error_class: 'Error:ETIMEDOUT', retryable: true, auto_fixed: false });
  });

  it('records a hanging SMTP server as a timeout', async () => {
    const kit = recorderKit();
    await expect(resilientEmail({ send: () => new Promise(() => {}) }, ctxFor(kit), 30).send(message)).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(kit.store.rows[0]).toMatchObject({ step: 'smtp.send', error_class: 'TimeoutError', retryable: true });
  });

  it('keeps logsOnly so a console "send" is still not counted as sent', () => {
    const kit = recorderKit();
    expect(resilientEmail({ logsOnly: true, send: async () => {} }, ctxFor(kit), 1000).logsOnly).toBe(true);
  });
});

describe('errorClass / payloadHash / isTransient', () => {
  it('classifies without free text', () => {
    expect(errorClass(new RepositoryError('unexpected', 'x', 400, '42703'))).toBe('RepositoryError:unexpected:400');
    expect(errorClass(new RepositoryError('unavailable', 'x'))).toBe('RepositoryError:unavailable');
    expect(errorClass(new IntentParserError('unavailable', 'Gemini timed out', null, true))).toBe('IntentParserError:unavailable:timeout');
    expect(errorClass(Object.assign(new Error('535 bad login for someone@example.test'), { code: 'EAUTH', responseCode: 535 }))).toBe('Error:EAUTH:535');
    expect(errorClass('boom')).toBe('Unknown');
  });

  it('hashes the failure identity, the same for every request', () => {
    expect(payloadHash('w', 's', 'e')).toBe(payloadHash('w', 's', 'e'));
    expect(payloadHash('w', 's', 'e')).not.toBe(payloadHash('w', 's', 'e2'));
    expect(payloadHash('w', 's', 'e')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('tells temporary errors from permanent ones', () => {
    expect(isTransient(down())).toBe(true);
    expect(isTransient(new RepositoryError('unexpected', 'x', 401))).toBe(false);
    expect(isTransient(Object.assign(new Error('t'), { name: 'TimeoutError' }))).toBe(true);
    expect(isTransient(Object.assign(new Error('auth'), { code: 'EAUTH' }))).toBe(false);
  });
});

describe('resilientDirectory / resilientGeocoder (OpenStreetMap)', () => {
  it('records a directory failure as an incident, without retrying (mirrors are tried inside)', async () => {
    const kit = recorderKit();
    const search = vi.fn().mockRejectedValue(new MapsUnavailableError('directory', 'directory timed out (2 Overpass instance(s) tried)', null, true));
    const dir = resilientDirectory({ searchNearby: search }, ctxFor(kit, 'khadmat-provider-match'));
    await expect(dir.searchNearby({ services: ['plumber'], center: { lat: 0, lng: 0 }, radiusM: 5000, limit: 20 })).rejects.toBeInstanceOf(MapsUnavailableError);
    expect(search).toHaveBeenCalledTimes(1);
    expect(kit.store.rows).toEqual([expect.objectContaining({
      workflow: 'khadmat-provider-match', step: 'osm.searchNearby', error_class: 'MapsUnavailableError:directory:timeout', retryable: true, auto_fixed: false,
    })]);
    expect(kit.alerts.sent[0].text).toMatch(/What you need to do: The public OpenStreetMap servers were slow or unreachable/);
    expect(kit.alerts.sent[0].subject).toBe('[GharFix alert] khadmat-provider-match: searching OpenStreetMap (Overpass) for nearby providers failed');
  });

  it('records a geocoder failure too', async () => {
    const kit = recorderKit();
    const geo = resilientGeocoder({ geocode: async () => { throw new MapsUnavailableError('geocoder', 'geocoder answered HTTP 429', 429); } }, ctxFor(kit));
    await expect(geo.geocode('G-13')).rejects.toBeInstanceOf(MapsUnavailableError);
    expect(kit.store.rows[0]).toMatchObject({ step: 'osm.geocode', error_class: 'MapsUnavailableError:geocoder:429' });
  });

  it('passes successes through untouched', async () => {
    const kit = recorderKit();
    const geo = resilientGeocoder({ geocode: async () => null }, ctxFor(kit));
    expect(await geo.geocode('Atlantis')).toBeNull();
    expect(kit.store.rows).toEqual([]);
  });
});
