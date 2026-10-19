-- Administrator-only verification. All test rows and temporary function changes roll back.
-- Exercise normal caps even during the presentation-day exception.
begin;
create or replace function public.noor_demo_unlimited_at(p_at timestamptz)
returns boolean language sql immutable set search_path = '' as $$ select false; $$;
do $$
declare
 s uuid:=gen_random_uuid();
 r jsonb;
 v text;
begin
 assert not has_function_privilege('anon','public.noor_reserve_demo_call(uuid)','execute');
 assert not has_function_privilege('authenticated','public.noor_reserve_demo_voice_v2(uuid,text,uuid)','execute');
 assert has_function_privilege('service_role','public.noor_reserve_demo_voice_v2(uuid,text,uuid)','execute');
 insert into public.noor_demo_sessions(id,visitor_hash,calls,voice_calls,messages)
 values(s,repeat('e',64),99,49,'[{"role":"assistant","content":"Boundary test."}]'::jsonb);
 r:=public.noor_reserve_demo_call(s);
 assert r->>'status'='ok','The 100th question must be accepted';
 r:=public.noor_reserve_demo_call(s);
 assert r->>'status'='limit','The 101st question must be rejected';
 -- Isolate session voice limits from real global usage without committing changes.
 insert into public.noor_demo_voice_budget(day,used_characters)
 values((now() at time zone 'UTC')::date,0)
 on conflict(day) do update set used_characters=0;
 v:=public.noor_reserve_demo_voice_v2(s,'Boundary test.',gen_random_uuid());
 assert v='ok','The 50th voice attempt must be accepted';
 v:=public.noor_reserve_demo_voice_v2(s,'Boundary test.',gen_random_uuid());
 assert v='limit','The 51st voice attempt must be rejected';
 update public.noor_demo_sessions set voice_calls=0 where id=s;
 update public.noor_demo_voice_budget set used_characters=20000 where day=(now() at time zone 'UTC')::date;
 v:=public.noor_reserve_demo_voice_v2(s,'Boundary test.',gen_random_uuid());
 assert v='limit','The existing global voice-character cap must remain';
 update public.noor_demo_sessions set active_at=now()-interval '16 minutes',calls=0 where id=s;
 r:=public.noor_reserve_demo_call(s);
 assert r->>'status'='missing','Idle session expiry must remain';
end $$;
rollback;
