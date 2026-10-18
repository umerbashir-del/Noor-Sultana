-- Additive crew Claude accounting. Existing passenger usage is untouched.
create table if not exists public.noor_crew_sessions (
 id uuid primary key,
 visitor_hash text not null check (visitor_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now() + interval '2 hours')
);
alter table public.noor_crew_sessions enable row level security;
revoke all on public.noor_crew_sessions from public,anon,authenticated;
grant all on public.noor_crew_sessions to service_role;
alter table public.noor_usage_events add column if not exists crew_session_id uuid;
create index if not exists noor_crew_usage_day on public.noor_usage_events(day,kind,crew_session_id);

create or replace function public.noor_reserve_crew_model_call(
 p_session_id uuid,p_reserved_tokens integer,p_crew_requests integer,p_crew_tokens integer,
 p_session_requests integer,p_minute_requests integer,p_global_requests integer,p_global_tokens integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_hash text;v_id uuid:=gen_random_uuid();v_day date:=(now() at time zone 'UTC')::date;
 v_global_requests bigint;v_global_tokens bigint;v_crew_requests bigint;v_crew_tokens bigint;
 v_session_requests bigint;v_minute_requests bigint;v_concurrent bigint;
begin
 if p_session_id is null or p_reserved_tokens is null or p_reserved_tokens<1
 or p_crew_requests is null or p_crew_requests<1 or p_crew_tokens is null or p_crew_tokens<1
 or p_session_requests is null or p_session_requests<1 or p_minute_requests is null or p_minute_requests<1
 or p_global_requests is null or p_global_requests<1 or p_global_tokens is null or p_global_tokens<1
 then raise exception 'Invalid crew budget configuration'; end if;
 -- Shared with the passenger reservation RPC: one atomic overall spending calculation.
 perform pg_advisory_xact_lock(826401825001::bigint);
 select visitor_hash into v_hash from public.noor_crew_sessions
 where id=p_session_id and expires_at>now() for update;
 if not found then return jsonb_build_object('status','missing'); end if;
 select count(*),coalesce(sum(coalesce(actual_tokens,reserved_tokens)),0)
 into v_global_requests,v_global_tokens from public.noor_usage_events where day=v_day and kind='claude';
 select count(*),coalesce(sum(coalesce(actual_tokens,reserved_tokens)),0)
 into v_crew_requests,v_crew_tokens from public.noor_usage_events where day=v_day and kind='claude' and crew_session_id is not null;
 select count(*),count(*) filter (where created_at>now()-interval '1 minute'),
 count(*) filter (where state='reserved') into v_session_requests,v_minute_requests,v_concurrent
 from public.noor_usage_events where kind='claude' and crew_session_id=p_session_id;
 if v_global_requests>=p_global_requests or v_global_tokens+p_reserved_tokens>p_global_tokens then return jsonb_build_object('status','limit','scope','global'); end if;
 if v_crew_requests>=p_crew_requests or v_crew_tokens+p_reserved_tokens>p_crew_tokens then return jsonb_build_object('status','limit','scope','crew'); end if;
 if v_session_requests>=p_session_requests then return jsonb_build_object('status','limit','scope','session'); end if;
 if v_minute_requests>=p_minute_requests then return jsonb_build_object('status','limit','scope','rate'); end if;
 if v_concurrent>0 then return jsonb_build_object('status','limit','scope','concurrent'); end if;
 insert into public.noor_usage_events(id,day,visitor_hash,kind,state,reserved_tokens,crew_session_id)
 values(v_id,v_day,v_hash,'claude','reserved',p_reserved_tokens,p_session_id);
 return jsonb_build_object('status','ok','id',v_id);
end; $$;

create or replace function public.noor_settle_crew_model_call(p_session_id uuid,p_id uuid,p_actual_tokens integer,p_state text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_state is null or p_state not in ('done','uncertain') or p_actual_tokens<0
 or (p_state='uncertain' and p_actual_tokens is not null) then raise exception 'Invalid settlement'; end if;
 perform pg_advisory_xact_lock(826401825001::bigint);
 update public.noor_usage_events set state=p_state,actual_tokens=p_actual_tokens
 where id=p_id and crew_session_id=p_session_id and kind='claude' and state='reserved';
 return found;
end; $$;
revoke all on function public.noor_reserve_crew_model_call(uuid,integer,integer,integer,integer,integer,integer,integer) from public,anon,authenticated;
revoke all on function public.noor_settle_crew_model_call(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.noor_reserve_crew_model_call(uuid,integer,integer,integer,integer,integer,integer,integer) to service_role;
grant execute on function public.noor_settle_crew_model_call(uuid,uuid,integer,text) to service_role;

-- Extend the already scheduled daily retention routine, preserving every
-- existing cleanup statement and retaining all historical usage records.
create or replace function public.noor_prune_data()
returns void language plpgsql security definer set search_path='' as $$
begin
 delete from public.noor_email_verifications where created_at < now() - interval '1 day';
 update public.noor_email_jobs set email=null,subject=null,body=null,review_hash=null
 where email is not null and status in ('sent','failed','cancelled','unknown')
 and coalesce(sent_at,failed_at,cancelled_at,confirmed_at) < now() - interval '30 days';
 delete from public.noor_email_events where at < now() - interval '90 days';
 delete from public.noor_usage_events where created_at < now() - interval '30 days';
 delete from public.noor_crew_sessions where expires_at < now();
end; $$;
revoke all on function public.noor_prune_data() from public,anon,authenticated;
grant execute on function public.noor_prune_data() to service_role;
notify pgrst,'reload schema';
