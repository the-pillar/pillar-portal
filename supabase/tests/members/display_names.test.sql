-- Display names (Story 8.2): set_member_name, member_capabilities,
-- private.can_rename_member, private.clean_name, the sign-up trigger's cap
-- and `google_name`, and the backfill. Pins; the caller matrix against every
-- kind of target; `can_rename` agreeing with "the command accepts" for every
-- caller and target pair; blank and length edges; what a success writes.
--
-- Accepted probes raise a sentinel and roll back (see approval.test.sql).
-- Fixtures are created here and rolled back. The backfill check covers every
-- member in the database, so it also runs against staging
-- (`supabase test db --linked`).

begin;

set local role postgres;
set local search_path = "$user", public, extensions;

select plan(26);

-- Fixtures.

create function pg_temp.new_member(p_id uuid, p_email text, p_position text, p_meta jsonb default '{}')
returns void
language plpgsql as $$
begin
  insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated',
          'authenticated', p_email, p_meta);
  if p_position is not null then
    insert into public.member_positions (member_id, position, is_primary)
    values (p_id, p_position, true);
  end if;
end;
$$;

create function pg_temp.attempt(p_caller uuid, p_call text)
returns text
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_caller, 'role', 'authenticated')::text, true);
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

create function pg_temp.run_as(p_caller uuid, p_call text)
returns text
language plpgsql as $$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_caller, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute p_call into v_out;
  set local role postgres;
  return v_out;
end;
$$;

-- Callers: d..01 pending, 02 declined, 03 deactivated former Head Layout
-- Artist, 04 active staff, 05 active admin. Targets: 11 pending, 12 declined,
-- 13 deactivated (pending role), 14 active staff; the admin (05) is a target
-- too, and ff.. is unknown.
select pg_temp.new_member('00000000-0000-4000-d000-000000000001', 'dn-pending@example.com', null);
select pg_temp.new_member('00000000-0000-4000-d000-000000000002', 'dn-declined@example.com', null);
select pg_temp.new_member('00000000-0000-4000-d000-000000000003', 'dn-deactivated@example.com', 'head_layout_artist');
select pg_temp.new_member('00000000-0000-4000-d000-000000000004', 'dn-staff@example.com', 'staff_layout_artist');
select pg_temp.new_member('00000000-0000-4000-d000-000000000005', 'dn-admin@example.com', 'sports_editor',
  '{"full_name": "ADMIN FIXTURE"}');
select pg_temp.new_member('00000000-0000-4000-d000-000000000011', 'dn-target-pending@example.com', null,
  '{"full_name": "TARGET PENDING"}');
select pg_temp.new_member('00000000-0000-4000-d000-000000000012', 'dn-target-declined@example.com', null);
select pg_temp.new_member('00000000-0000-4000-d000-000000000013', 'dn-target-deactivated@example.com', null);
select pg_temp.new_member('00000000-0000-4000-d000-000000000014', 'dn-target-active@example.com', 'staff_writer');

update public.members set declined_at = now()
where id in ('00000000-0000-4000-d000-000000000002',
             '00000000-0000-4000-d000-000000000012');
update public.members set deactivated_at = now()
where id in ('00000000-0000-4000-d000-000000000003',
             '00000000-0000-4000-d000-000000000013');

-- Pins.

select is(
  (select p.prosecdef and p.proconfig = array['search_path=""']
     and pg_get_userbyid(p.proowner) = 'postgres'
   from pg_proc p where p.oid = 'public.set_member_name(uuid, text)'::regprocedure),
  true, 'set_member_name is security definer, owned by postgres, empty search_path');
select ok(
  (select p.prosrc ~* 'for update' from pg_proc p
   where p.oid = 'public.set_member_name(uuid, text)'::regprocedure),
  'set_member_name locks the member FOR UPDATE');
select is(
  (select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""']
   from pg_proc p where p.oid = 'private.can_rename_member(uuid)'::regprocedure),
  true, 'can_rename_member is security definer, stable, empty search_path');
select is(
  (select not p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""']
   from pg_proc p where p.oid = 'public.member_capabilities(uuid[])'::regprocedure),
  true, 'member_capabilities is security invoker, stable, empty search_path');
select is(
  (select not has_function_privilege('authenticated', 'private.clean_name(text)', 'execute')
      and not has_function_privilege('anon', 'private.clean_name(text)', 'execute')),
  true, 'clean_name is granted to no API role');
