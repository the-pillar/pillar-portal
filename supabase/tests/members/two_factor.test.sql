-- Two-factor step-up (Story 5.1, AD-22): private.recent_mfa,
-- private.can_reset_member_mfa, public.reset_member_mfa and the
-- can_reset_mfa column of member_capabilities. Accepted probes raise a
-- sentinel and roll back (see approval.test.sql); fixtures are rolled back.

begin;

set local role postgres;
set local search_path = "$user", public, extensions;

select plan(21);

create function pg_temp.new_member(p_id uuid, p_email text, p_position text)
returns void
language plpgsql as $$
begin
  insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
  values ('00000000-0000-4000-0000-000000000000', p_id, 'authenticated',
          'authenticated', p_email, '{}');
  if p_position is not null then
    insert into public.member_positions (member_id, position, is_primary)
    values (p_id, p_position, true);
  end if;
end;
$$;

create function pg_temp.factor(p_user uuid, p_type text, p_status text)
returns void
language sql as $$
  insert into auth.mfa_factors
    (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  values (gen_random_uuid(), p_user, gen_random_uuid()::text,
          p_type::auth.factor_type, p_status::auth.factor_status, now(), now())
$$;

-- A JWT amr claim with one entry of `method`, `p_minutes_ago` old.
create function pg_temp.amr(p_method text, p_minutes_ago int)
returns jsonb
language sql as $$
  select jsonb_build_array(jsonb_build_object(
    'method', p_method,
    'timestamp', extract(epoch from now() - make_interval(mins => p_minutes_ago))::bigint))
$$;

create function pg_temp.claims(p_caller uuid, p_amr jsonb)
returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object(
      'sub', p_caller, 'role', 'authenticated', 'amr', p_amr))::text, true);
end;
$$;

create function pg_temp.attempt(p_caller uuid, p_amr jsonb, p_call text)
returns text
language plpgsql as $$
begin
  perform pg_temp.claims(p_caller, p_amr);
  begin
    set local role authenticated;
    execute p_call;
    raise exception using errcode = 'P0001', message = 'probe.accepted';
  exception when others then
    return case when sqlerrm = 'probe.accepted' then 'ok'
                else sqlstate || ' ' || sqlerrm end;
  end;
end;
$$;

create function pg_temp.run_as(p_caller uuid, p_amr jsonb, p_call text)
returns text
language plpgsql as $$
declare
  v_out text;
begin
  perform pg_temp.claims(p_caller, p_amr);
  set local role authenticated;
  execute p_call into v_out;
  set local role postgres;
  return v_out;
end;
$$;

-- A: admin (caller), B: admin with a verified factor, C: admin with no
-- factor, D: staff with a verified factor, E: deactivated former admin with
-- a verified factor, F: admin whose only factor is unverified, G: staff
-- caller, H: deactivated former admin (caller).
select pg_temp.new_member('00000000-0000-4000-e000-00000000000a', 'tf-a@example.com', 'sports_editor');
select pg_temp.new_member('00000000-0000-4000-e000-00000000000b', 'tf-b@example.com', 'sports_editor');
select pg_temp.new_member('00000000-0000-4000-e000-00000000000c', 'tf-c@example.com', 'sports_editor');
select pg_temp.new_member('00000000-0000-4000-e000-00000000000d', 'tf-d@example.com', 'staff_writer');
select pg_temp.new_member('00000000-0000-4000-e000-00000000000e', 'tf-e@example.com', 'sports_editor');
select pg_temp.new_member('00000000-0000-4000-e000-00000000000f', 'tf-f@example.com', 'sports_editor');
select pg_temp.new_member('00000000-0000-4000-e000-000000000010', 'tf-g@example.com', 'staff_writer');
select pg_temp.new_member('00000000-0000-4000-e000-000000000011', 'tf-h@example.com', 'sports_editor');

-- I: pending, J: declined (neither has a position); both hold a verified factor.
select pg_temp.new_member('00000000-0000-4000-e000-000000000012', 'tf-i@example.com', null);
select pg_temp.new_member('00000000-0000-4000-e000-000000000013', 'tf-j@example.com', null);
update public.members set declined_at = now()
where id = '00000000-0000-4000-e000-000000000013';

update public.members set deactivated_at = now()
where id in ('00000000-0000-4000-e000-00000000000e',
             '00000000-0000-4000-e000-000000000011');

select pg_temp.factor('00000000-0000-4000-e000-00000000000a', 'totp', 'verified');
select pg_temp.factor('00000000-0000-4000-e000-00000000000b', 'totp', 'verified');
select pg_temp.factor('00000000-0000-4000-e000-00000000000b', 'phone', 'verified');
select pg_temp.factor('00000000-0000-4000-e000-00000000000d', 'totp', 'verified');
select pg_temp.factor('00000000-0000-4000-e000-00000000000e', 'totp', 'verified');
select pg_temp.factor('00000000-0000-4000-e000-00000000000f', 'totp', 'unverified');
select pg_temp.factor('00000000-0000-4000-e000-000000000012', 'totp', 'verified');
select pg_temp.factor('00000000-0000-4000-e000-000000000013', 'totp', 'verified');

