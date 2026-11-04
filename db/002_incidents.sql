-- 002_incidents.sql
--
-- Self-healing support for the Vercel port:
--   1. workflow_incidents: one row per failed (or auto-fixed) external call,
--      written by lib/resilience. Used to de-duplicate alert emails.
--   2. bookings.confirmation_sent_at: set when a confirmation email has
--      actually been delivered to SMTP. api/reconcile.ts resends the
--      confirmation for confirmed bookings where it is still NULL.
--
-- Safe to run more than once (IF NOT EXISTS everywhere). Runs in one
-- transaction. Undo with db/002_rollback.sql. Independent of 001.
--
-- Apply this BEFORE deploying the code that uses it: the booking handler
-- writes confirmation_sent_at, and that update fails while the column is
-- missing (the booking itself still succeeds; the failure is logged).
--
-- (The overlap exclusion constraint planned as "002" will be 003.)

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. workflow_incidents
--
-- Deliberately has no free-text column: rows hold only classifications
-- built by the code (workflow, step, error_class), so no secret, message
-- body or customer data can land here. payload_hash is a sha256 of the
-- failure's identity (workflow, step, error class), not of customer data,
-- so the same outage hashes the same and produces one alert per window.
-- ---------------------------------------------------------------------------
create table if not exists public.workflow_incidents (
  id bigint generated always as identity primary key,
  workflow text not null,          -- e.g. 'khadmat-booking'
  step text not null,              -- e.g. 'supabase.insert', 'gemini.parse', 'smtp.send'
  error_class text not null,       -- e.g. 'RepositoryError:unavailable:503'
  retryable boolean not null,
  auto_fixed boolean not null default false,  -- true: a retry succeeded
  request_id text null,            -- Vercel x-vercel-id, for finding the log lines
  payload_hash text null,
  created_at timestamptz not null default now()
);

comment on table public.workflow_incidents is
  'Failures (and auto-fixed retries) of external calls, written by lib/resilience. No secrets or customer data.';

-- Alert de-duplication looks up recent unfixed incidents by hash.
create index if not exists workflow_incidents_hash_recent_idx
  on public.workflow_incidents (payload_hash, created_at desc)
  where auto_fixed = false;

-- Supabase exposes every public table through PostgREST. With RLS on and
-- no policies, the anon/authenticated roles can neither read nor write it;
-- the server uses the service-role key, which bypasses RLS.
alter table public.workflow_incidents enable row level security;

-- ---------------------------------------------------------------------------
-- 2. bookings.confirmation_sent_at
--
-- NULL means "no confirmation email delivered yet". Existing rows are NOT
-- backfilled: the reconciler only considers bookings created in the last
-- 24 hours, so customers from before this migration are never re-emailed.
-- ---------------------------------------------------------------------------
alter table public.bookings add column if not exists confirmation_sent_at timestamptz null;

comment on column public.bookings.confirmation_sent_at is
  'When the confirmation email was accepted by SMTP. NULL = not sent yet; api/reconcile.ts retries those.';

-- The reconciler's query: confirmed, not yet sent, recent.
create index if not exists bookings_unsent_confirmation_idx
  on public.bookings (created_at)
  where status = 'confirmed' and confirmation_sent_at is null;

-- ---------------------------------------------------------------------------
-- 3. Verify (IF NOT EXISTS only checks names).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings'
      and column_name = 'confirmation_sent_at' and data_type = 'timestamp with time zone'
  ) then
    raise exception '002_incidents: bookings.confirmation_sent_at is missing or not timestamptz';
  end if;

  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'workflow_incidents'
        and column_name in ('id', 'workflow', 'step', 'error_class', 'retryable', 'auto_fixed', 'request_id', 'payload_hash', 'created_at')) <> 9 then
    raise exception '002_incidents: workflow_incidents does not have the expected columns';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.workflow_incidents'::regclass) then
    raise exception '002_incidents: row level security is not enabled on workflow_incidents';
  end if;
end
$$;

commit;
