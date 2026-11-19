-- 003_booking_overlap_check.sql   (READ-ONLY)
--
-- Run before db/003_booking_overlap.sql, after db/001 has been applied (it
-- uses normalize_slot()). Lists pairs of active bookings for the same provider
-- whose service windows overlap. Zero rows returned means the migration can run.
--
-- One SELECT; changes nothing. With psql you can make the server enforce it:
--   PGOPTIONS='-c default_transaction_read_only=on' psql "$DATABASE_URL" -f db/003_booking_overlap_check.sql
--
-- It selects no customer names, emails or phone numbers: only ids, dates,
-- slots, service types and statuses needed to decide which booking to move.
--
-- booking_window() does not exist until the migration runs, so the window
-- below repeats its logic inline (service durations + 30-minute buffer).
-- Keep the two identical (tests/db/migration003.test.ts checks this).

with durations(name, mins, ord) as (
  values ('ac repair', 120, 1), ('ac installation', 180, 2), ('ac gas refill', 90, 3),
         ('plumber', 90, 4), ('electrician', 120, 5), ('carpenter', 180, 6),
         ('painter', 240, 7), ('tutor', 60, 8), ('beautician', 120, 9),
         ('generator mechanic', 120, 10), ('fridge repair', 120, 11),
         ('washing machine repair', 120, 12), ('geyser repair', 90, 13),
         ('solar installation', 300, 14), ('pest control', 120, 15), ('deep cleaning', 240, 16)
),
active as (
  select b.id, b.booking_id, b.provider_id, b.booking_date, b.slot, b.service_type, b.status,
         public.normalize_slot(b.slot) as s,
         30 + coalesce((
           select d.mins from durations d
           where position(d.name in lower(coalesce(b.service_type, ''))) > 0
           order by d.ord limit 1
         ), 90) as block_mins,
         case when b.booking_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then substr(b.booking_date, 1, 4)::int end as y,
         case when b.booking_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then substr(b.booking_date, 6, 2)::int end as mo,
         case when b.booking_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then substr(b.booking_date, 9, 2)::int end as d
  from public.bookings b
  where b.status in ('confirmed', 'in_progress') and b.provider_id is not null
),
windows as (
  select a.*,
         case
           when s is not null and y between 1 and 9999 and mo between 1 and 12 then
             case
               when d between 1 and extract(day from (make_date(y, mo, 1) + interval '1 month' - interval '1 day'))::int
               then make_timestamp(y, mo, d, split_part(s, ':', 1)::int, split_part(s, ':', 2)::int, 0)
             end
         end as start_at
  from active a
)
select a.provider_id,
       a.booking_id   as first_booking,  a.booking_date as first_date,  a.slot as first_slot,  a.service_type as first_service,
       b.booking_id   as second_booking, b.booking_date as second_date, b.slot as second_slot, b.service_type as second_service
from windows a
join windows b
  on a.provider_id = b.provider_id
 and a.id < b.id
 and a.start_at is not null and b.start_at is not null
 and tsrange(a.start_at, a.start_at + make_interval(mins => a.block_mins), '[)')
     && tsrange(b.start_at, b.start_at + make_interval(mins => b.block_mins), '[)')
order by a.provider_id, a.start_at, b.start_at;
