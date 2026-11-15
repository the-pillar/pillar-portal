-- Onboarding records (Story 8.3): member_onboarding, record_onboarding,
-- reset_first_run, private.close_first_run (called from respond_to_slot),
-- private.has_verified_factor, private.has_approved_member, my_onboarding.
-- Pins; the caller matrix; every I/O row; each step sets only its own
-- column; RLS; no activity row from either command.
--
-- Fixtures are created here and rolled back.

begin;

set local role postgres;
set local search_path = "$user", public, extensions;

select plan(37);

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

-- Callers: e..01 pending, 02 declined, 03 deactivated former Head Layout
-- Artist, 04 active staff, 05 active admin, 06 active staff.
select pg_temp.new_member('00000000-0000-4000-e000-000000000001', 'ob-pending@example.com', null);
select pg_temp.new_member('00000000-0000-4000-e000-000000000002', 'ob-declined@example.com', null);
select pg_temp.new_member('00000000-0000-4000-e000-000000000003', 'ob-deactivated@example.com', 'head_layout_artist');
select pg_temp.new_member('00000000-0000-4000-e000-000000000004', 'ob-staff@example.com', 'staff_layout_artist');
select pg_temp.new_member('00000000-0000-4000-e000-000000000005', 'ob-admin@example.com', 'sports_editor');
select pg_temp.new_member('00000000-0000-4000-e000-000000000006', 'ob-staff2@example.com', 'staff_writer');

update public.members set declined_at = now()
where id = '00000000-0000-4000-e000-000000000002';
update public.members set deactivated_at = now()
where id = '00000000-0000-4000-e000-000000000003';

-- Acts as the caller for the statements that follow, until reset.
create function pg_temp.act_as(p_caller uuid)
returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_caller, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;

-- The error a call raises, or 'ok'. Writes are rolled back.
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

-- Pins.

select is(
  (select p.prosecdef and not p.provolatile = 's' and p.proconfig = array['search_path=""']
     and pg_get_userbyid(p.proowner) = 'postgres'
   from pg_proc p where p.oid = 'public.record_onboarding(public.onboarding_step)'::regprocedure),
  true, 'record_onboarding is security definer, owned by postgres, empty search_path');
select is(
  (select p.prosecdef and p.proconfig = array['search_path=""']
     and pg_get_userbyid(p.proowner) = 'postgres'
   from pg_proc p where p.oid = 'public.reset_first_run()'::regprocedure),
  true, 'reset_first_run is security definer, owned by postgres, empty search_path');
select is(
  (select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""']
     and pg_get_userbyid(p.proowner) = 'postgres'
   from pg_proc p where p.oid = 'private.has_verified_factor()'::regprocedure),
  true, 'has_verified_factor is security definer, stable, empty search_path');
select is(
  (select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""']
     and pg_get_userbyid(p.proowner) = 'postgres'
   from pg_proc p where p.oid = 'private.has_approved_member()'::regprocedure),
  true, 'has_approved_member is security definer, stable, empty search_path');
select is(
  (select not p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""']
     and pg_get_userbyid(p.proowner) = 'postgres'
   from pg_proc p where p.oid = 'public.my_onboarding()'::regprocedure),
  true, 'my_onboarding is security invoker, stable, owned by postgres, empty search_path');
select is(
  (select not p.prosecdef and p.proconfig = array['search_path=""']
     and pg_get_userbyid(p.proowner) = 'postgres'
   from pg_proc p where p.oid = 'private.close_first_run(uuid)'::regprocedure),
  true, 'close_first_run is not security definer and is owned by postgres');
select is(
  (select not has_function_privilege('authenticated', 'private.close_first_run(uuid)', 'execute')
      and not has_function_privilege('anon', 'private.close_first_run(uuid)', 'execute')
      and not has_function_privilege('service_role', 'private.close_first_run(uuid)', 'execute')),
  true, 'close_first_run is granted to no API role');
select ok(
  (select p.prosrc ~ 'private\.close_first_run\(v_actor\)' from pg_proc p
   where p.oid = 'public.respond_to_slot(uuid, public.slot_state, text)'::regprocedure),
  'respond_to_slot calls close_first_run');
select is(
  (select has_table_privilege('authenticated', 'public.member_onboarding', 'select')
      and not has_table_privilege('authenticated', 'public.member_onboarding', 'insert')
      and not has_table_privilege('authenticated', 'public.member_onboarding', 'update')
      and not has_table_privilege('service_role', 'public.member_onboarding', 'select')
      and not has_table_privilege('anon', 'public.member_onboarding', 'select')),
  true, 'member_onboarding: authenticated selects only, service_role and anon nothing');
