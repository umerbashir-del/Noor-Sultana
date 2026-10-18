-- Run inside BEGIN/ROLLBACK after 20261018072000_noor_crew_claude_budget.sql.
-- Uses fresh identities and preserves every existing usage record.
do $$
declare
 s uuid:=gen_random_uuid();
 r jsonb;r2 jsonb;
 global_calls bigint;global_tokens bigint;crew_calls bigint;crew_tokens bigint;
begin
 assert not has_function_privilege('anon','public.noor_reserve_crew_model_call(uuid,integer,integer,integer,integer,integer,integer,integer)','execute');
 assert not has_function_privilege('authenticated','public.noor_settle_crew_model_call(uuid,uuid,integer,text)','execute');
 assert has_function_privilege('service_role','public.noor_reserve_crew_model_call(uuid,integer,integer,integer,integer,integer,integer,integer)','execute');
 select count(*),coalesce(sum(coalesce(actual_tokens,reserved_tokens)),0) into global_calls,global_tokens
 from public.noor_usage_events where day=(now() at time zone 'UTC')::date and kind='claude';
 select count(*),coalesce(sum(coalesce(actual_tokens,reserved_tokens)),0) into crew_calls,crew_tokens
 from public.noor_usage_events where day=(now() at time zone 'UTC')::date and kind='claude' and crew_session_id is not null;
 insert into public.noor_crew_sessions(id,visitor_hash) values(s,repeat('f',64));
 r:=public.noor_reserve_crew_model_call(s,1000,crew_calls::integer+10,crew_tokens::integer+1500,40,6,global_calls::integer+10,global_tokens::integer+1500);
 assert r->>'status'='ok','Crew reservation failed';
 assert exists(select 1 from public.noor_usage_events where id=(r->>'id')::uuid and crew_session_id=s and kind='claude'),'Crew reservation did not reach shared ledger';
 r2:=public.noor_reserve_crew_model_call(s,1000,crew_calls::integer+10,crew_tokens::integer+1500,40,6,global_calls::integer+10,global_tokens::integer+1500);
 assert r2->>'status'='limit' and r2->>'scope'='global','Shared global reservation did not prevent overdraw';
 assert public.noor_settle_crew_model_call(s,(r->>'id')::uuid,100,'done'),'Crew settlement failed';
 r2:=public.noor_reserve_crew_model_call(s,1000,crew_calls::integer+10,crew_tokens::integer+1500,40,6,global_calls::integer+10,global_tokens::integer+1500);
 assert r2->>'status'='ok','Actual usage did not release unused capacity';
 assert public.noor_settle_crew_model_call(s,(r2->>'id')::uuid,null,'uncertain'),'Uncertain reservation was not retained';
 r:=public.noor_reserve_crew_model_call(s,1000,crew_calls::integer+10,crew_tokens::integer+1500,40,6,global_calls::integer+10,global_tokens::integer+1500);
 assert r->>'status'='limit' and r->>'scope'='global','Uncertain usage allowed overdraw';
end $$;
