-- Conversation-scoped demo actions; no real crew dispatch or external notifications.
alter table public.noor_demo_sessions
 add column if not exists demo_actions jsonb not null default '{}'::jsonb,
 add column if not exists actions_version bigint not null default 0;

create or replace function public.noor_read_demo_actions(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.noor_demo_sessions%rowtype;
begin
 select * into s from public.noor_demo_sessions where id=p_id
  and visitor_hash is not null and created_at>now()-interval '2 hours'
  and active_at>now()-interval '15 minutes';
 if not found then return jsonb_build_object('status','missing'); end if;
 return jsonb_build_object('status','ok','version',s.actions_version,'state',s.demo_actions);
end $$;

create or replace function public.noor_commit_demo_actions(p_id uuid,p_version bigint,p_state jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare s public.noor_demo_sessions%rowtype;
begin
 if jsonb_typeof(p_state) is distinct from 'object' or octet_length(p_state::text)>24000 then
  raise exception 'Invalid demo action state';
 end if;
 select * into s from public.noor_demo_sessions where id=p_id for update;
 if not found or s.visitor_hash is null or s.created_at<=now()-interval '2 hours'
  or s.active_at<=now()-interval '15 minutes' then return 'missing'; end if;
 if s.actions_version<>p_version then return 'conflict'; end if;
 update public.noor_demo_sessions set demo_actions=p_state,actions_version=actions_version+1 where id=p_id;
 return 'ok';
end $$;
revoke all on function public.noor_read_demo_actions(uuid) from public,anon,authenticated;
revoke all on function public.noor_commit_demo_actions(uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.noor_read_demo_actions(uuid) to service_role;
grant execute on function public.noor_commit_demo_actions(uuid,bigint,jsonb) to service_role;

notify pgrst,'reload schema';
