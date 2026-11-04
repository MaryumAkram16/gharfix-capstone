import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertLocal, psql, psqlFile, query, withDatabase } from './psql';

// Runs db/002_* against a real, LOCAL Postgres (same setup as migration001).
//   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres npx vitest run tests/db

const BASE = process.env.TEST_DATABASE_URL;
const MIGRATE = 'db/002_incidents.sql';
const ROLLBACK = 'db/002_rollback.sql';
const dbName = `gharfix_test002_${process.pid}_${Date.now()}`;
let url = '';

const ok = (res: { ok: boolean; stderr: string }) => {
  if (!res.ok) throw new Error(res.stderr);
};

describe.skipIf(!BASE)('db/002 incidents (real Postgres)', () => {
  beforeAll(() => {
    assertLocal(BASE!);
    query(BASE!, `create database ${dbName}`);
    url = withDatabase(BASE!, dbName);
  });

  afterAll(() => {
    if (url) query(BASE!, `drop database if exists ${dbName} with (force)`);
  });

  beforeEach(() => {
    query(url, 'drop table if exists public.workflow_incidents; drop table if exists public.bookings;');
    ok(psqlFile(url, 'db/bookings.sql'));
    query(url, "insert into public.bookings (booking_id, user_email, status, slot) values ('BK-TEST-OLD', 'old@example.test', 'confirmed', '16:00')");
  });

  it('adds the table, the column and the indexes, and is a no-op the second time', () => {
    ok(psqlFile(url, MIGRATE));
    ok(psqlFile(url, MIGRATE));

    expect(query(url, `select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position)
      from information_schema.columns where table_name = 'workflow_incidents'`)).toBe([
      'id:bigint:NO', 'workflow:text:NO', 'step:text:NO', 'error_class:text:NO', 'retryable:boolean:NO',
      'auto_fixed:boolean:NO', 'request_id:text:YES', 'payload_hash:text:YES', 'created_at:timestamp with time zone:NO',
    ].join(','));
    expect(query(url, "select data_type from information_schema.columns where table_name = 'bookings' and column_name = 'confirmation_sent_at'"))
      .toBe('timestamp with time zone');
    expect(query(url, "select string_agg(indexname, ',' order by indexname) from pg_indexes where indexname in ('workflow_incidents_hash_recent_idx', 'bookings_unsent_confirmation_idx')"))
      .toBe('bookings_unsent_confirmation_idx,workflow_incidents_hash_recent_idx');
  });

  it('does not backfill existing bookings', () => {
    ok(psqlFile(url, MIGRATE));
    expect(query(url, "select coalesce(confirmation_sent_at::text, 'null') from public.bookings where booking_id = 'BK-TEST-OLD'")).toBe('null');
  });

  it('fills defaults: auto_fixed false, created_at now', () => {
    ok(psqlFile(url, MIGRATE));
    query(url, "insert into public.workflow_incidents (workflow, step, error_class, retryable) values ('khadmat-booking', 'supabase.insert', 'RepositoryError:unavailable:503', true)");
    expect(query(url, 'select auto_fixed::text, (now() - created_at < interval \'1 minute\')::text from public.workflow_incidents')).toBe('false|true');
  });

  it('keeps incidents away from the anon role (RLS on, no policies)', () => {
    ok(psqlFile(url, MIGRATE));
    query(url, "insert into public.workflow_incidents (workflow, step, error_class, retryable) values ('w', 's', 'e', true)");
    // Supabase grants table privileges to anon by default; RLS is what stops it.
    query(url, `do $$ begin if not exists (select 1 from pg_roles where rolname = 'test_anon') then create role test_anon nologin; end if; end $$;
      grant usage on schema public to test_anon; grant select, insert on public.workflow_incidents to test_anon;`);

    expect(query(url, 'set role test_anon; select count(*) from public.workflow_incidents;')).toBe('0');
    const insert = psql(url, "set role test_anon; insert into public.workflow_incidents (workflow, step, error_class, retryable) values ('x', 'y', 'z', false);");
    expect(insert.ok).toBe(false);
    expect(insert.stderr).toContain('violates row-level security policy');
    expect(query(url, 'select count(*) from public.workflow_incidents')).toBe('1');
  });

  it('stops in its verify step and changes nothing if the column has the wrong type', () => {
    query(url, 'alter table public.bookings add column confirmation_sent_at text');
    const res = psqlFile(url, MIGRATE);
    expect(res.ok).toBe(false);
    expect(res.stderr).toContain('confirmation_sent_at is missing or not timestamptz');
    expect(query(url, "select count(*) from pg_class where relname = 'workflow_incidents'")).toBe('0');
  });

  it('rollback removes everything, keeps bookings, and can run twice (also before 002 ever ran)', () => {
    ok(psqlFile(url, ROLLBACK));
    ok(psqlFile(url, MIGRATE));
    ok(psqlFile(url, ROLLBACK));
    ok(psqlFile(url, ROLLBACK));
    expect(query(url, "select count(*) from pg_class where relname in ('workflow_incidents', 'bookings_unsent_confirmation_idx')")).toBe('0');
    expect(query(url, "select count(*) from information_schema.columns where table_name = 'bookings' and column_name = 'confirmation_sent_at'")).toBe('0');
    expect(query(url, "select count(*) from public.bookings where booking_id = 'BK-TEST-OLD'")).toBe('1');
    ok(psqlFile(url, MIGRATE));
  });
});
