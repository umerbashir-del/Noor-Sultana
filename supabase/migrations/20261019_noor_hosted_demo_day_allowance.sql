-- October 19, 2026 (America/New_York): lift hosted demo prompt and voice
-- allowances until local midnight, then automatically resume normal limits.
-- Usage rows, session counters, and voice attempts continue to be recorded.
create or replace function public.noor_demo_unlimited_at(p_at timestamptz)
returns boolean language sql immutable set search_path = '' as $$
 select p_at >= '2026-10-19T04:00:00Z'::timestamptz
    and p_at < '2026-10-20T04:00:00Z'::timestamptz;
$$;
revoke all on function public.noor_demo_unlimited_at(timestamptz) from public, anon, authenticated;
grant execute on function public.noor_demo_unlimited_at(timestamptz) to service_role;

-- Relax the storage checks so today's counted usage can exceed demo defaults.
-- The functions below enforce the original caps outside the dated window.
alter table public.noor_demo_sessions drop constraint if exists noor_demo_sessions_calls_check;
alter table public.noor_demo_sessions add constraint noor_demo_sessions_calls_check check (calls >= 0);
alter table public.noor_demo_sessions drop constraint if exists noor_demo_sessions_voice_calls_check;
alter table public.noor_demo_sessions add constraint noor_demo_sessions_voice_calls_check check (voice_calls >= 0);
alter table public.noor_demo_voice_budget drop constraint if exists noor_demo_voice_budget_used_characters_check;
alter table public.noor_demo_voice_budget add constraint noor_demo_voice_budget_used_characters_check check (used_characters >= 0);

create or replace function public.noor_reserve_demo_call(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session public.noor_demo_sessions%rowtype;
begin
 update public.noor_demo_sessions set calls=calls+1,active_at=now()
 where id=p_id and visitor_hash ~ '^[a-f0-9]{64}$'
 and (calls<30 or public.noor_demo_unlimited_at(now()))
 and created_at>now()-interval '2 hours' and active_at>now()-interval '15 minutes'
 returning * into v_session;
 if found then return jsonb_build_object('status','ok','messages',v_session.messages,'memory',v_session.memory); end if;
 if exists(select 1 from public.noor_demo_sessions where id=p_id and calls>=30 and not public.noor_demo_unlimited_at(now())) then return jsonb_build_object('status','limit'); end if;
 return jsonb_build_object('status','missing');
end; $$;
revoke all on function public.noor_reserve_demo_call(uuid) from public,anon,authenticated;
grant execute on function public.noor_reserve_demo_call(uuid) to service_role;

create or replace function public.noor_reserve_demo_voice_v2(p_id uuid,p_text text,p_reservation_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
 v_session public.noor_demo_sessions%rowtype;
 v_reply text;
 v_used integer;
 v_day date:=(now() at time zone 'UTC')::date;
begin
 if p_reservation_id is null or p_text is null or length(p_text)<1 or length(p_text)>500 then return 'invalid'; end if;
 select * into v_session from public.noor_demo_sessions
 where id=p_id and created_at>now()-interval '2 hours' and active_at>now()-interval '15 minutes' for update;
 if not found then return 'missing'; end if;
 if v_session.voice_calls>=10 and not public.noor_demo_unlimited_at(now()) then return 'limit'; end if;
 select item->>'content' into v_reply
 from jsonb_array_elements(v_session.messages) with ordinality as entries(item,position)
 where item->>'role'='assistant' order by position desc limit 1;
 if v_reply is distinct from p_text then return 'invalid'; end if;
 if exists(select 1 from public.noor_demo_voice_attempts where id=p_reservation_id) then return 'invalid'; end if;
 insert into public.noor_demo_voice_budget(day,used_characters) values(v_day,length(p_text))
 on conflict(day) do update set used_characters=public.noor_demo_voice_budget.used_characters+excluded.used_characters
 where public.noor_demo_unlimited_at(now())
 or public.noor_demo_voice_budget.used_characters+excluded.used_characters<=20000
 returning used_characters into v_used;
 if v_used is null then return 'limit'; end if;
 update public.noor_demo_sessions set voice_calls=voice_calls+1 where id=p_id;
 insert into public.noor_demo_voice_attempts(id,session_id,day,character_count)
 values(p_reservation_id,p_id,v_day,length(p_text));
 return 'ok';
end; $$;
revoke all on function public.noor_reserve_demo_voice_v2(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.noor_reserve_demo_voice_v2(uuid,text,uuid) to service_role;
notify pgrst,'reload schema';