select is(
  (select relrowsecurity from pg_class where oid = 'public.member_onboarding'::regclass),
  true, 'member_onboarding has RLS on');

-- The caller matrix: refused commands and an empty read for non-active callers.

create temp table activity_before as select count(*) as n from public.activity;

create temp table callers (label text primary key, member_id uuid not null);
insert into callers values
  ('pending', '00000000-0000-4000-e000-000000000001'),
  ('declined', '00000000-0000-4000-e000-000000000002'),
  ('deactivated former Head', '00000000-0000-4000-e000-000000000003');

create temp table refused (caller text, call text, result text);
do $$
declare
  c callers;
  q text;
begin
  for c in select * from callers loop
    foreach q in array array[
      $q$ select public.record_onboarding('tour_seen') $q$,
      $q$ select public.reset_first_run() $q$
    ] loop
      insert into refused values (c.label, q, pg_temp.attempt(c.member_id, q));
    end loop;
  end loop;
  perform set_config('request.jwt.claims', '', true);
end
$$;
set local role postgres;

select is(
  (select count(*) from refused where result = 'P0001 auth.not_active'),
  6::bigint,
  'pending, declined and deactivated callers are refused both commands with auth.not_active');

select is(
  (select string_agg(pg_temp.run_as(c.member_id,
     'select count(*)::text from public.my_onboarding()'), ',' order by c.label) from callers c),
  '0,0,0', 'my_onboarding returns no row for pending, declined and deactivated callers');

select is(
  (select count(*) from public.member_onboarding), 0::bigint,
  'refused commands wrote no row');

-- Active callers with no row: nothing seen.

select is(
  pg_temp.run_as('00000000-0000-4000-e000-000000000005',
    $q$ select (select (o.tour_and_checklist, o.tour_seen, o.copied_task, o.checklist_done,
                       o.first_run_shown, o.first_run_closed, o.two_factor, o.approved_member)::text
                from public.my_onboarding() o) $q$),
  '(t,f,f,f,f,f,f,f)', 'active admin with no row: tour and checklist, nothing seen');
select is(
  pg_temp.run_as('00000000-0000-4000-e000-000000000004',
    $q$ select (select (o.tour_and_checklist, o.tour_seen, o.copied_task, o.checklist_done,
                       o.first_run_shown, o.first_run_closed, o.two_factor, o.approved_member)::text
                from public.my_onboarding() o) $q$),
  '(f,f,f,f,f,f,f,f)', 'active staff with no row: the first-run card, nothing seen');

-- First record of a step.

select pg_temp.act_as('00000000-0000-4000-e000-000000000004');
select public.record_onboarding('first_run_shown');
set local role postgres;

select is(
  (select (tour_seen_at is null and copied_task_at is null and checklist_done_at is null
           and first_run_shown_at is not null and first_run_closed_at is null)
   from public.member_onboarding where member_id = '00000000-0000-4000-e000-000000000004'),
  true, 'first record creates the row with only first_run_shown_at set');

select is(
  pg_temp.run_as('00000000-0000-4000-e000-000000000004',
    $q$ select (select (o.first_run_shown, o.first_run_closed)::text from public.my_onboarding() o) $q$),
  '(t,f)', 'my_onboarding reflects the recorded step');

-- Step already recorded keeps its timestamp.

update public.member_onboarding set tour_seen_at = '2026-01-01T00:00:00Z'
where member_id = '00000000-0000-4000-e000-000000000004';
select pg_temp.act_as('00000000-0000-4000-e000-000000000004');
select public.record_onboarding('tour_seen');
select public.record_onboarding('first_run_shown');
set local role postgres;

select is(
  (select tour_seen_at from public.member_onboarding
   where member_id = '00000000-0000-4000-e000-000000000004'),
  '2026-01-01T00:00:00Z'::timestamptz, 'a step already recorded keeps its timestamp');

-- Null step writes nothing.

select pg_temp.act_as('00000000-0000-4000-e000-000000000005');
select public.record_onboarding(null);
set local role postgres;

select is(
  (select count(*) from public.member_onboarding
   where member_id = '00000000-0000-4000-e000-000000000005'),
  0::bigint, 'a null step writes nothing');

-- Each step sets only its own column.

