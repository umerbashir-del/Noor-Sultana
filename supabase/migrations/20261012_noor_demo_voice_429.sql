-- Track each voice allowance reservation so a provider rejection can be refunded once.
create table if not exists public.noor_demo_voice_attempts (
  id uuid primary key,
  session_id uuid not null,
  day date not null,
  character_count integer not null check (character_count between 1 and 500),
  status text not null default 'reserved' check (status in ('reserved', 'released')),
  created_at timestamptz not null default now()
);
create index if not exists noor_demo_voice_attempts_created_at
  on public.noor_demo_voice_attempts (created_at);
alter table public.noor_demo_voice_attempts enable row level security;
revoke all on public.noor_demo_voice_attempts from anon, authenticated;
grant select, insert, update, delete on public.noor_demo_voice_attempts to service_role;

create or replace function public.noor_reserve_demo_voice_v2(
  p_id uuid, p_text text, p_reservation_id uuid
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_session public.noor_demo_sessions%rowtype;
  v_reply text;
  v_used integer;
  v_day date := (now() at time zone 'UTC')::date;
begin
  if p_reservation_id is null or p_text is null or length(p_text) < 1 or length(p_text) > 500 then
    return 'invalid';
  end if;
  select * into v_session from public.noor_demo_sessions
    where id = p_id and created_at > now() - interval '2 hours'
      and active_at > now() - interval '15 minutes'
    for update;
  if not found then return 'missing'; end if;
  if v_session.voice_calls >= 10 then return 'limit'; end if;
  select item->>'content' into v_reply
    from jsonb_array_elements(v_session.messages) with ordinality as entries(item, position)
    where item->>'role' = 'assistant'
    order by position desc limit 1;
  if v_reply is distinct from p_text then return 'invalid'; end if;
  if exists (select 1 from public.noor_demo_voice_attempts where id = p_reservation_id) then
    return 'invalid';
  end if;

  insert into public.noor_demo_voice_budget (day, used_characters)
    values (v_day, length(p_text))
    on conflict (day) do update
      set used_characters = public.noor_demo_voice_budget.used_characters + excluded.used_characters
      where public.noor_demo_voice_budget.used_characters + excluded.used_characters <= 20000
    returning used_characters into v_used;
  if v_used is null then return 'limit'; end if;
  update public.noor_demo_sessions set voice_calls = voice_calls + 1 where id = p_id;
  insert into public.noor_demo_voice_attempts (id, session_id, day, character_count)
    values (p_reservation_id, p_id, v_day, length(p_text));
  return 'ok';
end;
$$;
revoke all on function public.noor_reserve_demo_voice_v2(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.noor_reserve_demo_voice_v2(uuid, text, uuid) to service_role;

create or replace function public.noor_release_demo_voice(p_id uuid, p_reservation_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_attempt public.noor_demo_voice_attempts%rowtype;
begin
  select * into v_attempt from public.noor_demo_voice_attempts
    where id = p_reservation_id and session_id = p_id and status = 'reserved'
    for update;
  if not found then return false; end if;
  -- Match the reserve function's session-then-budget lock order.
  perform 1 from public.noor_demo_sessions where id = p_id for update;
  update public.noor_demo_voice_budget
    set used_characters = used_characters - v_attempt.character_count
    where day = v_attempt.day and used_characters >= v_attempt.character_count;
  if not found then raise exception 'Voice budget reservation is missing'; end if;
  update public.noor_demo_sessions set voice_calls = voice_calls - 1
    where id = p_id and voice_calls > 0;
  update public.noor_demo_voice_attempts set status = 'released'
    where id = p_reservation_id;
  return true;
end;
$$;
revoke all on function public.noor_release_demo_voice(uuid, uuid) from public, anon, authenticated;
grant execute on function public.noor_release_demo_voice(uuid, uuid) to service_role;

-- These records are only needed while requests or short-lived sessions may still be active.
select cron.schedule(
  'noor-demo-voice-attempts-prune',
  '0 1 * * *',
  $$delete from public.noor_demo_voice_attempts where created_at < now() - interval '2 days';$$
);
