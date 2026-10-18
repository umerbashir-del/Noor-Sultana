-- Service-only demo crew queue; passenger sessions do not grant crew access.
create or replace function public.noor_list_crew_requests()
returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(item),'[]'::jsonb) from (
 select jsonb_build_object('sessionId',s.id,'id',r->>'id','seat',r->>'seat','category',r->>'category','details',r->>'details','status',r->>'status','createdAt',r->'createdAt','updatedAt',r->'updatedAt') as item
 from public.noor_demo_sessions s cross join lateral jsonb_array_elements(coalesce(s.demo_actions#>'{crew,requests}','[]'::jsonb)) r
 where s.visitor_hash is not null and s.created_at>now()-interval '2 hours' and s.active_at>now()-interval '15 minutes'
 and r->>'status' in ('submitted','acknowledged','in_progress','completed','cancelled')
 order by case when r->>'status' in ('completed','cancelled') then 1 else 0 end,r->>'seat',(r->>'createdAt')::bigint
 limit 200
 ) queue;
$$;
create or replace function public.noor_update_crew_request(p_session_id uuid,p_request_id uuid,p_expected_status text,p_status text)
returns text language plpgsql security definer set search_path='' as $$
declare s public.noor_demo_sessions%rowtype;item jsonb;position integer;current_status text;
begin
 if p_status is null or p_status not in ('acknowledged','in_progress','completed') then return 'invalid'; end if;
 select * into s from public.noor_demo_sessions where id=p_session_id for update;
 if not found or s.visitor_hash is null or s.created_at<=now()-interval '2 hours' or s.active_at<=now()-interval '15 minutes' then return 'missing'; end if;
 select value,ordinality::integer-1 into item,position from jsonb_array_elements(coalesce(s.demo_actions#>'{crew,requests}','[]'::jsonb)) with ordinality where value->>'id'=p_request_id::text;
 if item is null then return 'missing'; end if;
 current_status:=item->>'status';
 if current_status=p_status then return 'ok'; end if;
 if current_status is distinct from p_expected_status then return 'conflict'; end if;
 if not ((current_status='submitted' and p_status='acknowledged') or (current_status='acknowledged' and p_status='in_progress') or (current_status='in_progress' and p_status='completed')) then return 'invalid'; end if;
 item:=item||jsonb_build_object('status',p_status,'updatedAt',floor(extract(epoch from clock_timestamp())*1000)::bigint);
 update public.noor_demo_sessions set demo_actions=jsonb_set(demo_actions,array['crew','requests',position::text],item),actions_version=actions_version+1 where id=p_session_id;
 return 'ok';
end $$;
revoke all on function public.noor_list_crew_requests() from public,anon,authenticated;
revoke all on function public.noor_update_crew_request(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.noor_list_crew_requests() to service_role;
grant execute on function public.noor_update_crew_request(uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