create temp table step_cols (step public.onboarding_step, col text);
insert into step_cols values
  ('tour_seen', 'tour_seen_at'),
  ('copied_task', 'copied_task_at'),
  ('checklist_done', 'checklist_done_at'),
  ('first_run_shown', 'first_run_shown_at'),
  ('first_run_closed', 'first_run_closed_at');
create temp table step_result (step public.onboarding_step, set_cols text[]);

do $$
declare
  s record;
  v_set text[];
begin
  for s in select * from step_cols loop
    delete from public.member_onboarding
    where member_id = '00000000-0000-4000-e000-000000000006';
    perform pg_temp.act_as('00000000-0000-4000-e000-000000000006');
    perform public.record_onboarding(s.step);
    set local role postgres;
    select array_agg(j.key order by j.key) into v_set
    from public.member_onboarding o, jsonb_each(to_jsonb(o)) j
    where o.member_id = '00000000-0000-4000-e000-000000000006'
      and j.key <> 'member_id' and j.value <> 'null'::jsonb;
    insert into step_result values (s.step, v_set);
  end loop;
end
$$;

select is(
  (select count(*) from step_result r join step_cols c using (step)
   where r.set_cols = array[c.col]),
  5::bigint, 'each of the five steps sets only its own column');
select is(
  (select count(*) from step_result), 5::bigint, 'all five steps ran');

-- Show tips again.

delete from public.member_onboarding;
insert into public.member_onboarding
  (member_id, tour_seen_at, copied_task_at, checklist_done_at, first_run_shown_at, first_run_closed_at)
values ('00000000-0000-4000-e000-000000000004', now(), now(), now(), now(), now());

select pg_temp.act_as('00000000-0000-4000-e000-000000000004');
select public.reset_first_run();
set local role postgres;

select is(
  (select (first_run_shown_at is null and first_run_closed_at is null
           and tour_seen_at is not null and copied_task_at is not null
           and checklist_done_at is not null)
   from public.member_onboarding where member_id = '00000000-0000-4000-e000-000000000004'),
  true, 'reset_first_run nulls the card timestamps and keeps the other three');

select pg_temp.act_as('00000000-0000-4000-e000-000000000005');
select public.reset_first_run();
set local role postgres;

select is(
  (select count(*) from public.member_onboarding
   where member_id = '00000000-0000-4000-e000-000000000005'),
  0::bigint, 'reset_first_run with no row inserts none');

-- RLS: a member reads their own row, an admin no one else's.

insert into public.member_onboarding (member_id, tour_seen_at)
values ('00000000-0000-4000-e000-000000000005', now());

select is(
  pg_temp.run_as('00000000-0000-4000-e000-000000000004',
    'select count(*)::text from public.member_onboarding'),
  '1', 'a member reads only their own row');
select is(
  pg_temp.run_as('00000000-0000-4000-e000-000000000005',
    $q$ select count(*)::text from public.member_onboarding
        where member_id = '00000000-0000-4000-e000-000000000004' $q$),
  '0', 'an admin reads no one else''s row');
select is(
  pg_temp.run_as('00000000-0000-4000-e000-000000000005',
    'select count(*)::text from public.member_onboarding'),
  '1', 'an admin reads only their own row');

-- Neither command writes an activity row.

select is(
  (select count(*) from public.activity),
  (select n from activity_before), 'neither command wrote an activity row');

-- Two-factor.

insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at)
values (gen_random_uuid(), '00000000-0000-4000-e000-000000000004', 'totp', 'unverified', now(), now());
select is(
  pg_temp.run_as('00000000-0000-4000-e000-000000000004',
    'select (select o.two_factor from public.my_onboarding() o)::text'),
  'false', 'two_factor is false for an unverified totp factor');

insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at)
values (gen_random_uuid(), '00000000-0000-4000-e000-000000000005', 'totp', 'verified', now(), now());
select is(
  pg_temp.run_as('00000000-0000-4000-e000-000000000004',
    'select (select o.two_factor from public.my_onboarding() o)::text'),
  'false', 'two_factor is false when only another user has a verified factor');

insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at)
values (gen_random_uuid(), '00000000-0000-4000-e000-000000000004', 'totp', 'verified', now(), now());
select is(
  pg_temp.run_as('00000000-0000-4000-e000-000000000004',
    'select (select o.two_factor from public.my_onboarding() o)::text'),
  'true', 'two_factor is true for the caller''s verified totp factor');

-- Approved a member.

insert into public.activity (op_id, entity_type, entity_id, actor_id, action)
values (gen_random_uuid(), 'member', '00000000-0000-4000-e000-000000000001',
        '00000000-0000-4000-e000-000000000006', 'approved');