-- Pins.

select is(
  (select not p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""']
   from pg_proc p where p.oid = 'private.recent_mfa()'::regprocedure),
  true, 'recent_mfa is security invoker, stable, empty search_path');
select is(
  (select p.prosecdef and p.proconfig = array['search_path=""']
   from pg_proc p where p.oid = 'public.reset_member_mfa(uuid)'::regprocedure),
  true, 'reset_member_mfa is security definer with an empty search_path');
select ok(
  (select p.prosrc ~* 'for update' from pg_proc p
   where p.oid = 'public.reset_member_mfa(uuid)'::regprocedure),
  'reset_member_mfa locks the target FOR UPDATE');
select is(
  (select not has_function_privilege('authenticated', 'private.recent_mfa()', 'execute')),
  true, 'recent_mfa is granted to no API role');

-- recent_mfa.

select pg_temp.claims('00000000-0000-4000-e000-00000000000a', pg_temp.amr('totp', 5));
select is(private.recent_mfa(), true, 'a totp entry from 5 minutes ago is recent');
select pg_temp.claims('00000000-0000-4000-e000-00000000000a', pg_temp.amr('totp', 20));
select is(private.recent_mfa(), false, 'a totp entry from 20 minutes ago is not');
select pg_temp.claims('00000000-0000-4000-e000-00000000000a', pg_temp.amr('oauth', 1));
select is(private.recent_mfa(), false, 'an OAuth-only session is not');
select pg_temp.claims('00000000-0000-4000-e000-00000000000a', null);
select is(private.recent_mfa(), false, 'no amr claim is not');
select pg_temp.claims('00000000-0000-4000-e000-00000000000a', '"totp"'::jsonb);
select is(private.recent_mfa(), false, 'a non-array amr is not');
select pg_temp.claims('00000000-0000-4000-e000-00000000000a',
  '[{"method": "totp", "timestamp": "soon"}, "totp"]'::jsonb);
select is(private.recent_mfa(), false, 'malformed amr entries are not');

-- reset_member_mfa.

select is(
  array[
    pg_temp.attempt('00000000-0000-4000-e000-00000000000a', pg_temp.amr('totp', 20),
      $q$ select public.reset_member_mfa('00000000-0000-4000-e000-00000000000b') $q$),
    pg_temp.attempt('00000000-0000-4000-e000-00000000000a', pg_temp.amr('oauth', 1),
      $q$ select public.reset_member_mfa('00000000-0000-4000-e000-00000000000b') $q$),
    pg_temp.attempt('00000000-0000-4000-e000-00000000000a', null,
      $q$ select public.reset_member_mfa('00000000-0000-4000-e000-00000000000b') $q$)
  ],
  array['P0001 auth.step_up_required', 'P0001 auth.step_up_required',
        'P0001 auth.step_up_required'],
  'a stale, OAuth-only or missing code is refused');

select is(
  array[
    pg_temp.attempt('00000000-0000-4000-e000-000000000010', pg_temp.amr('totp', 1),
      $q$ select public.reset_member_mfa('00000000-0000-4000-e000-00000000000b') $q$),
    pg_temp.attempt('00000000-0000-4000-e000-000000000011', pg_temp.amr('totp', 1),
      $q$ select public.reset_member_mfa('00000000-0000-4000-e000-00000000000b') $q$)
  ],
  array['P0001 members.not_admin', 'P0001 auth.not_active'],
  'staff are not admins and a deactivated former admin is not active');

select is(
  array[
    pg_temp.attempt('00000000-0000-4000-e000-00000000000a', pg_temp.amr('totp', 1),
      $q$ select public.reset_member_mfa('00000000-0000-4000-e000-00000000000a') $q$),
    pg_temp.attempt('00000000-0000-4000-e000-00000000000a', pg_temp.amr('totp', 1),
      $q$ select public.reset_member_mfa('00000000-0000-4000-e000-0000000000ff') $q$),
    pg_temp.attempt('00000000-0000-4000-e000-00000000000a', pg_temp.amr('totp', 1),
      $q$ select public.reset_member_mfa('00000000-0000-4000-e000-00000000000c') $q$),
    pg_temp.attempt('00000000-0000-4000-e000-00000000000a', pg_temp.amr('totp', 1),
      $q$ select public.reset_member_mfa('00000000-0000-4000-e000-00000000000d') $q$),
    pg_temp.attempt('00000000-0000-4000-e000-00000000000a', pg_temp.amr('totp', 1),
      $q$ select public.reset_member_mfa('00000000-0000-4000-e000-00000000000e') $q$),
    pg_temp.attempt('00000000-0000-4000-e000-00000000000a', pg_temp.amr('totp', 1),
      $q$ select public.reset_member_mfa('00000000-0000-4000-e000-00000000000f') $q$)
  ],
  array['P0001 members.reset_own_factor', 'P0001 members.not_found',
        'P0001 members.stale', 'P0001 members.stale', 'P0001 members.stale',
        'P0001 members.stale'],
  'own factor, a missing target, and targets with no verified factor, staff or deactivated are refused');

