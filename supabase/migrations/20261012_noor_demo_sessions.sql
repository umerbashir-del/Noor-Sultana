-- Short-lived passenger conversations for the Vercel text demo.
create table if not exists public.noor_demo_sessions (
  id uuid primary key,
  created_at timestamptz not null default now(),
  active_at timestamptz not null default now(),
  calls integer not null default 0 check (calls between 0 and 30),
  messages jsonb not null default '[]'::jsonb check (jsonb_typeof(messages) = 'array')
);

create index if not exists noor_demo_sessions_active_at on public.noor_demo_sessions(active_at);

alter table public.noor_demo_sessions enable row level security;
revoke all on public.noor_demo_sessions from anon, authenticated;
grant select, insert, update, delete on public.noor_demo_sessions to service_role;

create or replace function public.noor_reserve_demo_call(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_messages jsonb;
begin
  update public.noor_demo_sessions
    set calls = calls + 1, active_at = now()
    where id = p_id and calls < 30
      and created_at > now() - interval '2 hours'
      and active_at > now() - interval '15 minutes'
    returning messages into v_messages;
  if found then
    return jsonb_build_object('status', 'ok', 'messages', v_messages);
  end if;
  if exists (select 1 from public.noor_demo_sessions where id = p_id and calls >= 30) then
    return jsonb_build_object('status', 'limit');
  end if;
  return jsonb_build_object('status', 'missing');
end;
$$;
revoke all on function public.noor_reserve_demo_call(uuid) from public, anon, authenticated;
grant execute on function public.noor_reserve_demo_call(uuid) to service_role;

create or replace function public.noor_complete_demo_call(p_id uuid, p_message text, p_reply text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.noor_demo_sessions
    set messages = (
      select coalesce(jsonb_agg(item order by position), '[]'::jsonb)
      from (
        select item, position from jsonb_array_elements(
          messages || jsonb_build_array(
            jsonb_build_object('role', 'user', 'content', left(p_message, 500)),
            jsonb_build_object('role', 'assistant', 'content', left(p_reply, 2000))
          )
        ) with ordinality as entries(item, position)
        order by position desc limit 6
      ) recent
    )
    where id = p_id;
end;
$$;
revoke all on function public.noor_complete_demo_call(uuid, text, text) from public, anon, authenticated;
grant execute on function public.noor_complete_demo_call(uuid, text, text) to service_role;

-- Keep short-lived records even if a passenger closes the tab without ending a session.
create or replace function public.noor_prune_demo_sessions()
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.noor_demo_sessions
    where created_at < now() - interval '2 hours'
       or active_at < now() - interval '15 minutes';
end;
$$;
revoke all on function public.noor_prune_demo_sessions() from public, anon, authenticated;
grant execute on function public.noor_prune_demo_sessions() to service_role;
