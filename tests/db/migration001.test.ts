import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { conflictTarget, CONSTRAINTS, type NewBooking } from '../../lib/booking/repository';
import { normaliseSlot, slotLabel } from '../../lib/booking/slot';
import { assertLocal, psql, psqlFile, query, withDatabase } from './psql';

// Runs db/001_* against a real, LOCAL Postgres. Skipped unless
// TEST_DATABASE_URL is set, e.g.
//   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres npx vitest run tests/db
// A throwaway database is created for the run and dropped afterwards.

const BASE = process.env.TEST_DATABASE_URL;
const CHECK = 'db/001_booking_integrity_check.sql';
const MIGRATE = 'db/001_booking_integrity.sql';
const ROLLBACK = 'db/001_rollback.sql';

let url = '';
const dbName = `gharfix_test_${process.pid}_${Date.now()}`;
let seq = 0;

type Row = Record<string, unknown>;

function row(overrides: Row = {}): Row {
  return {
    booking_id: `BK-TEST-${++seq}`,
    user_email: 'db-test@example.test',
    provider_id: 'prov-1',
    booking_date: '2026-11-10',
    slot: '16:00',
    status: 'confirmed',
    ...overrides,
  };
}

/** Insert one row. Column names come from the test; values travel as a JSON psql variable. */
function insert(r: Row) {
  const cols = Object.keys(r).map((c) => `"${c}"`).join(', ');
  return psql(url, `insert into public.bookings (${cols}) select ${cols} from json_populate_record(null::public.bookings, :'row'::json);`, {
    vars: { row: JSON.stringify(r) },
  });
}

/** Many rows in one statement (all must have the same keys). */
function insertManyOk(rows: Row[]) {
  const cols = Object.keys(rows[0]).map((c) => `"${c}"`).join(', ');
  const res = psql(url, `insert into public.bookings (${cols}) select ${cols} from json_populate_recordset(null::public.bookings, :'rows'::json);`, {
    vars: { rows: JSON.stringify(rows) },
  });
  if (!res.ok) throw new Error(res.stderr);
}

function insertOk(r: Row) {
  const res = insert(r);
  if (!res.ok) throw new Error(res.stderr);
}

function migrate() {
  const res = psqlFile(url, MIGRATE);
  if (!res.ok) throw new Error(res.stderr);
}

const exists = {
  fn: () => query(url, "select count(*) from pg_proc where proname = 'normalize_slot'") === '1',
  columns: () =>
    query(url, "select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_name = 'bookings' and column_name in ('idempotency_key', 'request_fingerprint')"),
  indexes: () =>
    query(url, "select string_agg(indexname, ',' order by indexname) from pg_indexes where tablename = 'bookings' and indexname in ('bookings_active_slot_key', 'bookings_idempotency_key_key')"),
};

const violated = (stderr: string) => /unique constraint "([^"]+)"/.exec(stderr)?.[1] ?? null;