select is(
  pg_temp.run_as('00000000-0000-4000-e000-000000000004',
    'select (select o.approved_member from public.my_onboarding() o)::text'),
  'false', 'approved_member is false when another admin approved someone');
select is(
  pg_temp.run_as('00000000-0000-4000-e000-000000000006',
    'select (select o.approved_member from public.my_onboarding() o)::text'),
  'true', 'approved_member is true for the caller who approved someone');

-- Staff responds with the card shown.

insert into public.tasks (id, title, owning_desk_id, due_at, "column")
values ('00000000-0000-4000-e100-000000000001', 'Onboarding fixture task', 'layout',
        '2026-11-01T00:00:00+08', 'doing');
insert into public.task_assignments (id, task_id, member_id, role, state) values
  ('00000000-0000-4000-e200-000000000001', '00000000-0000-4000-e100-000000000001',
   '00000000-0000-4000-e000-000000000004', 'layout_artist', 'awaiting_response'),
  ('00000000-0000-4000-e200-000000000002', '00000000-0000-4000-e100-000000000001',
   '00000000-0000-4000-e000-000000000004', 'writer', 'awaiting_response'),
  ('00000000-0000-4000-e200-000000000003', '00000000-0000-4000-e100-000000000001',
   '00000000-0000-4000-e000-000000000006', 'cartoonist', 'awaiting_response'),
  ('00000000-0000-4000-e200-000000000004', '00000000-0000-4000-e100-000000000001',
   '00000000-0000-4000-e000-000000000005', 'photojournalist', 'awaiting_response'),
  ('00000000-0000-4000-e200-000000000005', '00000000-0000-4000-e100-000000000001',
   '00000000-0000-4000-e000-000000000004', 'videojournalist', 'awaiting_response');

-- 04: card shown (reset left shown null), so show it, then respond on_it.
update public.member_onboarding
set first_run_shown_at = '2026-02-01T00:00:00Z'
where member_id = '00000000-0000-4000-e000-000000000004';

select pg_temp.act_as('00000000-0000-4000-e000-000000000004');
select public.respond_to_slot('00000000-0000-4000-e200-000000000001', 'on_it');
set local role postgres;
select isnt(
  (select first_run_closed_at from public.member_onboarding
   where member_id = '00000000-0000-4000-e000-000000000004'),
  null, 'on_it with the card shown sets first_run_closed_at');

-- Already closed: a later response leaves the timestamp.
update public.member_onboarding set first_run_closed_at = '2026-02-02T00:00:00Z'
where member_id = '00000000-0000-4000-e000-000000000004';
select pg_temp.act_as('00000000-0000-4000-e000-000000000004');
select public.respond_to_slot('00000000-0000-4000-e200-000000000002', 'on_it');
set local role postgres;
select is(
  (select first_run_closed_at from public.member_onboarding
   where member_id = '00000000-0000-4000-e000-000000000004'),
  '2026-02-02T00:00:00Z'::timestamptz, 'an already closed card keeps its timestamp');

-- needs_reassignment also closes.
update public.member_onboarding set first_run_closed_at = null
where member_id = '00000000-0000-4000-e000-000000000004';
select pg_temp.act_as('00000000-0000-4000-e000-000000000004');
select public.respond_to_slot('00000000-0000-4000-e200-000000000005', 'needs_reassignment');
set local role postgres;
select isnt(
  (select first_run_closed_at from public.member_onboarding
   where member_id = '00000000-0000-4000-e000-000000000004'),
  null, 'needs_reassignment with the card shown sets first_run_closed_at');

-- Card never shown: nothing changes (row exists, shown null).
select pg_temp.act_as('00000000-0000-4000-e000-000000000005');
select public.respond_to_slot('00000000-0000-4000-e200-000000000004', 'on_it');
set local role postgres;
select is(
  (select first_run_closed_at from public.member_onboarding
   where member_id = '00000000-0000-4000-e000-000000000005'),
  null, 'a card never shown stays unclosed');

-- No row: none created.
select pg_temp.act_as('00000000-0000-4000-e000-000000000006');
select public.respond_to_slot('00000000-0000-4000-e200-000000000003', 'on_it');
set local role postgres;
select is(
  (select count(*) from public.member_onboarding
   where member_id = '00000000-0000-4000-e000-000000000006'),
  0::bigint, 'a response with no onboarding row creates none');

select * from finish();

rollback;
