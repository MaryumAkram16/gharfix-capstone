-- 002_rollback.sql
--
-- Undoes db/002_incidents.sql. Safe to run more than once; one transaction.
--
-- WARNING: drops every recorded incident, and every confirmation_sent_at
-- value. Deploy code that no longer writes confirmation_sent_at first, and
-- disable the reconcile schedule (.github/workflows/reconcile.yml): without
-- the column the reconciler cannot tell sent from unsent.
--
-- Booking rows themselves are not touched.

begin;

set local lock_timeout = '5s';

drop index if exists public.bookings_unsent_confirmation_idx;
alter table public.bookings drop column if exists confirmation_sent_at;

drop table if exists public.workflow_incidents;  -- its index goes with it

commit;
