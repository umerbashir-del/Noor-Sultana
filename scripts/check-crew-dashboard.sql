-- Caller wraps this verification in BEGIN/ROLLBACK.
do $$
declare s uuid:=gen_random_uuid();r uuid:=gen_random_uuid();before_version bigint;
begin
 assert not has_function_privilege('anon','public.noor_list_crew_requests()','execute');
 assert not has_function_privilege('authenticated','public.noor_update_crew_request(uuid,uuid,text,text)','execute');
 assert has_function_privilege('service_role','public.noor_list_crew_requests()','execute');
 insert into public.noor_demo_sessions(id,visitor_hash,demo_actions) values(s,repeat('c',64),jsonb_build_object('crew',jsonb_build_object('draft',jsonb_build_object('details','PRIVATE DRAFT'),'requests',jsonb_build_array(jsonb_build_object('id',r,'token','private-token','seat','12A','category','seat','details','DEMO TEST','status','submitted','createdAt',1)))));
 assert exists(select 1 from jsonb_array_elements(public.noor_list_crew_requests()) item where item->>'id'=r::text and not(item ? 'token'));
 assert public.noor_update_crew_request(s,r,'submitted','completed')='invalid';
 assert public.noor_update_crew_request(s,r,'submitted','acknowledged')='ok';
 assert public.noor_update_crew_request(s,r,'submitted','acknowledged')='ok';
 assert public.noor_update_crew_request(s,r,'submitted','in_progress')='conflict';
 assert public.noor_update_crew_request(s,r,'acknowledged','in_progress')='ok';
 assert public.noor_update_crew_request(s,r,'in_progress','completed')='ok';
 assert (select demo_actions#>>'{crew,requests,0,status}' from public.noor_demo_sessions where id=s)='completed';
 assert (select actions_version from public.noor_demo_sessions where id=s)=3;
 update public.noor_demo_sessions set active_at=now()-interval '16 minutes' where id=s;
 assert public.noor_update_crew_request(s,r,'submitted','acknowledged')='missing';
 assert not exists(select 1 from jsonb_array_elements(public.noor_list_crew_requests()) item where item->>'id'=r::text);
end $$;