select is(
  (select p.prosrc !~* 'auth\.users' from pg_proc p
   where p.oid = 'public.set_member_name(uuid, text)'::regprocedure),
  true, 'set_member_name never reads auth.users');

-- The caller matrix: each caller against the pending target.

create temp table callers (label text primary key, member_id uuid not null);
insert into callers values
  ('pending', '00000000-0000-4000-d000-000000000001'),
  ('declined', '00000000-0000-4000-d000-000000000002'),
  ('deactivated former Head', '00000000-0000-4000-d000-000000000003'),
  ('active staff', '00000000-0000-4000-d000-000000000004'),
  ('active admin', '00000000-0000-4000-d000-000000000005');

create temp table matrix (caller text, target text, result text, can_rename boolean);

do $$
declare
  c callers;
  t uuid;
  v_result text;
  v_can boolean;
begin
  for c in select * from callers loop
    foreach t in array array[
      '00000000-0000-4000-d000-000000000011',
      '00000000-0000-4000-d000-000000000012',
      '00000000-0000-4000-d000-000000000013',
      '00000000-0000-4000-d000-000000000014',
      '00000000-0000-4000-d000-000000000003',
      '00000000-0000-4000-d000-000000000005',
      '00000000-0000-4000-d000-0000000000ff']::uuid[]
    loop
      v_result := pg_temp.attempt(c.member_id,
        format($q$ select public.set_member_name(%L, 'New Name') $q$, t));
      v_can := coalesce(pg_temp.run_as(c.member_id, format(
        $q$ select (select mc.can_rename from public.member_capabilities(array[%L::uuid]) mc limit 1)::text $q$, t
      ))::boolean, false);
      insert into matrix values (c.label, t::text, v_result, v_can);
    end loop;
  end loop;
  perform set_config('request.jwt.claims', '', true);
end
$$;

select is(
  (select array_agg(result order by caller) from matrix where target like '%0011'),
  array['ok', 'P0001 members.not_admin', 'P0001 auth.not_active',
        'P0001 auth.not_active', 'P0001 auth.not_active'],
  'only an active admin renames: non-active callers get auth.not_active, staff members.not_admin');

select is(
  (select result from matrix where caller = 'active admin' and target like '%0014'),
  'ok', 'an active target is renamed');
select is(
  (select result from matrix where caller = 'active admin' and target like '%0005'),
  'ok', 'an admin renames themselves');
select is(
  (select result from matrix where caller = 'active admin' and target like '%0012'),
  'P0001 members.stale', 'a declined target is stale');
select is(
  (select result from matrix where caller = 'active admin' and target like '%0013'),
  'P0001 members.stale', 'a deactivated target is stale');
select is(
  (select array[result, can_rename::text] from matrix
   where caller = 'active admin' and target like '%d000-000000000003'),
  array['P0001 members.stale', 'false'],
  'a deactivated former Head (with a role) is stale and not offered a rename');
select is(
  (select result from matrix where caller = 'active admin' and target like '%00ff'),
  'P0001 members.not_found', 'an unknown target is not found');

select is(
  (select count(*) from matrix where (result = 'ok') is distinct from can_rename),
  0::bigint,
  'can_rename equals "the command accepts" for every caller and target');

select is(
  (select count(*) from matrix where can_rename and caller <> 'active admin'),
  0::bigint,
  'no caller but an active admin is offered a rename');

select is(
  pg_temp.run_as('00000000-0000-4000-d000-000000000004',
    $q$ select count(*)::text from public.member_capabilities(array[
      '00000000-0000-4000-d000-000000000004',
      '00000000-0000-4000-d000-000000000011',
      '00000000-0000-4000-d000-000000000005']::uuid[]) $q$),
  '1', 'a non-admin gets only their own row');

-- Blank and length edges, as the admin on the pending target.

