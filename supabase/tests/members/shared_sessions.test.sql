-- Shared-computer idle clock (Story 2, AD-22): private.shared_sessions and
-- mark/renew/check/end_shared_session. Fixtures are rolled back.

begin;

set local role postgres;
set local search_path = "$user", public, extensions;

select plan(17);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
values ('00000000-0000-4000-0000-000000000000',
        '00000000-0000-4000-e100-00000000000a', 'authenticated',
        'authenticated', 'ss-a@example.com', '{}');

create function pg_temp.claims(p_session uuid)
returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object(
      'sub', '00000000-0000-4000-e100-00000000000a', 'role', 'authenticated',
      'session_id', p_session))::text, true);
end;
$$;

-- Run a query as `authenticated` and return its first column as text.
create function pg_temp.as_auth(p_call text)
returns text
language plpgsql as $$
declare
  v_out text;
begin
  set local role authenticated;
  execute p_call into v_out;
  set local role postgres;
  return v_out;
end;
$$;

create function pg_temp.backdate(p_session uuid, p_interval interval)
returns void
language sql as $$
  update private.shared_sessions
  set last_activity_at = now() - p_interval
  where session_id = p_session
$$;

-- Pins.
select is(
  (select bool_and(p.prosecdef and p.proconfig = array['search_path=""'])
   from pg_proc p
   where p.oid in ('public.mark_shared_session()'::regprocedure,
                   'public.renew_shared_session()'::regprocedure,
                   'public.check_session_idle()'::regprocedure,
                   'public.end_shared_session()'::regprocedure)),
  true, 'all four are security definer with an empty search_path');
select ok(
  (select p.prosrc ~* 'for update' from pg_proc p
   where p.oid = 'public.renew_shared_session()'::regprocedure),
  'renew locks the row FOR UPDATE');
select is(
  (select not has_table_privilege('authenticated', 'private.shared_sessions', 'select')),
  true, 'the table is not readable by authenticated');

-- Mark.
select pg_temp.claims('00000000-0000-4000-e100-0000000000a1');
select isnt(pg_temp.as_auth('select public.mark_shared_session()'), null,
  'mark returns a deadline');
select pg_temp.backdate('00000000-0000-4000-e100-0000000000a1', interval '10 minutes');
select pg_temp.as_auth('select public.mark_shared_session()');
select is(
  (select count(*)::int from private.shared_sessions
   where session_id = '00000000-0000-4000-e100-0000000000a1'
     and last_activity_at < now() - interval '9 minutes'),
  1, 'mark is idempotent: one row, clock untouched');

-- Check.
select is(
  (select pg_temp.as_auth('select expired::text from public.check_session_idle()')),
  'false', 'a 10-minute-idle session is not expired');
select pg_temp.backdate('00000000-0000-4000-e100-0000000000a1', interval '30 minutes');
select is(
  (select pg_temp.as_auth('select expired::text from public.check_session_idle()')),
  'false', 'exactly 30 minutes is not yet expired');
select pg_temp.backdate('00000000-0000-4000-e100-0000000000a1', interval '30 minutes 1 second');
select is(
  (select pg_temp.as_auth('select expired::text from public.check_session_idle()')),
  'true', '30 minutes and 1 second is expired');

-- Renew does not revive an expired row.
select pg_temp.as_auth('select public.renew_shared_session()');
select is(
  (select pg_temp.as_auth('select expired::text from public.check_session_idle()')),
  'true', 'renew leaves an expired session expired');

-- Renew moves an active clock.
select pg_temp.backdate('00000000-0000-4000-e100-0000000000a1', interval '20 minutes');
select pg_temp.as_auth('select public.renew_shared_session()');
select is(
  (select count(*)::int from private.shared_sessions
   where session_id = '00000000-0000-4000-e100-0000000000a1'
     and last_activity_at > now() - interval '1 minute'),
  1, 'renew moves an active clock to now');

-- A personal session: no row.
select pg_temp.claims('00000000-0000-4000-e100-0000000000b2');
select is(
  (select pg_temp.as_auth('select count(*)::text from public.check_session_idle()')),
  '0', 'check returns no rows for a personal session');
select is(pg_temp.as_auth('select public.renew_shared_session()::text'), null,
  'renew returns null for a personal session');

-- End deletes only its own session.
select pg_temp.claims('00000000-0000-4000-e100-0000000000b2');
select pg_temp.as_auth('select public.mark_shared_session()');
select pg_temp.as_auth('select public.end_shared_session()');
select is(
  (select array_agg(session_id::text order by session_id)
   from private.shared_sessions),
  array['00000000-0000-4000-e100-0000000000a1'],
  'end deletes its own row and leaves another session''s');

-- Ending an expired row leaves it expired.
select pg_temp.claims('00000000-0000-4000-e100-0000000000a1');
select pg_temp.backdate('00000000-0000-4000-e100-0000000000a1', interval '31 minutes');
select pg_temp.as_auth('select public.end_shared_session()');
select is(
  (select pg_temp.as_auth('select expired::text from public.check_session_idle()')),
  'true', 'ending an expired session leaves it expired');
select is(
  (select count(*)::int from private.shared_sessions
   where session_id = '00000000-0000-4000-e100-0000000000a1'),
  1, 'the expired row is still there');

-- No session_id is refused; anon cannot call.
select pg_temp.claims(null);
select throws_ok(
  $$select pg_temp.as_auth('select public.mark_shared_session()')$$,
  'P0001', 'auth.not_signed_in', 'mark without a session_id is refused');

set local role anon;
select throws_ok(
  $$select public.mark_shared_session()$$,
  '42501', null, 'anon is refused');

select * from finish();
rollback;
