-- Noor's future Supabase storage. The local server still uses SQLite until a
-- PostgreSQL adapter is configured and tested against an actual project.
-- Run with the Supabase migration tool as the project owner.

create table if not exists public.noor_usage_events (
  id uuid primary key,
  day date not null,
  visitor_hash text not null check (length(visitor_hash) = 64),
  kind text not null check (kind in ('claude', 'speak', 'transcribe', 'verification')),
  state text not null check (state in ('reserved', 'done', 'uncertain')),
  reserved_tokens integer not null default 0 check (reserved_tokens >= 0),
  actual_tokens integer check (actual_tokens >= 0),
  created_at timestamptz not null default now()
);
create index if not exists noor_usage_day_kind on public.noor_usage_events(day, kind);
create index if not exists noor_usage_visitor_day_kind on public.noor_usage_events(visitor_hash, day, kind);

create table if not exists public.noor_email_verifications (
  id uuid primary key,
  session_id text not null,
  email text not null,
  code_hash text not null,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  verified_at timestamptz,
  provider_id text,
  send_state text not null
);
create index if not exists noor_verifications_email_time on public.noor_email_verifications(email, created_at);

create table if not exists public.noor_email_jobs (
  id uuid primary key,
  verification_id uuid not null unique,
  email text,
  subject text,
  body text,
  review_hash text,
  scheduled_at timestamptz not null,
  status text not null,
  confirmed_at timestamptz not null,
  sending_at timestamptz,
  attempts integer not null default 0,
  provider_id text,
  sent_at timestamptz,
  cancelled_at timestamptz,
  failed_at timestamptz,
  delivery_event text,
  delivery_checked_at timestamptz,
  failure_reason text
);
create index if not exists noor_email_jobs_due on public.noor_email_jobs(status, scheduled_at);
create index if not exists noor_email_jobs_email on public.noor_email_jobs(email);

create table if not exists public.noor_email_events (
  id bigint generated always as identity primary key,
  job_id uuid not null,
  event text not null,
  at timestamptz not null default now(),
  detail text
);
create index if not exists noor_email_events_at on public.noor_email_events(at);

-- The browser must not read or write private email and usage records directly.
alter table public.noor_usage_events enable row level security;
alter table public.noor_email_verifications enable row level security;
alter table public.noor_email_jobs enable row level security;
alter table public.noor_email_events enable row level security;
revoke all on public.noor_usage_events, public.noor_email_verifications,
  public.noor_email_jobs, public.noor_email_events from anon, authenticated;
grant all on public.noor_usage_events, public.noor_email_verifications,
  public.noor_email_jobs, public.noor_email_events to service_role;
grant usage, select on sequence public.noor_email_events_id_seq to service_role;

create or replace function public.noor_prune_data()
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.noor_email_verifications
    where created_at < now() - interval '1 day';
  update public.noor_email_jobs
    set email = null, subject = null, body = null, review_hash = null
    where email is not null
      and status in ('sent', 'failed', 'cancelled', 'unknown')
      and coalesce(sent_at, failed_at, cancelled_at, confirmed_at) < now() - interval '30 days';
  delete from public.noor_email_events where at < now() - interval '90 days';
  delete from public.noor_usage_events where created_at < now() - interval '30 days';
end;
$$;
revoke all on function public.noor_prune_data() from public, anon, authenticated;
grant execute on function public.noor_prune_data() to service_role;
