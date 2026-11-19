import { spawn } from 'node:child_process';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { serviceBlock } from '../../lib/booking/schedule';
import { assertLocal, psql, psqlFile, query, withDatabase } from './psql';

// Runs db/003_* against a real, LOCAL Postgres. Skipped unless
// TEST_DATABASE_URL is set, e.g.
//   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres npx vitest run tests/db
// A throwaway database is created for the run and dropped afterwards.

const BASE = process.env.TEST_DATABASE_URL;
const MIGRATE_001 = 'db/001_booking_integrity.sql';
const CHECK = 'db/003_booking_overlap_check.sql';
const MIGRATE = 'db/003_booking_overlap.sql';
const ROLLBACK = 'db/003_rollback.sql';

let url = '';
const dbName = `gharfix_test003_${process.pid}_${Date.now()}`;
let seq = 0;

type Row = Record<string, unknown>;

function row(overrides: Row = {}): Row {
  return {
    booking_id: `BK-TEST-${++seq}`,
    user_email: 'db-test@example.test',
    provider_id: 'prov-1',
    booking_date: '2026-11-10',
    slot: '16:00',
    service_type: 'AC Repair', // 120 min + 30 min buffer = 150
    status: 'confirmed',
    ...overrides,
  };
}

const INSERT = (cols: string) =>
  `insert into public.bookings (${cols}) select ${cols} from json_populate_record(null::public.bookings, :'row'::json);`;

function insert(r: Row) {
  const cols = Object.keys(r).map((c) => `"${c}"`).join(', ');
  return psql(url, INSERT(cols), { vars: { row: JSON.stringify(r) } });
}

function insertOk(r: Row) {
  const res = insert(r);
  if (!res.ok) throw new Error(res.stderr);
}

function ok(res: { ok: boolean; stderr: string }) {
  if (!res.ok) throw new Error(res.stderr);
}

/** The constraint a failed insert hit, from Postgres' error text. */
const violated = (stderr: string) => /constraint "([^"]+)"/.exec(stderr)?.[1] ?? null;

/** Runs SQL in a separate psql process without waiting, for concurrency tests. */
function psqlAsync(sql: string): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', [url, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-']);
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
    child.stdin.end(sql);
  });
}

