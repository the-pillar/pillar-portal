-- members_shared_sessions: the shared-computer idle clock (Story 2, PRD 1.7,
-- AD-22).
--
-- A session ticked "This is a shared computer" at sign-in is recorded here,
-- keyed by the JWT `session_id`. The 30-minute idle limit lives in Postgres
-- and is written once, in `private.shared_session_limit()`. Expiry means
-- strictly more than the limit since `last_activity_at`. Only
-- `renew_shared_session()` moves the clock, and an expired row is never
-- revived. These commands work for any signed-in user (the AD-5 exception:
-- a shared computer is not only for active members) and read only
-- `auth.jwt() ->> 'session_id'`.

create table private.shared_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_activity_at timestamptz not null default now()
);

alter table private.shared_sessions enable row level security;

revoke all on table private.shared_sessions
  from public, anon, authenticated, service_role;

create index shared_sessions_user_id_idx on private.shared_sessions (user_id);

-- The one place the limit is written.
create function private.shared_session_limit()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '30 minutes'
$$;

revoke all on function private.shared_session_limit()
  from public, anon, authenticated, service_role;

-- The caller's session id, or null when the JWT carries none.
create function private.current_session_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(auth.jwt() ->> 'session_id', '')::uuid
$$;

revoke all on function private.current_session_id()
  from public, anon, authenticated, service_role;

-- Records the caller's session as shared and returns its deadline. Idempotent:
-- a second call keeps the row and its clock.
create function public.mark_shared_session()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid := private.current_session_id();
  v_user uuid := (select auth.uid());
  v_last timestamptz;
begin
  if v_session is null or v_user is null then
    raise exception using errcode = 'P0001', message = 'auth.not_signed_in';
  end if;

  insert into private.shared_sessions (session_id, user_id)
  values (v_session, v_user)
  on conflict (session_id) do nothing;

  select s.last_activity_at into v_last
  from private.shared_sessions s
  where s.session_id = v_session;

  return v_last + private.shared_session_limit();
end;
$$;

-- Moves the clock to now and returns the new deadline. No row (a personal
-- session): null. An expired row is left alone and its past deadline is
-- returned, so renewing never brings a session back.
create function public.renew_shared_session()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid := private.current_session_id();
  v_last timestamptz;
begin
  if v_session is null then
    raise exception using errcode = 'P0001', message = 'auth.not_signed_in';
  end if;

  select s.last_activity_at into v_last
  from private.shared_sessions s
  where s.session_id = v_session
  for update;

  if not found then
    return null;
  end if;

  if now() > v_last + private.shared_session_limit() then
    return v_last + private.shared_session_limit();
  end if;

  update private.shared_sessions s
  set last_activity_at = now()
  where s.session_id = v_session;

  return now() + private.shared_session_limit();
end;
$$;

-- Zero rows: a personal session (or none). Otherwise the deadline and whether
-- it has passed. Reads only; never moves the clock.
create function public.check_session_idle()
returns table (expires_at timestamptz, expired boolean)
language sql
security definer
stable
set search_path = ''
as $$
  select s.last_activity_at + private.shared_session_limit(),
         now() > s.last_activity_at + private.shared_session_limit()
  from private.shared_sessions s
  where s.session_id = private.current_session_id()
$$;

-- Manual sign-out only: forgets the caller's unexpired session. An idle sign-out leaves
-- the row, so a token that survives it still reads as expired.
create function public.end_shared_session()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid := private.current_session_id();
begin
  if v_session is null then
    raise exception using errcode = 'P0001', message = 'auth.not_signed_in';
  end if;

  -- An expired row stays (for the sweep): deleting it would make the session
  -- read as personal and let its holder revive it.
  delete from private.shared_sessions s
  where s.session_id = v_session
    and now() <= s.last_activity_at + private.shared_session_limit();
end;
$$;

revoke all on function
  public.mark_shared_session(),
  public.renew_shared_session(),
  public.check_session_idle(),
  public.end_shared_session()
  from public, anon, authenticated, service_role;

grant execute on function
  public.mark_shared_session(),
  public.renew_shared_session(),
  public.check_session_idle(),
  public.end_shared_session()
  to authenticated;
