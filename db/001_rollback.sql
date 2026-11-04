-- 001_rollback.sql
--
-- Undoes db/001_booking_integrity.sql. Safe to run more than once, and in
-- one transaction: all of it or none of it.
--
-- WARNING: dropping the columns deletes every stored idempotency key and
-- request fingerprint. After a rollback, a client retrying an earlier confirm
-- can no longer be recognised as a retry. Deploy code that does not use the
-- columns BEFORE running this, otherwise confirm requests start failing
-- (the repository inserts idempotency_key and request_fingerprint).
--
-- Booking rows themselves are not touched.

begin;

set local lock_timeout = '5s';

-- Indexes first: bookings_active_slot_key depends on normalize_slot().
drop index if exists public.bookings_active_slot_key;
drop index if exists public.bookings_idempotency_key_key;

alter table public.bookings drop column if exists request_fingerprint;
alter table public.bookings drop column if exists idempotency_key;

-- No CASCADE: if anything else (a later migration, a view, a policy) has
-- started using normalize_slot(), this fails and the whole rollback is undone
-- instead of silently dropping that object too.
drop function if exists public.normalize_slot(text);

commit;