describe.skipIf(!BASE)('db/003 booking overlap (real Postgres)', () => {
  beforeAll(() => {
    assertLocal(BASE!);
    query(BASE!, `create database ${dbName} template template0`);
    url = withDatabase(BASE!, dbName);
  });

  afterAll(() => {
    if (url) query(BASE!, `drop database if exists ${dbName} with (force)`);
  });

  beforeEach(() => {
    query(
      url,
      `drop table if exists public.bookings;
       drop function if exists public.booking_window(text, text, text);
       drop function if exists public.service_block_minutes(text);
       drop function if exists public.normalize_slot(text);`,
    );
    ok(psqlFile(url, 'db/bookings.sql'));
    ok(psqlFile(url, MIGRATE_001));
  });

  describe('service_block_minutes matches serviceBlock() in lib/booking/schedule.ts', () => {
    const inputs = [
      'AC Repair', 'ac installation', 'AC Gas Refill', 'Plumber', 'Electrician', 'Carpenter', 'Painter', 'Tutor',
      'Beautician', 'Generator Mechanic', 'Fridge Repair', 'Washing Machine Repair', 'Geyser Repair',
      'Solar Installation', 'Pest Control', 'Deep Cleaning', 'Plumber + Electrician', 'Electrician and plumber',
      'Multi-Service Package', 'unknown service', '', null,
    ];

    it('gives the same total block for every service type', () => {
      ok(psqlFile(url, MIGRATE));
      for (const input of inputs) {
        const sql = input === null
          ? 'select public.service_block_minutes(null)'
          : "select public.service_block_minutes(:'v')";
        const got = Number(query(url, sql, input === null ? {} : { vars: { v: input } }));
        expect(got, String(input)).toBe(serviceBlock(input ?? undefined).totalBlockMins);
      }
    });
  });

  describe('booking_window', () => {
    const win = (date: string | null, slot: string | null, service: string | null) =>
      query(url, "select coalesce(public.booking_window(nullif(:'d', '<null>'), nullif(:'s', '<null>'), nullif(:'t', '<null>'))::text, 'NULL')", {
        vars: { d: date ?? '<null>', s: slot ?? '<null>', t: service ?? '<null>' },
      });

    beforeEach(() => ok(psqlFile(url, MIGRATE)));

    it('covers start + service duration + travel buffer, in any slot format', () => {
      expect(win('2026-11-10', '4:00 PM', 'AC Repair')).toBe('["2026-11-10 16:00:00","2026-11-10 18:30:00")');
      expect(win('2026-11-10', '9 am', 'Tutor')).toBe('["2026-11-10 09:00:00","2026-11-10 10:30:00")');
      expect(win('2026-11-10', '17:00', 'Solar Installation')).toBe('["2026-11-10 17:00:00","2026-11-10 22:30:00")');
    });

    it('returns NULL instead of raising for anything unparseable', () => {
      for (const [d, s] of [
        ['2026-02-30', '16:00'], ['2026-13-01', '16:00'], ['0000-01-01', '16:00'], ['10/11/2026', '16:00'],
        ['2026-11-10', 'evening'], ['2026-11-10', '25:00'], [null, '16:00'], ['2026-11-10', null],
      ]) {
        expect(win(d, s, 'Plumber'), `${d} ${s}`).toBe('NULL');
      }
      expect(win('2028-02-29', '10:00', 'Plumber')).not.toBe('NULL'); // leap day is real
    });
  });

  describe('bookings_no_overlap', () => {
    beforeEach(() => ok(psqlFile(url, MIGRATE)));

    it('rejects an overlapping window for the same provider (the gap db/001 left)', () => {
      insertOk(row({ booking_id: 'BK-TEST-O1', slot: '16:00' })); // occupies 16:00-18:30
      const res = insert(row({ booking_id: 'BK-TEST-O2', slot: '4:30 PM', service_type: 'Plumber' }));
      expect(res.ok).toBe(false);
      expect(res.stderr).toContain('conflicting key value violates exclusion constraint');
      expect(violated(res.stderr)).toBe('bookings_no_overlap');
    });

    it('also rejects a later booking that runs into an earlier-starting one', () => {
      insertOk(row({ booking_id: 'BK-TEST-O3', slot: '16:00', service_type: 'Plumber' }));
      const res = insert(row({ booking_id: 'BK-TEST-O4', slot: '14:30', service_type: 'Painter' })); // 14:30-19:00
      expect(violated(res.stderr)).toBe('bookings_no_overlap');
    });

    it('allows back-to-back windows, other providers, other dates, and inactive rows', () => {
      insertOk(row({ booking_id: 'BK-TEST-K1', slot: '09:00', service_type: 'Plumber' })); // 09:00-11:00
      insertOk(row({ booking_id: 'BK-TEST-K2', slot: '11:00', service_type: 'Plumber' })); // starts as K1 ends
      insertOk(row({ booking_id: 'BK-TEST-K3', provider_id: 'prov-2', slot: '09:30' }));
      insertOk(row({ booking_id: 'BK-TEST-K4', booking_date: '2026-11-11', slot: '09:30' }));
      insertOk(row({ booking_id: 'BK-TEST-K5', slot: '09:30', status: 'cancelled' }));
      insertOk(row({ booking_id: 'BK-TEST-K6', slot: '09:30', status: 'completed' }));
      insertOk(row({ booking_id: 'BK-TEST-K7', slot: '09:30', provider_id: null }));
      insertOk(row({ booking_id: 'BK-TEST-K8', slot: 'evening' })); // NULL window never conflicts
      expect(query(url, 'select count(*) from public.bookings')).toBe('8');
    });

    it('frees the window when a booking leaves the active statuses', () => {
      insertOk(row({ booking_id: 'BK-TEST-F1', slot: '16:00' }));
      ok(psql(url, "update public.bookings set status = 'user_rescheduling' where booking_id = 'BK-TEST-F1'"));
      insertOk(row({ booking_id: 'BK-TEST-F2', slot: '16:30' }));
      // ...and blocks it coming back while the new booking holds the time.
      const res = psql(url, "update public.bookings set status = 'confirmed' where booking_id = 'BK-TEST-F1'");
      expect(violated(res.stderr)).toBe('bookings_no_overlap');
    });

    it('lets exactly one of two simultaneous overlapping requests win', async () => {
      const tx = (id: string, slot: string, sleep: number) => `
        begin;
        insert into public.bookings (booking_id, user_email, provider_id, booking_date, slot, service_type, status)
        values ('${id}', 'db-test@example.test', 'prov-1', '2026-11-10', '${slot}', 'AC Repair', 'confirmed');
        select pg_sleep(${sleep});
        commit;`;
      // A holds its row uncommitted for a moment; B's overlapping insert has to
      // wait for A, then fails once A commits.
      const [a, b] = await Promise.all([psqlAsync(tx('BK-TEST-C1', '16:00', 1)), psqlAsync(tx('BK-TEST-C2', '16:30', 0))]);
      const outcomes = [a, b].map((r) => (r.code === 0 ? 'ok' : violated(r.stderr)));
      expect(outcomes.sort()).toEqual(['bookings_no_overlap', 'ok']);
      expect(query(url, "select count(*) from public.bookings where booking_id like 'BK-TEST-C%'")).toBe('1');
    });
  });

  describe('migration', () => {
    it('is safe to run twice', () => {
      ok(psqlFile(url, MIGRATE));
      ok(psqlFile(url, MIGRATE));
      expect(query(url, "select count(*) from pg_constraint where conname = 'bookings_no_overlap'")).toBe('1');
    });

    it('refuses to run, and changes nothing, while active bookings overlap', () => {
      insertOk(row({ booking_id: 'BK-TEST-P1', slot: '16:00' }));
      insertOk(row({ booking_id: 'BK-TEST-P2', slot: '16:30' }));
      const res = psqlFile(url, MIGRATE);
      expect(res.ok).toBe(false);
      expect(res.stderr).toContain('1 pair(s) of active bookings overlap');
      expect(query(url, "select count(*) from pg_proc where proname in ('booking_window', 'service_block_minutes')")).toBe('0');
      expect(query(url, "select count(*) from pg_constraint where conname = 'bookings_no_overlap'")).toBe('0');
    });

    it('rolls back cleanly, more than once, and can be reapplied', () => {
      ok(psqlFile(url, MIGRATE));
      ok(psqlFile(url, ROLLBACK));
      ok(psqlFile(url, ROLLBACK));
      expect(query(url, "select count(*) from pg_constraint where conname = 'bookings_no_overlap'")).toBe('0');
      insertOk(row({ booking_id: 'BK-TEST-R1', slot: '16:00' }));
      insertOk(row({ booking_id: 'BK-TEST-R2', slot: '16:30' })); // allowed again without 003
      ok(psql(url, "delete from public.bookings where booking_id = 'BK-TEST-R2'"));
      ok(psqlFile(url, MIGRATE));
    });
  });

  describe('check script', () => {
    it('is read-only and reports nothing on clean data', () => {
      insertOk(row({ slot: '09:00', service_type: 'Plumber' }));
      insertOk(row({ slot: '11:00', service_type: 'Plumber' }));
      const res = psqlFile(url, CHECK, { readOnly: true });
      expect(res.stderr).toBe('');
      expect(res.stdout).toBe('');
    });

    it('lists exactly the overlapping active pairs the migration would refuse', () => {
      insertOk(row({ booking_id: 'BK-TEST-X1', slot: '16:00' }));
      insertOk(row({ booking_id: 'BK-TEST-X2', slot: '4:30 PM', service_type: 'Plumber' }));
      insertOk(row({ booking_id: 'BK-TEST-X3', slot: '16:30', status: 'cancelled' })); // inactive
      insertOk(row({ booking_id: 'BK-TEST-X4', provider_id: 'prov-2', slot: '16:30' })); // other provider
      insertOk(row({ booking_id: 'BK-TEST-X5', booking_date: '2026-02-30', slot: '16:30' })); // invalid date
      const res = psqlFile(url, CHECK, { readOnly: true });
      expect(res.ok).toBe(true);
      expect(res.stdout).toBe('prov-1|BK-TEST-X1|2026-11-10|16:00|AC Repair|BK-TEST-X2|2026-11-10|4:30 PM|Plumber');
      // Same verdict as the migration's own pre-flight check.
      expect(psqlFile(url, MIGRATE).stderr).toContain('1 pair(s) of active bookings overlap');
    });

    it("uses the same durations as service_block_minutes()", () => {
      ok(psqlFile(url, MIGRATE));
      ok(psqlFile(url, ROLLBACK)); // keep the functions' definitions out of the data
      // A pair that overlaps only because of the travel buffer: Tutor 09:00 is 60 + 30 min.
      insertOk(row({ booking_id: 'BK-TEST-Y1', slot: '09:00', service_type: 'Tutor' }));
      insertOk(row({ booking_id: 'BK-TEST-Y2', slot: '10:15', service_type: 'Tutor' }));
      expect(psqlFile(url, CHECK, { readOnly: true }).stdout).toContain('BK-TEST-Y1');
      expect(psqlFile(url, MIGRATE).ok).toBe(false);
      ok(psql(url, "update public.bookings set slot = '10:30' where booking_id = 'BK-TEST-Y2'")); // exactly at the end
      expect(psqlFile(url, CHECK, { readOnly: true }).stdout).toBe('');
      ok(psqlFile(url, MIGRATE));
    });
  });
});
