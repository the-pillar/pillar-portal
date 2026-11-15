-- Versioned moves and the New task check (Story 8.4, AD-4, AD-14, AD-21):
-- the pins, moved_at/moved_by/updated_by stamped by one trigger, the
-- three-argument move_task (stale detail, order of checks), and
-- can_create_task() against create_task.
--
-- Fixtures are inserted directly as `postgres` and rolled back, so the test
-- doesn't depend on seed.sql and runs on staging (`test db --linked`).

begin;

-- See responses_and_moves.test.sql: run as `postgres` with `extensions` on the
-- path, whichever role `supabase test db --linked` connected as.
set local role postgres;
set local search_path = "$user", public, extensions;

select plan(52);

-- Fixtures.

create function pg_temp.new_member(p_id uuid, p_email text, p_position text)
returns void
language plpgsql as $$
begin
  insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated',
          'authenticated', p_email, '{}');
  if p_position is not null then
    insert into public.member_positions (member_id, position, is_primary)
    values (p_id, p_position, true);
  end if;
end;
$$;

-- Fixture tasks were last moved on Oct 1.
create function pg_temp.new_task(p_id uuid, p_column public.task_column)
returns void
language sql as $$
  insert into public.tasks (
    id, title, description, owning_section_id, owning_desk_id, due_at,
    reference_url, "column", done_at, created_by, created_at, updated_at,
    moved_at
  )
  values (p_id, 'Fixture task ' || p_id, 'Fixture description', null,
          'layout', '2026-11-01T00:00:00+08', 'https://example.com/fixture',
          p_column,
          case when p_column = 'done' then '2026-10-02T09:00:00+08'::timestamptz end,
          '00000000-0000-4000-a000-000000000004',
          '2026-10-01T00:00:00+08', '2026-10-01T00:00:00+08',
          '2026-10-01T00:00:00+08')
$$;

create function pg_temp.new_slot(
  p_id uuid, p_task uuid, p_member uuid,
  p_role public.production_role, p_state public.slot_state
)
returns void
language sql as $$
  insert into public.task_assignments (id, task_id, member_id, role, state,
                                       updated_at)
  values (p_id, p_task, p_member, p_role, p_state, '2026-10-01T00:00:00+08')
$$;

delete from public.member_positions where position = 'editor_in_chief';

-- a01 pending, a02 and a12 staff layout artists, a03 staff writer, a04 head
-- layout artist (the approver), a10 managing editor (admin), a13 a
-- deactivated former managing editor, a14 a deactivated staff writer, a15
-- a declined applicant.
select pg_temp.new_member('00000000-0000-4000-a000-000000000001', 'vm-pending@example.com', null);
select pg_temp.new_member('00000000-0000-4000-a000-000000000002', 'vm-assignee@example.com', 'staff_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-000000000003', 'vm-staff@example.com', 'staff_writer');
select pg_temp.new_member('00000000-0000-4000-a000-000000000004', 'vm-head-layout@example.com', 'head_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-000000000010', 'vm-admin@example.com', 'managing_editor');
select pg_temp.new_member('00000000-0000-4000-a000-000000000012', 'vm-assignee-2@example.com', 'staff_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-000000000013', 'vm-former-admin@example.com', 'managing_editor');
update public.members set deactivated_at = now()
where id = '00000000-0000-4000-a000-000000000013';
select pg_temp.new_member('00000000-0000-4000-a000-000000000014', 'vm-deactivated@example.com', 'staff_writer');
update public.members set deactivated_at = now()
where id = '00000000-0000-4000-a000-000000000014';
select pg_temp.new_member('00000000-0000-4000-a000-000000000015', 'vm-declined@example.com', null);
update public.members set declined_at = now()
where id = '00000000-0000-4000-a000-000000000015';

