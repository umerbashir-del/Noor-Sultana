-- Additive security migration: preserve all existing sessions and usage events.
alter table public.noor_demo_sessions add column if not exists visitor_hash text;
alter table public.noor_demo_sessions add column if not exists memory jsonb not null default '{"version":1,"topics":[],"flightId":"CL204","preferences":{}}'::jsonb;
alter table public.noor_usage_events add column if not exists session_id uuid;
-- Deliberately no cascading FK: ending a session must never erase its spending.

create or replace function public.noor_reserve_demo_call(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session public.noor_demo_sessions%rowtype;
begin
 update public.noor_demo_sessions set calls=calls+1,active_at=now()
 where id=p_id and visitor_hash ~ '^[a-f0-9]{64}$' and calls<30
 and created_at>now()-interval '2 hours' and active_at>now()-interval '15 minutes'
 returning * into v_session;
 if found then return jsonb_build_object('status','ok','messages',v_session.messages,'memory',v_session.memory); end if;
 if exists(select 1 from public.noor_demo_sessions where id=p_id and calls>=30) then return jsonb_build_object('status','limit'); end if;
 return jsonb_build_object('status','missing');
end; $$;
revoke all on function public.noor_reserve_demo_call(uuid) from public,anon,authenticated;
grant execute on function public.noor_reserve_demo_call(uuid) to service_role;

create or replace function public.noor_complete_demo_call_v2(p_id uuid,p_message text,p_reply text,p_memory jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
 if jsonb_typeof(p_memory) is distinct from 'object' then raise exception 'Invalid session memory'; end if;
 update public.noor_demo_sessions set memory=p_memory,messages=(
  select coalesce(jsonb_agg(item order by position),'[]'::jsonb) from (
   select item,position from jsonb_array_elements(messages || jsonb_build_array(
    jsonb_build_object('role','user','content',left(p_message,500)),
    jsonb_build_object('role','assistant','content',left(p_reply,3200)))) with ordinality as entries(item,position)
   order by position desc limit 6
  ) recent
 ) where id=p_id and created_at>now()-interval '2 hours' and active_at>now()-interval '15 minutes';
 return found;
end; $$;
revoke all on function public.noor_complete_demo_call_v2(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.noor_complete_demo_call_v2(uuid,text,text,jsonb) to service_role;

create or replace function public.noor_reserve_demo_model_call(
 p_session_id uuid,p_reserved_tokens integer,p_visitor_requests integer,p_global_requests integer,p_visitor_tokens integer,p_global_tokens integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_visitor text;v_id uuid:=gen_random_uuid();v_day date:=(now() at time zone 'UTC')::date;
 v_global_requests bigint;v_global_tokens bigint;v_visitor_requests bigint;v_visitor_tokens bigint;
begin
 if p_session_id is null or p_reserved_tokens is null or p_reserved_tokens<1
 or p_visitor_requests is null or p_visitor_requests<1 or p_global_requests is null or p_global_requests<1
 or p_visitor_tokens is null or p_visitor_tokens<1 or p_global_tokens is null or p_global_tokens<1 then raise exception 'Invalid budget configuration'; end if;
 -- One transaction lock serializes all reservation/settlement arithmetic across instances.
 perform pg_advisory_xact_lock(826401825001::bigint);
 select visitor_hash into v_visitor from public.noor_demo_sessions where id=p_session_id
 and visitor_hash ~ '^[a-f0-9]{64}$' and created_at>now()-interval '2 hours' and active_at>now()-interval '15 minutes' for update;
 if not found then return jsonb_build_object('status','missing'); end if;
 select count(*),coalesce(sum(coalesce(actual_tokens,reserved_tokens)),0) into v_global_requests,v_global_tokens
 from public.noor_usage_events where day=v_day and kind='claude';
 select count(*),coalesce(sum(coalesce(actual_tokens,reserved_tokens)),0) into v_visitor_requests,v_visitor_tokens
 from public.noor_usage_events where day=v_day and kind='claude' and visitor_hash=v_visitor;
 if v_global_requests>=p_global_requests or v_global_tokens+p_reserved_tokens>p_global_tokens then return jsonb_build_object('status','limit','scope','global'); end if;
 if v_visitor_requests>=p_visitor_requests or v_visitor_tokens+p_reserved_tokens>p_visitor_tokens then return jsonb_build_object('status','limit','scope','visitor'); end if;
 insert into public.noor_usage_events(id,day,visitor_hash,kind,state,reserved_tokens,session_id)
 values(v_id,v_day,v_visitor,'claude','reserved',p_reserved_tokens,p_session_id);
 return jsonb_build_object('status','ok','id',v_id);
end; $$;
revoke all on function public.noor_reserve_demo_model_call(uuid,integer,integer,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.noor_reserve_demo_model_call(uuid,integer,integer,integer,integer,integer) to service_role;

create or replace function public.noor_settle_demo_model_call(p_session_id uuid,p_id uuid,p_actual_tokens integer,p_state text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
 if p_state is null or p_state not in ('done','uncertain') or p_actual_tokens<0 or (p_state='uncertain' and p_actual_tokens is not null) then raise exception 'Invalid settlement'; end if;
 perform pg_advisory_xact_lock(826401825001::bigint);
 update public.noor_usage_events set state=p_state,actual_tokens=p_actual_tokens
 where id=p_id and session_id=p_session_id and kind='claude' and state='reserved';
 return found;
end; $$;
revoke all on function public.noor_settle_demo_model_call(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.noor_settle_demo_model_call(uuid,uuid,integer,text) to service_role;
