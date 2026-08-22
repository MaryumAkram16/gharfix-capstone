create table public.waitlist (
  id bigserial not null,
  booking_id text not null,
  user_email text null,
  user_name text null,
  service_type text not null,
  location text null,
  booking_date text null,
  slot text null,
  price_pkr integer null,
  cancelled_provider_id text null,
  cancelled_provider_name text null,
  attempted_provider_name text null,
  reason text null,
  status text null default 'waiting'::text,
  created_at timestamp with time zone null default now(),
  notified_at timestamp with time zone null,
  constraint waitlist_pkey primary key (id)
) TABLESPACE pg_default;
