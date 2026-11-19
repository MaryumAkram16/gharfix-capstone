-- 003_booking_overlap.sql
--
-- Closes the overlap gap left by db/001: its unique index only stops two
-- active bookings with the SAME start time. This adds an exclusion constraint
-- so a provider cannot hold two active bookings whose service windows overlap
-- (16:00 and 16:30 for a 150-minute job), even when both requests arrive at
-- the same moment.
--
-- Requires db/001_booking_integrity.sql (it uses normalize_slot()).
--
-- Before running: run db/003_booking_overlap_check.sql and resolve every row
-- it reports. This migration refuses to run while overlaps exist.
--
-- Safe to run more than once. Runs in one transaction: if any step fails,
-- nothing is changed. Undo with db/003_rollback.sql.
--
-- lib/booking/repository.ts already maps Postgres error 23P01 (exclusion
-- violation) to a 409 slot_taken response, so no application change is needed.

begin;

set local lock_timeout = '5s';

-- btree_gist lets a GiST index compare provider_id with "=" next to the
-- range overlap operator. Supabase ships it; this is a no-op if it is already
-- installed (in any schema).
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- 1. service_block_minutes(service_type) -> job minutes + 30-minute travel buffer
--
-- SQL twin of serviceBlock() in lib/booking/schedule.ts: the first service
-- name (in this order) contained in the lower-cased service type wins, and
-- anything else gets the 90-minute default. Keep both lists identical:
-- tests/db/migration003.test.ts compares them.
-- ---------------------------------------------------------------------------
create or replace function public.service_block_minutes(service_type text)
returns integer
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select 30 + case
    when position('ac repair' in k) > 0 then 120
    when position('ac installation' in k) > 0 then 180
    when position('ac gas refill' in k) > 0 then 90
    when position('plumber' in k) > 0 then 90
    when position('electrician' in k) > 0 then 120
    when position('carpenter' in k) > 0 then 180
    when position('painter' in k) > 0 then 240
    when position('tutor' in k) > 0 then 60
    when position('beautician' in k) > 0 then 120
    when position('generator mechanic' in k) > 0 then 120
    when position('fridge repair' in k) > 0 then 120
    when position('washing machine repair' in k) > 0 then 120
    when position('geyser repair' in k) > 0 then 90
    when position('solar installation' in k) > 0 then 300
    when position('pest control' in k) > 0 then 120
    when position('deep cleaning' in k) > 0 then 240
    else 90
  end
  from (select lower(coalesce(service_type, '')) as k) s
$$;

comment on function public.service_block_minutes(text) is
  'Service duration + 30-minute travel buffer, in minutes. Mirrors serviceBlock() in lib/booking/schedule.ts.';

-- ---------------------------------------------------------------------------
-- 2. booking_window(booking_date, slot, service_type) -> tsrange or NULL
--
-- The time a booking occupies: [start, start + service block). booking_date
-- is a 'YYYY-MM-DD' Pakistan date and slot any format normalize_slot() reads.
--
-- It never raises: an unparseable slot, a malformed date or an impossible
-- calendar date (2026-02-30) returns NULL. CASE evaluates in order, so
-- make_date / make_timestamp only see values already checked to be valid.
-- A NULL window never conflicts, the same way db/001 treats NULL slots.
-- ---------------------------------------------------------------------------
create or replace function public.booking_window(booking_date text, slot text, service_type text)
returns tsrange
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  with p as (
    select substr(booking_date, 1, 4)::int as y,
           substr(booking_date, 6, 2)::int as mo,
           substr(booking_date, 9, 2)::int as d,
           public.normalize_slot(slot) as s
    where booking_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  ),
  t as (
    select case
             when s is not null and y between 1 and 9999 and mo between 1 and 12 then
               case
                 when d between 1 and extract(day from (make_date(y, mo, 1) + interval '1 month' - interval '1 day'))::int
                 then make_timestamp(y, mo, d, split_part(s, ':', 1)::int, split_part(s, ':', 2)::int, 0)
               end
           end as start_at
    from p
  )
  select tsrange(start_at, start_at + make_interval(mins => public.service_block_minutes(service_type)), '[)')
  from t
  where start_at is not null
$$;

comment on function public.booking_window(text, text, text) is
  'Time a booking occupies: [start, start + service block). NULL if the date or slot is unparseable. Never raises.';

-- ---------------------------------------------------------------------------
-- 3. Pre-flight: stop with a readable message if existing active bookings
--    already overlap (ADD CONSTRAINT would fail anyway, less helpfully).
--    Lock first so no new overlap can appear between the check and step 4.
-- ---------------------------------------------------------------------------
lock table public.bookings in share row exclusive mode;

do $$
declare
  overlap_pairs int;
begin
  select count(*) into overlap_pairs
  from public.bookings a
  join public.bookings b
    on a.provider_id = b.provider_id
   and a.id < b.id
   and public.booking_window(a.booking_date, a.slot, a.service_type)
       && public.booking_window(b.booking_date, b.slot, b.service_type)
  where a.status in ('confirmed', 'in_progress')
    and b.status in ('confirmed', 'in_progress');

  if overlap_pairs > 0 then
    raise exception '003_booking_overlap: % pair(s) of active bookings overlap for the same provider', overlap_pairs
      using hint = 'Run db/003_booking_overlap_check.sql, resolve each pair, then rerun. Nothing was changed.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. bookings_no_overlap: no two active bookings for one provider may have
--    overlapping windows. Partial, with the same status list as db/001 and
--    ACTIVE_STATUSES in lib/booking/repository.ts.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bookings_no_overlap' and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
      add constraint bookings_no_overlap
      exclude using gist (
        provider_id with =,
        public.booking_window(booking_date, slot, service_type) with &&
      )
      where (status in ('confirmed', 'in_progress'));
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Verify: IF NOT EXISTS above only checks the name, so make sure the
--    constraint that exists is the expected exclusion constraint.
-- ---------------------------------------------------------------------------
do $$
declare
  def text;
begin
  select pg_get_constraintdef(oid) into def
  from pg_constraint
  where conname = 'bookings_no_overlap' and conrelid = 'public.bookings'::regclass and contype = 'x';

  if def is null then
    raise exception '003_booking_overlap: exclusion constraint bookings_no_overlap is missing';
  end if;
  if def not like '%provider_id WITH =%booking_window(booking_date, slot, service_type) WITH &&%'
     or def not like '%confirmed%in_progress%' then
    raise exception '003_booking_overlap: unexpected definition for bookings_no_overlap: %', def;
  end if;
end
$$;

commit;
