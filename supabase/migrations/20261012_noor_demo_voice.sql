-- Limit hosted speech generation for the public demo.
alter table public.noor_demo_sessions
  add column if not exists voice_calls integer not null default 0
  check (voice_calls between 0 and 10);

create table if not exists public.noor_demo_voice_budget (
  day date primary key,
  used_characters integer not null default 0 check (used_characters between 0 and 20000)
);
alter table public.noor_demo_voice_budget enable row level security;
revoke all on public.noor_demo_voice_budget from anon, authenticated;
grant select, insert, update, delete on public.noor_demo_voice_budget to service_role;

create or replace function public.noor_reserve_demo_voice(p_id uuid, p_text text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_session public.noor_demo_sessions%rowtype;
  v_reply text;
  v_used integer;
begin
  if p_text is null or length(p_text) < 1 or length(p_text) > 500 then
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

  insert into public.noor_demo_voice_budget (day, used_characters)
    values ((now() at time zone 'UTC')::date, length(p_text))
    on conflict (day) do update
      set used_characters = public.noor_demo_voice_budget.used_characters + excluded.used_characters
      where public.noor_demo_voice_budget.used_characters + excluded.used_characters <= 20000
    returning used_characters into v_used;
  if v_used is null then return 'limit'; end if;
  update public.noor_demo_sessions set voice_calls = voice_calls + 1 where id = p_id;
  return 'ok';
end;
$$;
revoke all on function public.noor_reserve_demo_voice(uuid, text) from public, anon, authenticated;
grant execute on function public.noor_reserve_demo_voice(uuid, text) to service_role;
