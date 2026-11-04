import { describe, expect, it } from 'vitest';
import { memoryLogger } from '../../lib/log';
import {
  BookingConflictError, createSupabaseRepository, pgIn, RepositoryError, supabaseConfigFromEnv,
  type NewBooking, type SupabaseConfig,
} from '../../lib/booking/repository';

// Not a real key: the repository must pass it through headers and nowhere else.
const FAKE_KEY = 'test-service-role-key-not-real';
const config: SupabaseConfig = { url: 'https://project.supabase.test', serviceRoleKey: FAKE_KEY, timeoutMs: 1000 };

interface Call { url: URL; init: RequestInit }

function fakeFetch(...responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const impl = async (input: string, init: RequestInit) => {
    calls.push({ url: new URL(input), init });
    const next = responses.shift();
    if (!next) throw new Error('no more fake responses');
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, impl };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const newBooking: NewBooking = {
  booking_id: 'BK-TEST-0001',
  user_name: 'Test User',
  user_email: 'booking-test@example.test',
  service_type: 'AC Repair',
  provider_id: 'ChIJ-test-provider',
  provider_name: 'Ali "AC" Services',
  location: 'DHA Phase 5, Lahore',
  slot: '16:00',
  booking_date: '2026-11-10',
  price_pkr: 2500,
  status: 'confirmed',
  created_at: '2026-11-04T09:00:00.000Z',
  idempotency_key: 'idem-key-0001',
  request_fingerprint: 'abc',
  provider_rating: 4.5,
  provider_review_count: 10,
  provider_address: '',
  provider_distance_km: null,
  provider_reputation_score: null,
  provider_verified: false,
  provider_google_maps_url: '',
  provider_coordinates_lat: null,
  provider_coordinates_lng: null,
};

describe('supabaseConfigFromEnv', () => {
  it('reads url, service-role key and timeout', () => {
    expect(
      supabaseConfigFromEnv({ SUPABASE_URL: 'https://x.supabase.test', SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY, SUPABASE_TIMEOUT_MS: '2500' }),
    ).toEqual({ url: 'https://x.supabase.test', serviceRoleKey: FAKE_KEY, timeoutMs: 2500 });
  });

  it('names missing variables without echoing any value', () => {
    expect(() => supabaseConfigFromEnv({ SUPABASE_URL: 'https://x.supabase.test' })).toThrow(
      'Missing environment variable(s): SUPABASE_SERVICE_ROLE_KEY',
    );
    expect(() => supabaseConfigFromEnv({ SUPABASE_URL: 'not a url', SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY })).toThrow(
      /^SUPABASE_URL is not a valid URL$/,
    );
  });
});

describe('pgIn', () => {
  it('quotes and escapes every value', () => {
    expect(pgIn(['confirmed', 'in_progress'])).toBe('in.("confirmed","in_progress")');
    expect(pgIn(['a,b)', 'c"d\\'])).toBe('in.("a,b)","c\\"d\\\\")');
  });
});

describe('bookedSlots', () => {
  it('queries with URLSearchParams and the service-role key in headers only', async () => {
    const f = fakeFetch(json(200, []));
    const repo = createSupabaseRepository(config, { fetch: f.impl });
    await repo.bookedSlots('id&status=eq.cancelled', ['2026-11-10']);

    const { url, init } = f.calls[0];
    expect(url.pathname).toBe('/rest/v1/bookings');
    // The hostile provider id stays inside its own parameter.
    expect(url.searchParams.get('provider_id')).toBe('eq.id&status=eq.cancelled');
    expect(url.searchParams.getAll('status')).toEqual(['in.("confirmed","in_progress")']);
    expect(url.searchParams.get('booking_date')).toBe('eq.2026-11-10');
    expect(url.toString()).not.toContain(FAKE_KEY);
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({ apikey: FAKE_KEY, Authorization: `Bearer ${FAKE_KEY}` });
  });

  it('groups slots by date, normalises old "4:00 PM" rows and skips unreadable ones', async () => {
    const log = memoryLogger();
    const f = fakeFetch(
      json(200, [
        { slot: '4:00 PM', booking_date: '2026-11-10' },
        { slot: '09:00', booking_date: '2026-11-11' },
        { slot: 'evening', booking_date: '2026-11-11' },
      ]),
    );
    const repo = createSupabaseRepository(config, { fetch: f.impl, log });
    const slots = await repo.bookedSlots('p1', ['2026-11-10', '2026-11-11', '2026-11-12']);

    expect(f.calls[0].url.searchParams.get('booking_date')).toBe('in.("2026-11-10","2026-11-11","2026-11-12")');
    expect([...slots]).toEqual([
      ['2026-11-10', ['16:00']],
      ['2026-11-11', ['09:00']],
      ['2026-11-12', []],
    ]);
    expect(log.records.map((r) => r.event)).toEqual(['booking.unparseable_slot']);
  });
});

describe('findByIdempotencyKey', () => {
  it('returns the first row or null', async () => {
    const f = fakeFetch(json(200, [{ booking_id: 'BK-TEST-0001' }]), json(200, []));
    const repo = createSupabaseRepository(config, { fetch: f.impl });
    expect(await repo.findByIdempotencyKey('idem-key-0001')).toEqual({ booking_id: 'BK-TEST-0001' });
    expect(await repo.findByIdempotencyKey('idem-key-0002')).toBeNull();
    expect(f.calls[0].url.searchParams.get('idempotency_key')).toBe('eq.idem-key-0001');
  });
});

describe('insert', () => {
  it('POSTs a JSON.stringify body and asks for the row back', async () => {
    const f = fakeFetch(json(201, [newBooking]));
    const repo = createSupabaseRepository(config, { fetch: f.impl });
    expect(await repo.insert(newBooking)).toEqual(newBooking);

    const { init } = f.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Prefer: 'return=representation' });
    expect(JSON.parse(init.body as string)).toEqual(newBooking);
  });

  it.each([
    ['bookings_active_slot_key', 'slot'],
    ['bookings_idempotency_key_key', 'idempotency_key'],
    ['bookings_booking_id_key', 'booking_id'],
    ['some_other_key', 'unknown'],
  ])('maps 23505 on %s to a %s conflict', async (constraint, target) => {
    const f = fakeFetch(
      json(409, { code: '23505', message: `duplicate key value violates unique constraint "${constraint}"`, details: null }),
    );
    const repo = createSupabaseRepository(config, { fetch: f.impl });
    const err = await repo.insert(newBooking).catch((e) => e);
    expect(err).toBeInstanceOf(BookingConflictError);
    expect(err).toMatchObject({ target, constraint, pgCode: '23505' });
  });

  it('maps an exclusion violation (23P01) to a slot conflict', async () => {
    const f = fakeFetch(json(409, { code: '23P01', message: 'conflicting key value violates exclusion constraint "x"' }));
    const err = await createSupabaseRepository(config, { fetch: f.impl }).insert(newBooking).catch((e) => e);
    expect(err).toMatchObject({ name: 'BookingConflictError', target: 'slot' });
  });
});