-- b01 To Do and b02 Doing, each with a02 and a12 On it; b03 For Review (a02
-- On it), b04 deleted, b05 Done, b06 To Do (a02 awaiting, for slot edits).
select pg_temp.new_task('00000000-0000-4000-b000-000000000001', 'to_do');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000011', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000012', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000012', 'cartoonist', 'on_it');
select pg_temp.new_task('00000000-0000-4000-b000-000000000002', 'doing');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000021', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000022', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000012', 'cartoonist', 'on_it');
select pg_temp.new_task('00000000-0000-4000-b000-000000000003', 'for_review');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000031', '00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_task('00000000-0000-4000-b000-000000000004', 'to_do');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000041', '00000000-0000-4000-b000-000000000004', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
update public.tasks set deleted_at = '2026-10-02T00:00:00+08'
where id = '00000000-0000-4000-b000-000000000004';
select pg_temp.new_task('00000000-0000-4000-b000-000000000005', 'done');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000051', '00000000-0000-4000-b000-000000000005', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_task('00000000-0000-4000-b000-000000000006', 'to_do');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000061', '00000000-0000-4000-b000-000000000006', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000062', '00000000-0000-4000-b000-000000000006', '00000000-0000-4000-a000-000000000002', 'cartoonist', 'on_it');