select is(
  array[
    pg_temp.attempt('00000000-0000-4000-d000-000000000005',
      $q$ select public.set_member_name('00000000-0000-4000-d000-000000000011', null) $q$),
    pg_temp.attempt('00000000-0000-4000-d000-000000000005',
      $q$ select public.set_member_name('00000000-0000-4000-d000-000000000011', '') $q$),
    pg_temp.attempt('00000000-0000-4000-d000-000000000005',
      $q$ select public.set_member_name('00000000-0000-4000-d000-000000000011', '   ') $q$),
    pg_temp.attempt('00000000-0000-4000-d000-000000000005',
      $q$ select public.set_member_name('00000000-0000-4000-d000-000000000011', E' \t\n ') $q$)
  ],
  array['P0001 members.name_blank', 'P0001 members.name_blank',
        'P0001 members.name_blank', 'P0001 members.name_blank'],
  'null, empty, spaces and tabs are blank');

select is(
  array[
    pg_temp.attempt('00000000-0000-4000-d000-000000000005',
      format($q$ select public.set_member_name('00000000-0000-4000-d000-000000000011', %L) $q$, repeat('x', 100))),
    pg_temp.attempt('00000000-0000-4000-d000-000000000005',
      format($q$ select public.set_member_name('00000000-0000-4000-d000-000000000011', %L) $q$, repeat('x', 101))),
    pg_temp.attempt('00000000-0000-4000-d000-000000000005',
      format($q$ select public.set_member_name('00000000-0000-4000-d000-000000000011', %L) $q$, repeat('x', 100) || '   '))
  ],
  array['ok', 'P0001 members.name_too_long', 'ok'],
  '100 characters pass, 101 are too long, trailing space beyond 100 is trimmed first');

-- A success: stored trimmed, activity row, google_name untouched.

select is(
  pg_temp.run_as('00000000-0000-4000-d000-000000000005',
    $q$ select public.set_member_name('00000000-0000-4000-d000-000000000011', '  Axel Aranzado ') $q$),
  'Axel Aranzado', 'set_member_name returns the saved name');

select is(
  (select array[m.name, m.google_name, m.updated_by::text]
   from public.members m where m.id = '00000000-0000-4000-d000-000000000011'),
  array['Axel Aranzado', 'TARGET PENDING', '00000000-0000-4000-d000-000000000005'],
  'the name is stored trimmed, google_name is untouched, updated_by is the admin');

select is(
  (select count(*) from public.activity a
   where a.entity_type = 'member' and a.action = 'renamed'
     and a.entity_id = '00000000-0000-4000-d000-000000000011'
     and a.actor_id = '00000000-0000-4000-d000-000000000005'),
  1::bigint, 'the rename logs one activity row');

-- The sign-up trigger.

select pg_temp.new_member('00000000-0000-4000-d000-000000000021', 'dn-long@example.com', null,
  jsonb_build_object('full_name', repeat('x', 99) || ' ' || repeat('y', 150)));
select pg_temp.new_member('00000000-0000-4000-d000-000000000022', 'dn-local.part@example.com', null);
select pg_temp.new_member('00000000-0000-4000-d000-000000000023', 'dn-250@example.com', null,
  jsonb_build_object('full_name', repeat('x', 250)));

select is(
  (select array[char_length(m.name)::text, char_length(m.google_name)::text]
   from public.members m where m.id = '00000000-0000-4000-d000-000000000023'),
  array['100', '100'],
  'a 250-character Google name is cut to 100 in name and google_name');

select is(
  (select array[char_length(m.name)::text, (m.name = m.google_name)::text, (m.name ~ '\s$')::text]
   from public.members m where m.id = '00000000-0000-4000-d000-000000000021'),
  array['99', 'true', 'false'],
  'a long Google name is cut to 100 characters with no trailing space, in name and google_name');

select is(
  (select array[m.name, coalesce(m.google_name, '<null>')]
   from public.members m where m.id = '00000000-0000-4000-d000-000000000022'),
  array['dn-local.part', '<null>'],
  'with no name in the metadata, name is the email local part and google_name is null');

-- The backfill: no member whose metadata carries a name lacks a google_name.
-- (Not compared with the current metadata, which Auth refreshes at each
-- sign-in.)

select is(
  (select count(*)
   from public.members m
   join auth.users u on u.id = m.id
   where m.google_name is null
     and coalesce(
       private.clean_name(u.raw_user_meta_data ->> 'full_name'),
       private.clean_name(u.raw_user_meta_data ->> 'name')) is not null),
  0::bigint,
  'no member with a name in their metadata has a null google_name');

select is(
  (select count(*) from public.members m where char_length(m.name) > 100),
  0::bigint, 'no member name is over 100 characters');

select * from finish();

rollback;
