-- 003_rollback.sql
--
-- Undoes db/003_booking_overlap.sql. Safe to run more than once, and in one
-- transaction: all of it or none of it. Booking rows are not touched.
--
-- After a rollback only db/001's same-start-time index remains, so two
-- simultaneous requests for overlapping windows can both succeed again.
--
-- The btree_gist extension is left installed: other objects may use it, and
-- it holds no data.

begin;

set local lock_timeout = '5s';

alter table public.bookings drop constraint if exists bookings_no_overlap;

-- No CASCADE: if anything else has started using these functions, this fails
-- and the whole rollback is undone instead of silently dropping that object.
drop function if exists public.booking_window(text, text, text);
drop function if exists public.service_block_minutes(text);

commit;
