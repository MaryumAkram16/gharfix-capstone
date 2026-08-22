-- Cache table for nightly-computed provider optimization scores.
-- One row per provider; overwritten on every scheduled run.
create table if not exists provider_scores (
  provider_id text primary key,
  provider_name text,
  computed_at timestamptz not null default now(),

  utilization_rate_pct int,
  workload_status text,
  slots_open_today jsonb,

  total_completed_jobs int,
  total_earnings_pkr int,
  avg_per_job_pkr int,
  platform_avg_pkr int,
  earning_fairness text,

  avg_rating numeric,
  reputation_health text,
  flagged_bookings int,

  cancellation_rate_pct int,
  cancellation_status text,

  repeat_customers int,
  recommended_slots jsonb,
  optimization_tips jsonb,
  rate_optimization jsonb,

  raw jsonb   -- full computed payload, so the dashboard can render without recomputation
);

-- Lets Supabase's PostgREST resolve upserts via on_conflict=provider_id
create unique index if not exists provider_scores_provider_id_key on provider_scores (provider_id);
