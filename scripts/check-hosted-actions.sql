-- Caller must wrap migration and/or checks in a transaction that rolls back.
do $$
declare s uuid:=gen_random_uuid();state jsonb;
begin
 assert not has_function_privilege('anon','public.noor_read_demo_actions(uuid)','execute');
 assert not has_function_privilege('authenticated','public.noor_commit_demo_actions(uuid,bigint,jsonb)','execute');
 assert has_function_privilege('service_role','public.noor_commit_demo_actions(uuid,bigint,jsonb)','execute');
 insert into public.noor_demo_sessions(id,visitor_hash) values(s,repeat('b',64));
 state:=public.noor_read_demo_actions(s);
 assert state->>'status'='ok' and (state->>'version')::integer=0;
 assert public.noor_commit_demo_actions(s,0,'{"crew":{"draft":null,"requests":[]}}')='ok';
 assert public.noor_commit_demo_actions(s,0,'{}')='conflict','Stale write accepted';
 assert public.noor_read_demo_actions(s)#>'{state,crew,requests}'='[]'::jsonb;
 update public.noor_demo_sessions set active_at=now()-interval '16 minutes' where id=s;
 assert public.noor_read_demo_actions(s)->>'status'='missing','Expired read accepted';
 assert public.noor_commit_demo_actions(s,1,'{}')='missing','Expired write accepted';
end $$;