-- can_reset_mfa agrees with the command (fresh code) for each pair.

create temp table matrix (caller uuid, target uuid, result text, can_reset boolean);

do $$
declare
  c uuid;
  t uuid;
begin
  foreach c in array array[
    '00000000-0000-4000-e000-00000000000a',
    '00000000-0000-4000-e000-00000000000b',
    '00000000-0000-4000-e000-000000000010',
    '00000000-0000-4000-e000-000000000011',
    '00000000-0000-4000-e000-000000000012',
    '00000000-0000-4000-e000-000000000013']::uuid[]
  loop
    foreach t in array array[
      '00000000-0000-4000-e000-00000000000a',
      '00000000-0000-4000-e000-00000000000b',
      '00000000-0000-4000-e000-00000000000c',
      '00000000-0000-4000-e000-00000000000d',
      '00000000-0000-4000-e000-00000000000e',
      '00000000-0000-4000-e000-00000000000f',
      '00000000-0000-4000-e000-000000000012',
      '00000000-0000-4000-e000-000000000013']::uuid[]
    loop
      insert into matrix values (c, t,
        pg_temp.attempt(c, pg_temp.amr('totp', 1),
          format($q$ select public.reset_member_mfa(%L) $q$, t)),
        coalesce(pg_temp.run_as(c, pg_temp.amr('totp', 1), format(
          $q$ select (select mc.can_reset_mfa from public.member_capabilities(array[%L::uuid]) mc limit 1)::text $q$, t
        ))::boolean, false));
    end loop;
  end loop;
  perform set_config('request.jwt.claims', '', true);
end
$$;

select is(
  (select count(*) from matrix where (result = 'ok') is distinct from can_reset),
  0::bigint, 'can_reset_mfa equals "the command accepts" for every caller and target');
select is(
  (select array_agg(target::text order by target) from matrix
   where can_reset and caller = '00000000-0000-4000-e000-00000000000a'),
  array['00000000-0000-4000-e000-00000000000b'],
  'admin A may reset only B');
select is(
  (select count(*) from matrix where can_reset and caller = '00000000-0000-4000-e000-000000000010'),
  0::bigint, 'staff are offered no reset');

select is(
  array[
    pg_temp.attempt('00000000-0000-4000-e000-000000000012', pg_temp.amr('totp', 1),
      $q$ select public.reset_member_mfa('00000000-0000-4000-e000-00000000000b') $q$),
    pg_temp.attempt('00000000-0000-4000-e000-000000000013', pg_temp.amr('totp', 1),
      $q$ select public.reset_member_mfa('00000000-0000-4000-e000-00000000000b') $q$)
  ],
  array['P0001 auth.not_active', 'P0001 auth.not_active'],
  'a pending and a declined caller get auth.not_active');
select is(
  (select count(*) from matrix where can_reset
     and caller in ('00000000-0000-4000-e000-000000000011',
                    '00000000-0000-4000-e000-000000000012',
                    '00000000-0000-4000-e000-000000000013')),
  0::bigint, 'deactivated, pending and declined callers are offered no reset');

-- A success: B's TOTP factors go, other factors stay, one activity row.

select is(
  pg_temp.attempt('00000000-0000-4000-e000-00000000000a', pg_temp.amr('totp', 5),
    $q$ select public.reset_member_mfa('00000000-0000-4000-e000-00000000000b') $q$),
  'ok', 'a fresh code resets');

select pg_temp.claims('00000000-0000-4000-e000-00000000000a', pg_temp.amr('totp', 5));
set local role authenticated;
select public.reset_member_mfa('00000000-0000-4000-e000-00000000000b');
set local role postgres;

select is(
  (select array_agg(f.factor_type::text) from auth.mfa_factors f
   where f.user_id = '00000000-0000-4000-e000-00000000000b'),
  array['phone'], 'B''s TOTP factors are deleted, others kept');

select is(
  (select count(*) from public.activity a
   where a.entity_type = 'member' and a.action = 'mfa_reset'
     and a.entity_id = '00000000-0000-4000-e000-00000000000b'
     and a.actor_id = '00000000-0000-4000-e000-00000000000a'),
  1::bigint, 'the reset logs one mfa_reset activity row');

select * from finish();

rollback;