describe.skipIf(!BASE)('db/001 booking integrity (real Postgres)', () => {
  beforeAll(() => {
    assertLocal(BASE!);
    // ICU locale: there \d and [[:space:]] match non-ASCII characters, which
    // is the harder case for normalize_slot. Supabase uses libc locales, where
    // they are ASCII-only, so passing here covers both.
    query(BASE!, `create database ${dbName} template template0 locale_provider icu icu_locale 'und' locale 'C.UTF-8'`);
    url = withDatabase(BASE!, dbName);
  });

  afterAll(() => {
    if (url) query(BASE!, `drop database if exists ${dbName} with (force)`);
  });

  beforeEach(() => {
    query(url, 'drop table if exists public.bookings; drop function if exists public.normalize_slot(text);');
    const res = psqlFile(url, 'db/bookings.sql');
    if (!res.ok) throw new Error(res.stderr);
  });

  describe('check script', () => {
    it('is read-only and reports nothing on clean data', () => {
      insertOk(row({ slot: '09:00' }));
      insertOk(row({ slot: '4:00 PM' }));
      const res = psqlFile(url, CHECK, { readOnly: true });
      expect(res.stderr).toBe('');
      expect(res.ok).toBe(true);
      expect(res.stdout).toBe('');
    });

    it('lists duplicate active slots (after normalising) and unparseable slots, nothing else', () => {
      insertOk(row({ booking_id: 'BK-TEST-A1', slot: '4:00 PM' }));
      insertOk(row({ booking_id: 'BK-TEST-A2', slot: '16:00', status: 'in_progress' }));
      insertOk(row({ booking_id: 'BK-TEST-A3', slot: '16:00', status: 'cancelled' })); // not active
      insertOk(row({ booking_id: 'BK-TEST-B1', provider_id: 'prov-2', slot: '09:00' }));
      insertOk(row({ booking_id: 'BK-TEST-B2', provider_id: 'prov-2', slot: '9 am', status: 'completed' }));
      insertOk(row({ booking_id: 'BK-TEST-N1', provider_id: null, slot: '10:00' })); // NULLs never collide
      insertOk(row({ booking_id: 'BK-TEST-N2', provider_id: null, slot: '10:00' }));
      insertOk(row({ booking_id: 'BK-TEST-U1', slot: 'evening', status: 'cancelled' }));
      insertOk(row({ booking_id: 'BK-TEST-U2', provider_id: 'prov-3', slot: '25:00' }));
      insertOk(row({ booking_id: 'BK-TEST-U3', slot: null }));

      const res = psqlFile(url, CHECK, { readOnly: true });
      expect(res.ok).toBe(true);
      expect(res.stdout.split('\n')).toEqual([
        'duplicate_active_slot|prov-1|2026-11-10|16:00||2|{BK-TEST-A1,BK-TEST-A2}',
        'unparseable_slot|prov-1|2026-11-10|evening|cancelled|1|{BK-TEST-U1}',
        'unparseable_slot|prov-3|2026-11-10|25:00|confirmed|1|{BK-TEST-U2}',
      ]);
    });
  });

  describe('migration', () => {
    it('refuses to run while duplicates exist, and changes nothing (one transaction)', () => {
      insertOk(row({ slot: '4:00 PM' }));
      insertOk(row({ slot: '16:00' }));

      const res = psqlFile(url, MIGRATE);
      expect(res.ok).toBe(false);
      expect(res.stderr).toContain('001_booking_integrity: 1 provider/date/slot group(s) have more than one active booking');
      expect(res.stderr).toContain('HINT:  Run db/001_booking_integrity_check.sql');
      expect(exists.fn()).toBe(false);
      expect(exists.columns()).toBe('');
    });

    it('applies cleanly and is a no-op the second time', () => {
      insertOk(row({ slot: '4:00 PM' }));
      migrate();
      migrate();
      expect(exists.fn()).toBe(true);
      expect(exists.columns()).toBe('idempotency_key,request_fingerprint');
      expect(exists.indexes()).toBe('bookings_active_slot_key,bookings_idempotency_key_key');
      expect(query(url, "select provolatile::text || ',' || proisstrict::text from pg_proc where proname = 'normalize_slot'")).toBe('i,true');
    });

    it('stops and rolls back if an index with the right name has the wrong definition', () => {
      query(url, 'create index bookings_active_slot_key on public.bookings (provider_id)');
      const notUnique = psqlFile(url, MIGRATE);
      expect(notUnique.ok).toBe(false);
      expect(notUnique.stderr).toContain('index bookings_active_slot_key exists but is not a valid unique index');
      expect(exists.fn()).toBe(false);

      query(url, 'drop index bookings_active_slot_key; create unique index bookings_active_slot_key on public.bookings (booking_id)');
      const wrongColumns = psqlFile(url, MIGRATE);
      expect(wrongColumns.ok).toBe(false);
      expect(wrongColumns.stderr).toContain('unexpected definition for bookings_active_slot_key');
      expect(exists.columns()).toBe('');
    });

    it('accepts every column the repository inserts', () => {
      migrate();
      // Typed as NewBooking, so this breaks at compile time if the repository grows a column.
      const sample: NewBooking = {
        booking_id: 'BK-TEST-CONTRACT', user_name: 'Test User', user_email: 'db-test@example.test',
        service_type: 'AC Repair', provider_id: 'prov-1', provider_name: 'Ali AC Services',
        location: 'DHA Phase 5, Lahore', slot: '16:00', booking_date: '2026-11-10', price_pkr: 2500,
        status: 'confirmed', created_at: '2026-11-04T09:00:00.000Z', idempotency_key: 'idem-test-0001',
        request_fingerprint: 'f'.repeat(64), provider_rating: 4.5, provider_review_count: 12,
        provider_address: 'Lahore', provider_distance_km: 3.2, provider_reputation_score: 80,
        provider_verified: true, provider_google_maps_url: '', provider_coordinates_lat: 31.4697,
        provider_coordinates_lng: 74.4093,
      };
      insertOk(sample as unknown as Row);
      expect(query(url, "select slot || '|' || idempotency_key from public.bookings where booking_id = 'BK-TEST-CONTRACT'")).toBe('16:00|idem-test-0001');
    });
  });

  describe('bookings_active_slot_key', () => {
    beforeEach(() => migrate());

    it('rejects a second active booking at the same normalised start, with the name the repository maps to "slot"', () => {
      insertOk(row({ slot: '16:00' }));
      for (const r of [row({ slot: '4:00 PM' }), row({ slot: ' 4 p.m. ', status: 'in_progress' })]) {
        const res = insert(r);
        expect(res.ok).toBe(false);
        expect(res.stderr).toContain('duplicate key value violates unique constraint "bookings_active_slot_key"');
        expect(violated(res.stderr)).toBe(CONSTRAINTS.slot);
        expect(conflictTarget(violated(res.stderr))).toBe('slot');
      }
    });

    it('allows the same slot when cancelled, on another date, or for another provider', () => {
      insertOk(row({ slot: '16:00' }));
      insertOk(row({ slot: '16:00', status: 'cancelled' }));
      insertOk(row({ slot: '16:00', booking_date: '2026-11-11' }));
      insertOk(row({ slot: '16:00', provider_id: 'prov-2' }));
      insertOk(row({ slot: '16:30' })); // overlap: left to db/002
    });

    it('frees the slot once the booking is cancelled', () => {
      insertOk(row({ booking_id: 'BK-TEST-FIRST', slot: '16:00' }));
      query(url, "update public.bookings set status = 'cancelled' where booking_id = 'BK-TEST-FIRST'");
      insertOk(row({ slot: '16:00' }));
    });

    it('does not cover unparseable slots (they are NULL in the index)', () => {
      insertOk(row({ slot: 'evening' }));
      insertOk(row({ slot: 'evening' }));
    });
  });

  describe('bookings_idempotency_key_key', () => {
    beforeEach(() => migrate());

    it('rejects a reused key with the name the repository maps to "idempotency_key"', () => {
      insertOk(row({ slot: '09:00', idempotency_key: 'idem-test-0001' }));
      const res = insert(row({ slot: '10:00', idempotency_key: 'idem-test-0001' }));
      expect(res.ok).toBe(false);
      expect(violated(res.stderr)).toBe(CONSTRAINTS.idempotencyKey);
      expect(conflictTarget(violated(res.stderr))).toBe('idempotency_key');
    });

    it('allows any number of rows without a key', () => {
      insertOk(row({ slot: '09:00', idempotency_key: null }));
      insertOk(row({ slot: '10:00', idempotency_key: null }));
    });
  });

  describe('normalize_slot matches normaliseSlot() and never raises', () => {
    const inputs = [
      // From tests/booking/slot.test.ts
      '09:00', '9:00', '9', '16:00', '00:00', '23:59', '4:00 PM', '4:00PM', '4 pm', '4 p.m.', '  11:30 am ',
      '12:00 PM', '12 AM', '12:30 am', '', '   ', '25:00', '24:00', '4:60', '13:00 PM', '0:00 AM', '4:5',
      '4:000', 'noon', '9am-10am', '-1:00', '09:00:00', 'PM',
      // Whitespace JavaScript trims: tab, newline, NBSP, ideographic space, BOM
      '\t9:30\t', '\n16:00\n', '\u00a016:00\u00a0', '4\u3000pm', '\ufeff9 am', '4\u202fPM',
      // Digits from other scripts must give NULL, not a cast error
      '\u0664 pm', '\u0966\u096f:\u0966\u0966', '\uff10\uff19:\uff10\uff10',
      // Odd punctuation and sizes
      '4 P.M.', '4:00 pm.', '4..00 pm', '.4 pm', '16.00', '1600', '9 a m', '9 amm', "4' pm", '0', '00', '000',
      '99999999999999999999', '9'.repeat(5000), 'x'.repeat(5000), '1 AM', '12:59 PM', '7:07',
      // Every quarter hour, as label and as bare H:MM, plus out-of-range hours
      ...Array.from({ length: 96 }, (_, i) => {
        const slot = `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`;
        return slotLabel(slot);
      }),
      ...Array.from({ length: 31 }, (_, h) => `${h}:00`),
      ...Array.from({ length: 15 }, (_, h) => `${h} pm`),
    ];

    it('SQL function gives the same answer as TypeScript for every input', () => {
      migrate();
      const out = query(
        url,
        "select coalesce(public.normalize_slot(x), '<null>') from json_array_elements_text(:'inputs'::json) with ordinality as t(x, n) order by n;",
        { vars: { inputs: JSON.stringify(inputs) } },
      ).split('\n');
      expect(out).toEqual(inputs.map((i) => normaliseSlot(i) ?? '<null>'));
    });

    it("check script's inline copy flags exactly the inputs TypeScript cannot parse", () => {
      insertManyOk(inputs.map((slot, n) => row({ booking_id: `BK-TEST-PAR-${n}`, slot, status: 'cancelled' })));
      const res = psqlFile(url, CHECK, { readOnly: true });
      expect(res.ok).toBe(true);
      const flagged = new Set([...res.stdout.matchAll(/\{BK-TEST-PAR-(\d+)\}/g)].map((m) => Number(m[1])));
      const expected = new Set(inputs.flatMap((slot, n) => (normaliseSlot(slot) === null ? [n] : [])));
      expect(flagged).toEqual(expected);
    });
  });

  describe('rollback', () => {
    it('removes everything 001 added, keeps the bookings, and can run twice', () => {
      migrate();
      insertOk(row({ booking_id: 'BK-TEST-KEEP', idempotency_key: 'idem-test-keep' }));

      for (let i = 0; i < 2; i++) {
        const res = psqlFile(url, ROLLBACK);
        expect(res.stderr.split('\n').filter((l) => l.startsWith('psql:') && l.includes('ERROR'))).toEqual([]);
        expect(res.ok).toBe(true);
      }
      expect(exists.fn()).toBe(false);
      expect(exists.columns()).toBe('');
      expect(exists.indexes()).toBe('');
      expect(query(url, "select count(*) from public.bookings where booking_id = 'BK-TEST-KEEP'")).toBe('1');

      migrate(); // and forward again
      expect(exists.indexes()).toBe('bookings_active_slot_key,bookings_idempotency_key_key');
    });

    it('is harmless on a database that never ran 001', () => {
      expect(psqlFile(url, ROLLBACK).ok).toBe(true);
    });
  });
});
