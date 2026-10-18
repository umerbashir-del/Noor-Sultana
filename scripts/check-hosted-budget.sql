-- Run after the hosted-budget migration, inside a transaction that will roll back.
do $$
declare
 s uuid:=gen_random_uuid();s2 uuid:=gen_random_uuid();r jsonb;r2 jsonb;before_tokens bigint;before_calls bigint;
begin
 assert not has_function_privilege('anon','public.noor_reserve_demo_model_call(uuid,integer,integer,integer,integer,integer)','execute');
 assert not has_function_privilege('authenticated','public.noor_settle_demo_model_call(uuid,uuid,integer,text)','execute');
 assert has_function_privilege('service_role','public.noor_reserve_demo_model_call(uuid,integer,integer,integer,integer,integer)','execute');
 select count(*),coalesce(sum(coalesce(actual_tokens,reserved_tokens)),0) into before_calls,before_tokens from public.noor_usage_events where day=(now() at time zone 'UTC')::date and kind='claude';
 insert into public.noor_demo_sessions(id,visitor_hash) values(s,repeat('a',64));
 r:=public.noor_reserve_demo_model_call(s,1000,1000000,before_calls::integer+10,1000000,before_tokens::integer+1500);
 assert r->>'status'='ok','Initial reservation failed';
 r2:=public.noor_reserve_demo_model_call(s,1000,1000000,before_calls::integer+10,1000000,before_tokens::integer+1500);
 assert r2->>'status'='limit' and r2->>'scope'='global','Reserved tokens did not block overdraw';
 assert public.noor_settle_demo_model_call(s,(r->>'id')::uuid,100,'done'),'Actual usage settlement failed';
 r2:=public.noor_reserve_demo_model_call(s,1000,1000000,before_calls::integer+10,1000000,before_tokens::integer+1500);
 assert r2->>'status'='ok','Unused reservation capacity was not released';
 assert public.noor_settle_demo_model_call(s,(r2->>'id')::uuid,null,'uncertain'),'Uncertain usage was not retained';
 r:=public.noor_reserve_demo_model_call(s,1000,1000000,before_calls::integer+10,1000000,before_tokens::integer+1500);
 assert r->>'status'='limit','Uncertain usage failed to block overdraw';
 r:=public.noor_reserve_demo_model_call(s,1,1,before_calls::integer+10,1000000,before_tokens::integer+1000000);
 assert r->>'status'='limit' and r->>'scope'='visitor','Visitor request cap was not enforced';
 assert public.noor_complete_demo_call_v2(s,'Hello','Demo reply','{"version":1,"topics":[],"flightId":"CL204","preferences":{"language":"spanish"}}'::jsonb),'Session commit failed';
 assert (select memory#>>'{preferences,language}'='spanish' from public.noor_demo_sessions where id=s),'Server memory was not saved';
 update public.noor_demo_sessions set created_at=now()-interval '3 hours' where id=s;
 r:=public.noor_reserve_demo_model_call(s,1,1000000,before_calls::integer+10,1000000,before_tokens::integer+1000000);
 assert r->>'status'='missing','Expired session was accepted';
 delete from public.noor_demo_sessions where id=s;
 insert into public.noor_demo_sessions(id,visitor_hash) values(s2,repeat('a',64));
 r:=public.noor_reserve_demo_model_call(s2,1,1,before_calls::integer+10,1000000,before_tokens::integer+1000000);
 assert r->>'status'='limit' and r->>'scope'='visitor','Ending a conversation erased visitor spending';
end $$;
