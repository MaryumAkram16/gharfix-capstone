-- 001_booking_integrity.sql
--
-- Makes the database, not the application, the thing that stops a provider
-- being double-booked, and gives confirm requests an idempotency key.
--
-- Before running: run db/001_booking_integrity_check.sql and resolve every
-- row it reports. This migration refuses to run while duplicates exist.
--
-- Safe to run more than once (every object uses IF NOT EXISTS / OR REPLACE).
-- Runs in one transaction: if any step fails, nothing is changed.
-- Undo with db/001_rollback.sql.
--
-- lib/booking/repository.ts depends on these exact names:
--   columns  bookings.idempotency_key, bookings.request_fingerprint
--   indexes  bookings_idempotency_key_key, bookings_active_slot_key
-- PostgREST reports a violation as: duplicate key value violates unique
-- constraint "<index name>", and the repository maps that name to a
-- slot / idempotency-key conflict.
--
-- Overlapping service windows (16:00 vs 16:30) are NOT covered here: a unique
-- index only sees identical start times. That is db/002 (exclusion constraint).

begin;

-- Fail fast instead of queueing behind a long-running query while holding up
-- every other request that touches bookings.
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. normalize_slot(text) -> 'HH:MM' or NULL
--
-- SQL twin of normaliseSlot() in lib/booking/slot.ts. Same steps, same order:
--   trim, lower-case, drop dots ("4 p.m." -> "4 pm"), then match
--   H[:MM][ ]am|pm  or  H[:MM]  (24h).
--   With am/pm the hour must be 1-12 (12 am -> 00, 12 pm -> 12).
--   Without, the hour must be 0-23. Minutes must be 00-59.
--
-- Whitespace is JavaScript's set for trim() and \s, written out (not
-- [[:space:]], which varies by locale), so a non-breaking space is trimmed in
-- both languages.
--
-- It never raises: the regex only lets ASCII digits through ([0-9], not \d,
-- which can match other scripts' digits that ::int would reject), so the
-- casts cannot fail. Anything else returns NULL.
--
-- IMMUTABLE is required to use it in an index, and is true: the output
-- depends only on the input. search_path is pinned so it cannot be hijacked
-- (and to satisfy Supabase's function_search_path_mutable lint).
-- ---------------------------------------------------------------------------
create or replace function public.normalize_slot(input text)
returns text
language sql
immutable
strict            -- NULL in, NULL out, without evaluating the body
parallel safe
set search_path = pg_catalog
as $$
  with cleaned as (
    select replace(lower(regexp_replace(input, '^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g')), '.', '') as s
  ),
  parts as (
    select g[1]::int as h, coalesce(g[2]::int, 0) as m, g[3] as period
    from cleaned,
         regexp_match(cleaned.s, '^([0-9]{1,2})(?::([0-9]{2}))?[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*(am|pm)?$') as g
    where g is not null
  ),
  hour24 as (
    select m,
           case
             when m > 59 then null
             when period is null then case when h <= 23 then h end
             when h < 1 or h > 12 then null
             when period = 'am' then case when h = 12 then 0 else h end
             else case when h = 12 then 12 else h + 12 end
           end as h
    from parts
  )
  select lpad(h::text, 2, '0') || ':' || lpad(m::text, 2, '0')
  from hour24
  where h is not null
$$;

comment on function public.normalize_slot(text) is
  'Slot string ("4:00 PM", "16:00", "9 am") -> 24h "HH:MM", or NULL if unparseable. Mirrors normaliseSlot() in lib/booking/slot.ts. Never raises.';

-- ---------------------------------------------------------------------------
-- 2. Idempotency columns
--
-- idempotency_key      client-generated key sent with a confirm request.
-- request_fingerprint  sha256 of the booking-defining fields of that request,
--                      so a retry (same key, same body) is replayed and a key
--                      reused for a different booking is rejected with 422.
-- Both stay NULL on rows created before this migration, and on requests
-- that send no key.
-- ---------------------------------------------------------------------------
alter table public.bookings add column if not exists idempotency_key text;
alter table public.bookings add column if not exists request_fingerprint text;

comment on column public.bookings.idempotency_key is
  'Client idempotency key for khadmat-booking confirm. Unique when present.';
comment on column public.bookings.request_fingerprint is
  'sha256 of the confirm request (minus key and candidate slots); detects key reuse.';

-- ---------------------------------------------------------------------------
-- 3. Pre-flight: stop with a readable message if existing rows would break
--    the slot index. (CREATE UNIQUE INDEX would fail anyway, but with a less
--    helpful error.) The ALTER TABLE above already holds an exclusive lock on
--    bookings, so no new duplicate can appear between this check and step 5.
-- ---------------------------------------------------------------------------
do $$
declare
  dup_groups int;
begin
  select count(*) into dup_groups
  from (
    select 1
    from public.bookings
    where status in ('confirmed', 'in_progress')
      -- Same NULL handling as the index: NULLs are distinct, never duplicates.
      and provider_id is not null
      and booking_date is not null
      and public.normalize_slot(slot) is not null
    group by provider_id, booking_date, public.normalize_slot(slot)
    having count(*) > 1
  ) d;

  if dup_groups > 0 then
    raise exception '001_booking_integrity: % provider/date/slot group(s) have more than one active booking', dup_groups
      using hint = 'Run db/001_booking_integrity_check.sql, resolve each duplicate, then rerun. Nothing was changed.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. bookings_idempotency_key_key: one booking per idempotency key.
--    Unique indexes treat NULLs as distinct, so any number of keyless rows
--    is fine.
-- ---------------------------------------------------------------------------
create unique index if not exists bookings_idempotency_key_key
  on public.bookings (idempotency_key);

-- ---------------------------------------------------------------------------
-- 5. bookings_active_slot_key: at most one active booking per provider, date
--    and start time. The slot is normalised, so "4:00 PM" and "16:00" collide.
--    Partial: cancelled / completed / rescheduled rows do not hold the slot.
--    The status list matches ACTIVE_STATUSES in lib/booking/repository.ts.
--    Rows whose slot (or provider_id / booking_date) is NULL or unparseable
--    never conflict, because NULLs are distinct in a unique index.
-- ---------------------------------------------------------------------------
create unique index if not exists bookings_active_slot_key
  on public.bookings (provider_id, booking_date, public.normalize_slot(slot))
  where status in ('confirmed', 'in_progress');

-- ---------------------------------------------------------------------------
-- 6. Verify. IF NOT EXISTS only checks the name, so a leftover index with the
--    same name but a different definition would be silently kept. Check that
--    both indexes are unique, valid, and built on the expected columns, and
--    roll everything back if not.
-- ---------------------------------------------------------------------------
do $$
declare
  idx record;
begin
  for idx in
    select n.name, i.indisunique, i.indisvalid, pg_get_indexdef(i.indexrelid) as def,
           pg_get_expr(i.indpred, i.indrelid) as pred
    from (values ('bookings_idempotency_key_key'), ('bookings_active_slot_key')) as n(name)
    left join pg_class c on c.relname = n.name and c.relnamespace = 'public'::regnamespace
    left join pg_index i on i.indexrelid = c.oid
  loop
    if idx.def is null then
      raise exception '001_booking_integrity: index % is missing', idx.name;
    end if;
    if not idx.indisunique or not idx.indisvalid then
      raise exception '001_booking_integrity: index % exists but is not a valid unique index: %', idx.name, idx.def;
    end if;
    if idx.name = 'bookings_idempotency_key_key'
       and (idx.def not like '%(idempotency_key)' or idx.pred is not null) then
      raise exception '001_booking_integrity: unexpected definition for %: %', idx.name, idx.def;
    end if;
    if idx.name = 'bookings_active_slot_key'
       -- normalize_slot may print schema-qualified, depending on search_path.
       and (idx.def not like '%(provider_id, booking_date, %normalize_slot(slot))%'
            or idx.pred is null or idx.pred not like '%confirmed%in_progress%') then
      raise exception '001_booking_integrity: unexpected definition for %: %', idx.name, idx.def;
    end if;
  end loop;
end
$$;

commit;