describe('activeBookingCounts', () => {
  it('counts active bookings per provider for one date', async () => {
    const f = fakeFetch(json(200, [{ provider_id: 'osm:node/1' }, { provider_id: 'osm:node/1' }, { provider_id: 'osm:way/2' }]));
    const repo = createSupabaseRepository(config, { fetch: f.impl });
    const counts = await repo.activeBookingCounts('2026-11-04', ['osm:node/1', 'osm:way/2', 'osm:node/3']);

    expect([...counts]).toEqual([['osm:node/1', 2], ['osm:way/2', 1]]);
    const params = f.calls[0].url.searchParams;
    expect(params.get('booking_date')).toBe('eq.2026-11-04');
    expect(params.get('status')).toBe('in.("confirmed","in_progress")');
    expect(params.get('provider_id')).toBe('in.("osm:node/1","osm:way/2","osm:node/3")');
    expect(params.get('select')).toBe('provider_id');
  });

  it('makes no request for an empty list', async () => {
    const f = fakeFetch();
    expect((await createSupabaseRepository(config, { fetch: f.impl }).activeBookingCounts('2026-11-04', [])).size).toBe(0);
    expect(f.calls).toHaveLength(0);
  });
});

describe('failures', () => {
  const cases: Array<[string, Response | Error, 'unavailable' | 'unexpected']> = [
    ['network error', new TypeError('fetch failed'), 'unavailable'],
    ['timeout', Object.assign(new Error('timed out'), { name: 'TimeoutError' }), 'unavailable'],
    ['502 html from a gateway', new Response('<html>Bad gateway</html>', { status: 502 }), 'unavailable'],
    ['503', json(503, { code: 'PGRST000', message: 'Could not connect' }), 'unavailable'],
    ['429', json(429, {}), 'unavailable'],
    ['401 bad key', json(401, { message: 'Invalid API key' }), 'unexpected'],
    ['400 missing column', json(400, { code: '42703', message: 'column bookings.idempotency_key does not exist' }), 'unexpected'],
  ];

  it.each(cases)('%s -> RepositoryError(%s)', async (_label, response, kind) => {
    const f = fakeFetch(response);
    const err = await createSupabaseRepository(config, { fetch: f.impl }).findByIdempotencyKey('k').catch((e) => e);
    expect(err).toBeInstanceOf(RepositoryError);
    expect(err.kind).toBe(kind);
    expect(err.message).not.toContain(FAKE_KEY);
  });
});
