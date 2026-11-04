-- 001_booking_integrity_check.sql   (READ-ONLY)
--
-- Run before db/001_booking_integrity.sql. Lists the rows that would block,
-- or slip past, the new bookings_active_slot_key index. Zero rows returned
-- means the migration can run.
--
-- This is one SELECT and changes nothing. In the Supabase SQL editor, paste
-- and run it. With psql you can make the server enforce read-only:
--   PGOPTIONS='-c default_transaction_read_only=on' psql "$DATABASE_URL" -f db/001_booking_integrity_check.sql
--
-- It selects no customer names, emails or phone numbers: only ids, slots and
-- statuses needed to decide which row to keep.
--
-- Problems reported (column `problem`):
--   duplicate_active_slot  More than one confirmed/in_progress booking for the
--                          same provider, date and start time, after
--                          normalising the slot ("4:00 PM" = "16:00").
--                          The migration REFUSES to run while any exist.
--                          booking_ids lists them oldest first; usually cancel
--                          or reschedule all but one.
--   unparseable_slot       A slot that normalize_slot() turns into NULL (e.g.
--                          "evening", "25:00", ""). Does not block the
--                          migration, but such a row is invisible to the slot
--                          index and to get_slots, so the provider could be
--                          double-booked at that time. Fix the slot value or
--                          the status.
--
-- normalize_slot() does not exist until the migration runs, so `parsed` below
-- repeats its logic inline. Keep the two identical (tests/db checks this).

with parsed as (
  select b.booking_id, b.provider_id, b.booking_date, b.slot, b.status, b.created_at,
         g[1]::int as h, coalesce(g[2]::int, 0) as m, g[3] as period
  from public.bookings b
  left join lateral regexp_match(
    replace(lower(regexp_replace(b.slot, '^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g')), '.', ''),
    '^([0-9]{1,2})(?::([0-9]{2}))?[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*(am|pm)?$'
  ) as g on true
),
normalised as (
  select booking_id, provider_id, booking_date, slot, status, created_at,
         case
           when h is null or m > 59 then null
           when period is null then case when h <= 23 then lpad(h::text, 2, '0') || ':' || lpad(m::text, 2, '0') end
           when h < 1 or h > 12 then null
           when period = 'am' then lpad((case when h = 12 then 0 else h end)::text, 2, '0') || ':' || lpad(m::text, 2, '0')
           else lpad((case when h = 12 then 12 else h + 12 end)::text, 2, '0') || ':' || lpad(m::text, 2, '0')
         end as norm_slot
  from parsed
)
select 'duplicate_active_slot' as problem,
       provider_id,
       booking_date,
       norm_slot as slot,
       null::text as status,
       count(*)::int as row_count,
       array_agg(booking_id order by created_at nulls last, booking_id) as booking_ids
from normalised
where status in ('confirmed', 'in_progress')
  -- NULL provider/date/slot never collide in the unique index, so skip them.
  and provider_id is not null
  and booking_date is not null
  and norm_slot is not null
group by provider_id, booking_date, norm_slot
having count(*) > 1

union all

select 'unparseable_slot',
       provider_id,
       booking_date,
       slot,           -- the raw value, so you can see what is wrong
       status,
       1,
       array[booking_id]
from normalised
where slot is not null
  and norm_slot is null

order by problem, provider_id, booking_date, slot;