-- Run a statement as the caller; reset to postgres on success (a refused
-- statement's savepoint rollback in throws_ok undoes the role).
create function pg_temp.as_caller(p_caller uuid)
returns void
language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_caller, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
end;
$$;

create function pg_temp.vmove_as(
  p_caller uuid, p_task uuid, p_to public.task_column, p_version timestamptz
)
returns timestamptz
language plpgsql as $$
declare
  v timestamptz;
begin
  perform pg_temp.as_caller(p_caller);
  select public.move_task(p_task, p_to, p_version) into v;
  set local role postgres;
  return v;
end;
$$;

create function pg_temp.move2_as(p_caller uuid, p_task uuid, p_to public.task_column)
returns void
language plpgsql as $$
begin
  perform pg_temp.as_caller(p_caller);
  perform public.move_task(p_task, p_to);
  set local role postgres;
end;
$$;

create function pg_temp.can_create_as(p_caller uuid)
returns boolean
language plpgsql as $$
declare
  v boolean;
begin
  perform pg_temp.as_caller(p_caller);
  select public.can_create_task() into v;
  set local role postgres;
  return v;
end;
$$;

create function pg_temp.create_as(p_caller uuid, p_slots jsonb)
returns uuid
language plpgsql as $$
declare
  v uuid;
begin
  perform pg_temp.as_caller(p_caller);
  select public.create_task('New', null, null, 'layout',
                            '2026-11-01T00:00:00+08', null, p_slots) into v;
  set local role postgres;
  return v;
end;
$$;

create function pg_temp.moved_at_of(p_task uuid)
returns timestamptz
language sql as $$ select moved_at from public.tasks where id = p_task $$;

-- Pins.

select is_definer('public', 'move_task', array['uuid', 'task_column', 'timestamp with time zone'],
  'public.move_task(uuid, task_column, timestamptz) is security definer');
select function_owner_is('public', 'move_task', array['uuid', 'task_column', 'timestamp with time zone'], 'postgres',
  'the versioned move_task is owned by postgres');
select is(
  (select p.proconfig from pg_proc p
   where p.oid = 'public.move_task(uuid, public.task_column, timestamptz)'::regprocedure),
  array['search_path=""'],
  'the versioned move_task sets search_path = ''''');
select is(
  (select p.pronargdefaults from pg_proc p
   where p.oid = 'public.move_task(uuid, public.task_column, timestamptz)'::regprocedure),
  0::smallint,
  'the versioned move_task has no default on the version');
select matches(
  (select p.prosrc from pg_proc p
   where p.oid = 'public.move_task(uuid, public.task_column, timestamptz)'::regprocedure),
  'for update',
  'the versioned move_task locks the task FOR UPDATE');
select is_definer('private', 'can_create_task', array[]::text[],
  'private.can_create_task() is security definer');
select volatility_is('private', 'can_create_task', array[]::text[], 'stable',
  'private.can_create_task() is stable');
select function_owner_is('private', 'can_create_task', array[]::text[], 'postgres',
  'private.can_create_task() is owned by postgres');
select is(
  (select p.proconfig from pg_proc p where p.oid = 'private.can_create_task()'::regprocedure),
  array['search_path=""'],
  'private.can_create_task() sets search_path = ''''');
select isnt_definer('public', 'can_create_task', array[]::text[],
  'public.can_create_task() runs with the caller''s rights');
select volatility_is('public', 'can_create_task', array[]::text[], 'stable',
  'public.can_create_task() is stable');
select function_owner_is('public', 'can_create_task', array[]::text[], 'postgres',
  'public.can_create_task() is owned by postgres');
select is(
  (select p.proconfig from pg_proc p where p.oid = 'public.can_create_task()'::regprocedure),
  array['search_path=""'],
  'public.can_create_task() sets search_path = ''''');
select isnt_definer('private', 'stamp_task_row', array[]::text[],
  'the stamp trigger function is not security definer');
select function_owner_is('private', 'stamp_task_row', array[]::text[], 'postgres',
  'the stamp trigger function is owned by postgres');
select is(
  (select p.proconfig from pg_proc p where p.oid = 'private.stamp_task_row()'::regprocedure),
  array['search_path=""'],
  'the stamp trigger function sets search_path = ''''');
select is(
  (select count(*) from pg_proc p
   where p.oid = 'private.stamp_task_row()'::regprocedure
     and (has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute')
       or has_function_privilege('service_role', p.oid, 'execute'))),
  0::bigint,
  'the stamp trigger function is granted to no API role');
select matches(
  (select p.prosrc from pg_proc p
   where p.oid = 'public.create_task(text, text, text, text, timestamptz, text, jsonb)'::regprocedure),
  'private\.can_create_task\(\)',
  'create_task calls private.can_create_task()');

-- A versioned move by an assignee.

select is(
  pg_temp.vmove_as('00000000-0000-4000-a000-000000000002',
    '00000000-0000-4000-b000-000000000001', 'doing', '2026-10-01T00:00:00+08'),
  pg_temp.moved_at_of('00000000-0000-4000-b000-000000000001'),
  'a move with the card''s version returns the row''s new moved_at');
select results_eq(
  $$ select t."column", t.moved_at > '2026-10-01T00:00:00+08'::timestamptz,
            t.moved_by, t.updated_by
     from public.tasks t where t.id = '00000000-0000-4000-b000-000000000001' $$,
  $$ values ('doing'::public.task_column, true,
             '00000000-0000-4000-a000-000000000002'::uuid,
             '00000000-0000-4000-a000-000000000002'::uuid) $$,
  'the move changes the column and stamps moved_by and updated_by with the caller');
select is(
  (select count(*) from public.activity
   where entity_id = '00000000-0000-4000-b000-000000000001' and action = 'moved_to_doing'),
  1::bigint,
  'one moved_to_doing activity row');

-- Undo, then a stale Undo after another member's move.

create temp table v1 as
  select moved_at as v from public.tasks where id = '00000000-0000-4000-b000-000000000001';
grant select on v1 to public;

select cmp_ok(
  pg_temp.vmove_as('00000000-0000-4000-a000-000000000002',
    '00000000-0000-4000-b000-000000000001', 'to_do', (select v from v1)),
  '>', (select v from v1),
  'an Undo with the returned version moves back and returns a newer moved_at');
select is(
  (select "column"::text from public.tasks where id = '00000000-0000-4000-b000-000000000001'),
  'to_do', 'the Undo moved the card back');

-- b02: a02 moves it (v), a12 moves it again, then a02's Undo is stale.
create temp table v2 as
  select pg_temp.vmove_as('00000000-0000-4000-a000-000000000002',
    '00000000-0000-4000-b000-000000000002', 'for_review', '2026-10-01T00:00:00+08') as v;
select pg_temp.move2_as('00000000-0000-4000-a000-000000000012',
  '00000000-0000-4000-b000-000000000002', 'to_do');

select throws_ok(
  $$ select pg_temp.vmove_as('00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-b000-000000000002', 'doing', (select v from v2)) $$,
  'P0001', 'tasks.stale',
  'an Undo after another member''s move is stale');
select is(
  (select "column"::text from public.tasks where id = '00000000-0000-4000-b000-000000000002'),
  'to_do', 'the stale Undo changed nothing');

-- The stale detail, parsed.
create function pg_temp.stale_detail(p_caller uuid, p_task uuid, p_version timestamptz)
returns jsonb
language plpgsql as $$
declare
  v_detail text;
begin
  begin
    perform pg_temp.vmove_as(p_caller, p_task, 'doing', p_version);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    set local role postgres;
    return v_detail::jsonb;
  end;
  return null;
end;
$$;

select is(
  pg_temp.stale_detail('00000000-0000-4000-a000-000000000002',
    '00000000-0000-4000-b000-000000000002', (select v from v2)),
  jsonb_build_object('column', 'to_do',
                     'moved_by', '00000000-0000-4000-a000-000000000012',
                     'moved_by_name', (select name from public.members
                                       where id = '00000000-0000-4000-a000-000000000012')),
  'the stale detail names the current column and the member who moved it');

-- Undo after the approver marked it Done.
create temp table v3 as
  select moved_at as v from public.tasks where id = '00000000-0000-4000-b000-000000000003';
select pg_temp.as_caller('00000000-0000-4000-a000-000000000004');
select public.mark_done('00000000-0000-4000-b000-000000000003');
set local role postgres;
select throws_ok(
  $$ select pg_temp.vmove_as('00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-b000-000000000003', 'doing', (select v from v3)) $$,
  'P0001', 'tasks.stale', 'an Undo after the approver''s Done is stale');
select is(
  pg_temp.stale_detail('00000000-0000-4000-a000-000000000002',
    '00000000-0000-4000-b000-000000000003', (select v from v3)),
  jsonb_build_object('column', 'done',
                     'moved_by', '00000000-0000-4000-a000-000000000004',
                     'moved_by_name', (select name from public.members
                                       where id = '00000000-0000-4000-a000-000000000004')),
  'an Undo after the approver''s Done is stale, naming the approver');
select cmp_ok(
  (select moved_at from public.tasks where id = '00000000-0000-4000-b000-000000000003'),
  '>', (select v from v3), 'mark_done sets a new moved_at');

-- Null version, not allowed, not found, not active.
select throws_ok(
  $$ select pg_temp.vmove_as('00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-b000-000000000001', 'doing', null) $$,
  'P0001', 'tasks.stale', 'a null version is stale');
select throws_ok(
  $$ select pg_temp.vmove_as('00000000-0000-4000-a000-000000000003',
       '00000000-0000-4000-b000-000000000001', 'doing',
       pg_temp.moved_at_of('00000000-0000-4000-b000-000000000001')) $$,
  'P0001', 'tasks.not_allowed', 'a fresh version from a non-assignee is not allowed');
select throws_ok(
  $$ select pg_temp.vmove_as('00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-b000-000000000001', 'done',
       pg_temp.moved_at_of('00000000-0000-4000-b000-000000000001')) $$,
  'P0001', 'tasks.not_allowed', 'a fresh version to done is not allowed');
select throws_ok(
  $$ select pg_temp.vmove_as('00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-b000-000000000004', 'doing', now()) $$,
  'P0001', 'tasks.not_found', 'a deleted task is not found');
select throws_ok(
  $$ select pg_temp.vmove_as('00000000-0000-4000-a000-000000000002',
       gen_random_uuid(), 'doing', now()) $$,
  'P0001', 'tasks.not_found', 'a missing task is not found');
select throws_ok(
  $$ select pg_temp.vmove_as('00000000-0000-4000-a000-000000000001',
       '00000000-0000-4000-b000-000000000001', 'doing', now()) $$,
  'P0001', 'auth.not_active', 'a pending caller gets auth.not_active');
select throws_ok(
  $$ select pg_temp.vmove_as('00000000-0000-4000-a000-000000000014',
       '00000000-0000-4000-b000-000000000001', 'doing', now()) $$,
  'P0001', 'auth.not_active', 'a deactivated caller gets auth.not_active');
select throws_ok(
  $$ select pg_temp.vmove_as('00000000-0000-4000-a000-000000000015',
       '00000000-0000-4000-b000-000000000001', 'doing', now()) $$,
  'P0001', 'auth.not_active', 'a declined caller gets auth.not_active');

-- Edits keep moved_at and moved_by, and stamp updated_by.
create temp table b06_before as
  select moved_at, moved_by from public.tasks where id = '00000000-0000-4000-b000-000000000006';
select pg_temp.as_caller('00000000-0000-4000-a000-000000000002');
select public.respond_to_slot('00000000-0000-4000-c000-000000000061', 'on_it');
select public.hand_back_slot('00000000-0000-4000-c000-000000000062', 'Busy');
set local role postgres;
select results_eq(
  $$ select a.updated_by from public.task_assignments a
     where a.id in ('00000000-0000-4000-c000-000000000061',
                    '00000000-0000-4000-c000-000000000062') $$,
  $$ values ('00000000-0000-4000-a000-000000000002'::uuid),
            ('00000000-0000-4000-a000-000000000002'::uuid) $$,
  'respond_to_slot and hand_back_slot stamp the slot''s updated_by');
select pg_temp.as_caller('00000000-0000-4000-a000-000000000004');
select public.update_task('00000000-0000-4000-b000-000000000006', 'Renamed', 'Text',
  '2026-11-05T17:00:00+08', null,
  (select jsonb_agg(jsonb_build_object('id', a.id, 'member_id', a.member_id,
                                       'role', a.role, 'loaded_member_id', a.member_id))
   from public.task_assignments a where a.task_id = '00000000-0000-4000-b000-000000000006'));
set local role postgres;
select results_eq(
  $$ select t.title, t.updated_by, (t.moved_at, t.moved_by) is not distinct from
            (select (b.moved_at, b.moved_by) from b06_before b)
     from public.tasks t where t.id = '00000000-0000-4000-b000-000000000006' $$,
  $$ values ('Renamed'::text, '00000000-0000-4000-a000-000000000004'::uuid, true) $$,
  'update_task stamps updated_by and leaves moved_at and moved_by');
select results_eq(
  $$ select a.updated_by from public.task_assignments a
     where a.id = '00000000-0000-4000-c000-000000000061' $$,
  $$ values ('00000000-0000-4000-a000-000000000002'::uuid) $$,
  'an unchanged slot keeps its updated_by through update_task');

-- Reassign a slot: a04 (head) reassigns c062 (handed back) to a12.
select pg_temp.as_caller('00000000-0000-4000-a000-000000000004');
select public.reassign_slot('00000000-0000-4000-c000-000000000062',
  '00000000-0000-4000-a000-000000000012',
  (select updated_at from public.task_assignments where id = '00000000-0000-4000-c000-000000000062'));
set local role postgres;
select results_eq(
  $$ select a.updated_by, (select (t.moved_at, t.moved_by) is not distinct from
                   (select (b.moved_at, b.moved_by) from b06_before b)
            from public.tasks t where t.id = a.task_id)
     from public.task_assignments a where a.id = '00000000-0000-4000-c000-000000000062' $$,
  $$ values ('00000000-0000-4000-a000-000000000004'::uuid, true) $$,
  'reassign_slot stamps the slot''s updated_by and leaves the task''s mover');

-- The two-argument move, send back and reopen each set a new moved_at.
create temp table v4 as
  select moved_at as v from public.tasks where id = '00000000-0000-4000-b000-000000000001';
select pg_temp.move2_as('00000000-0000-4000-a000-000000000002',
  '00000000-0000-4000-b000-000000000001', 'doing');
select results_eq(
  $$ select t.moved_at > (select v from v4), t.moved_by from public.tasks t
     where t.id = '00000000-0000-4000-b000-000000000001' $$,
  $$ values (true, '00000000-0000-4000-a000-000000000002'::uuid) $$,
  'the two-argument move sets a new moved_at and moved_by');

create temp table v5 as
  select moved_at as v from public.tasks where id = '00000000-0000-4000-b000-000000000003';
select pg_temp.as_caller('00000000-0000-4000-a000-000000000004');
select public.reopen_task('00000000-0000-4000-b000-000000000003');
set local role postgres;
select results_eq(
  $$ select t.moved_at > (select v from v5), t.moved_by, t."column"::text
     from public.tasks t where t.id = '00000000-0000-4000-b000-000000000003' $$,
  $$ values (true, '00000000-0000-4000-a000-000000000004'::uuid, 'doing'::text) $$,
  'reopen_task sets a new moved_at and moved_by');

select pg_temp.move2_as('00000000-0000-4000-a000-000000000002',
  '00000000-0000-4000-b000-000000000001', 'for_review');
create temp table v6 as
  select moved_at as v from public.tasks where id = '00000000-0000-4000-b000-000000000001';
select pg_temp.as_caller('00000000-0000-4000-a000-000000000004');
select public.send_back_task('00000000-0000-4000-b000-000000000001', 'Redo it');
set local role postgres;
select results_eq(
  $$ select t.moved_at > (select v from v6), t.moved_by, t."column"::text
     from public.tasks t where t.id = '00000000-0000-4000-b000-000000000001' $$,
  $$ values (true, '00000000-0000-4000-a000-000000000004'::uuid, 'doing'::text) $$,
  'send_back_task sets a new moved_at and moved_by');

-- can_create_task() and create_task.
select results_eq(
  $$ select pg_temp.can_create_as(m.id)
     from (values ('00000000-0000-4000-a000-000000000001'::uuid),
                  ('00000000-0000-4000-a000-000000000015'::uuid),
                  ('00000000-0000-4000-a000-000000000013'::uuid),
                  ('00000000-0000-4000-a000-000000000014'::uuid),
                  ('00000000-0000-4000-a000-000000000003'::uuid),
                  ('00000000-0000-4000-a000-000000000010'::uuid)) as m (id) $$,
  $$ values (false), (false), (false), (false), (false), (true) $$,
  'can_create_task() is false for pending, declined, a deactivated former admin, a deactivated member and active staff, and true for an active admin');

select throws_ok(
  $$ select pg_temp.create_as('00000000-0000-4000-a000-000000000001',
       '[{"member_id":"00000000-0000-4000-a000-000000000002","role":"layout_artist"}]') $$,
  'P0001', 'auth.not_active', 'create_task refuses a pending caller');
select throws_ok(
  $$ select pg_temp.create_as('00000000-0000-4000-a000-000000000015',
       '[{"member_id":"00000000-0000-4000-a000-000000000002","role":"layout_artist"}]') $$,
  'P0001', 'auth.not_active', 'create_task refuses a declined caller');
select throws_ok(
  $$ select pg_temp.create_as('00000000-0000-4000-a000-000000000013',
       '[{"member_id":"00000000-0000-4000-a000-000000000002","role":"layout_artist"}]') $$,
  'P0001', 'auth.not_active', 'create_task refuses a deactivated former admin');
select throws_ok(
  $$ select pg_temp.create_as('00000000-0000-4000-a000-000000000014',
       '[{"member_id":"00000000-0000-4000-a000-000000000002","role":"layout_artist"}]') $$,
  'P0001', 'auth.not_active', 'create_task refuses a deactivated member');
select throws_ok(
  $$ select pg_temp.create_as('00000000-0000-4000-a000-000000000003',
       '[{"member_id":"00000000-0000-4000-a000-000000000002","role":"layout_artist"}]') $$,
  'P0001', 'tasks.not_admin', 'create_task refuses active staff');

create temp table created as
  select pg_temp.create_as('00000000-0000-4000-a000-000000000010',
    '[{"member_id":"00000000-0000-4000-a000-000000000002","role":"layout_artist"}]') as id;
select results_eq(
  $$ select t.updated_by, t.moved_by from public.tasks t
     where t.id = (select id from created) $$,
  $$ values ('00000000-0000-4000-a000-000000000010'::uuid,
             '00000000-0000-4000-a000-000000000010'::uuid) $$,
  'create_task stamps updated_by and moved_by with the admin');
select results_eq(
  $$ select a.updated_by from public.task_assignments a
     where a.task_id = (select id from created) $$,
  $$ values ('00000000-0000-4000-a000-000000000010'::uuid) $$,
  'create_task stamps each slot''s updated_by with the admin');

select * from finish();

rollback;
