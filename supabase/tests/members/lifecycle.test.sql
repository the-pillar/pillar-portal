-- Position changes and deactivation (Story 5.4, AD-22): public.update_member,
-- public.deactivate_member, private.release_member_slots,
-- private.deactivation_guard, private.can_manage_member and the three new
-- member_capabilities columns. Accepted probes raise a sentinel and roll back;
-- fixtures are rolled back.

begin;

set local role postgres;
set local search_path = "$user", public, extensions;

select no_plan();

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

create function pg_temp.new_task(p_id uuid, p_column text, p_deleted boolean)
returns void
language sql as $$
  insert into public.tasks (id, title, owning_desk_id, due_at, "column", done_at, deleted_at)
  values (p_id, 'Lifecycle fixture ' || p_id, 'layout', '2026-11-01T00:00:00+08',
          p_column::public.task_column,
          case when p_column = 'done' then now() end,
          case when p_deleted then now() end)
$$;

create function pg_temp.slot(p_id uuid, p_task uuid, p_member uuid, p_state text)
returns void
language sql as $$
  insert into public.task_assignments (id, task_id, member_id, role, state)
  values (p_id, p_task, p_member, 'layout_artist', p_state::public.slot_state)
$$;

-- Move Editor-in-Chief off the seeded persona to fixture D.
delete from public.member_positions where position = 'editor_in_chief';

-- A: admin (caller), B: admin, C: staff, D: Editor-in-Chief, G: staff caller,
-- H: deactivated former admin (caller), I: pending, S: staff with slots,
-- T: staff, holds two positions.
select pg_temp.new_member('00000000-0000-4000-e400-00000000000a', 'lc-a@example.com', 'sports_editor');
select pg_temp.new_member('00000000-0000-4000-e400-00000000000b', 'lc-b@example.com', 'sports_editor');
select pg_temp.new_member('00000000-0000-4000-e400-00000000000c', 'lc-c@example.com', 'staff_writer');
select pg_temp.new_member('00000000-0000-4000-e400-00000000000d', 'lc-d@example.com', 'editor_in_chief');
select pg_temp.new_member('00000000-0000-4000-e400-000000000010', 'lc-g@example.com', 'staff_writer');
select pg_temp.new_member('00000000-0000-4000-e400-000000000011', 'lc-h@example.com', 'sports_editor');
select pg_temp.new_member('00000000-0000-4000-e400-000000000012', 'lc-i@example.com', null);
select pg_temp.new_member('00000000-0000-4000-e400-000000000013', 'lc-s@example.com', 'staff_layout_artist');
select pg_temp.new_member('00000000-0000-4000-e400-000000000014', 'lc-t@example.com', 'staff_writer');
update public.members set deactivated_at = now() where id = '00000000-0000-4000-e400-000000000011';

-- Slots: S on To Do, Done and deleted tasks (and one already handed back);
-- C on a live To Do task.
select pg_temp.new_task('00000000-0000-4000-e500-000000000001', 'to_do', false);
select pg_temp.new_task('00000000-0000-4000-e500-000000000002', 'done', false);
select pg_temp.new_task('00000000-0000-4000-e500-000000000003', 'doing', true);
select pg_temp.new_task('00000000-0000-4000-e500-000000000004', 'doing', false);
select pg_temp.slot('00000000-0000-4000-e600-000000000001', '00000000-0000-4000-e500-000000000001', '00000000-0000-4000-e400-000000000013', 'on_it');
select pg_temp.slot('00000000-0000-4000-e600-000000000002', '00000000-0000-4000-e500-000000000002', '00000000-0000-4000-e400-000000000013', 'on_it');
select pg_temp.slot('00000000-0000-4000-e600-000000000003', '00000000-0000-4000-e500-000000000003', '00000000-0000-4000-e400-000000000013', 'awaiting_response');
select pg_temp.slot('00000000-0000-4000-e600-000000000004', '00000000-0000-4000-e500-000000000004', '00000000-0000-4000-e400-000000000013', 'awaiting_response');
select pg_temp.new_task('00000000-0000-4000-e500-000000000005', 'to_do', false);
select pg_temp.slot('00000000-0000-4000-e600-000000000006', '00000000-0000-4000-e500-000000000005', '00000000-0000-4000-e400-000000000013', 'needs_reassignment');
insert into public.assignment_reasons (assignment_id, reason)
values ('00000000-0000-4000-e600-000000000006', 'Own reason');
select pg_temp.slot('00000000-0000-4000-e600-000000000005', '00000000-0000-4000-e500-000000000001', '00000000-0000-4000-e400-00000000000c', 'on_it');

-- Pins.

select is(
  (select bool_and(p.prosecdef and p.proconfig = array['search_path=""'])
   from pg_proc p
   where p.oid in ('public.update_member(uuid, text[], text)'::regprocedure,
                   'public.deactivate_member(uuid)'::regprocedure)),
  true, 'both commands are security definer with an empty search_path');
select is(
  (select bool_and(strpos(p.prosrc, 'members:roster_guard') > 0
                   and strpos(p.prosrc, 'members:roster_guard')
                       < strpos(p.prosrc, 'for update')
                   and p.prosrc ~ 'recent_mfa')
   from pg_proc p
   where p.oid in ('public.update_member(uuid, text[], text)'::regprocedure,
                   'public.deactivate_member(uuid)'::regprocedure)),
  true, 'the roster advisory lock comes before the target lock and the guards');
select is(
  (select strpos(p.prosrc, 'members:roster_guard') < strpos(p.prosrc, 'deactivation_guard')
   from pg_proc p where p.oid = 'public.deactivate_member(uuid)'::regprocedure),
  true, 'deactivate_member locks before its guard');
select is(
  (select strpos(p.prosrc, 'members:roster_guard') < strpos(p.prosrc, 'change_own_positions')
   from pg_proc p where p.oid = 'public.update_member(uuid, text[], text)'::regprocedure),
  true, 'update_member locks before its guards');
select is(
  (select not has_function_privilege('authenticated',
     'private.release_member_slots(uuid, uuid, uuid)', 'execute')),
  true, 'release_member_slots is granted to no API role');

-- Refusals, the four callers: stale code, staff, deactivated former admin,
-- pending.

select is(
  array[
    pg_temp.attempt('00000000-0000-4000-e400-00000000000a', pg_temp.amr('totp', 20),
      $q$ select public.update_member('00000000-0000-4000-e400-00000000000c', array['staff_writer'], 'staff_writer') $q$),
    pg_temp.attempt('00000000-0000-4000-e400-00000000000a', null,
      $q$ select public.update_member('00000000-0000-4000-e400-00000000000c', array['staff_writer'], 'staff_writer') $q$),
    pg_temp.attempt('00000000-0000-4000-e400-00000000000a', pg_temp.amr('totp', 20),
      $q$ select public.deactivate_member('00000000-0000-4000-e400-00000000000c') $q$),
    pg_temp.attempt('00000000-0000-4000-e400-00000000000a', pg_temp.amr('oauth', 1),
      $q$ select public.deactivate_member('00000000-0000-4000-e400-00000000000c') $q$)
  ],
  array['P0001 auth.step_up_required', 'P0001 auth.step_up_required',
        'P0001 auth.step_up_required', 'P0001 auth.step_up_required'],
  'a stale, missing or OAuth-only code is refused by both commands');

select is(
  array[
    pg_temp.attempt('00000000-0000-4000-e400-000000000010', pg_temp.amr('totp', 1),
      $q$ select public.update_member('00000000-0000-4000-e400-00000000000c', array['staff_writer'], 'staff_writer') $q$),
    pg_temp.attempt('00000000-0000-4000-e400-000000000011', pg_temp.amr('totp', 1),
      $q$ select public.update_member('00000000-0000-4000-e400-00000000000c', array['staff_writer'], 'staff_writer') $q$),
    pg_temp.attempt('00000000-0000-4000-e400-000000000012', pg_temp.amr('totp', 1),
      $q$ select public.update_member('00000000-0000-4000-e400-00000000000c', array['staff_writer'], 'staff_writer') $q$),
    pg_temp.attempt('00000000-0000-4000-e400-000000000010', pg_temp.amr('totp', 1),
      $q$ select public.deactivate_member('00000000-0000-4000-e400-00000000000c') $q$),
    pg_temp.attempt('00000000-0000-4000-e400-000000000011', pg_temp.amr('totp', 1),
      $q$ select public.deactivate_member('00000000-0000-4000-e400-00000000000c') $q$),
    pg_temp.attempt('00000000-0000-4000-e400-000000000012', pg_temp.amr('totp', 1),
      $q$ select public.deactivate_member('00000000-0000-4000-e400-00000000000c') $q$)
  ],
  array['P0001 members.not_admin', 'P0001 auth.not_active', 'P0001 auth.not_active',
        'P0001 members.not_admin', 'P0001 auth.not_active', 'P0001 auth.not_active'],
  'staff, a deactivated former admin and a pending caller are refused by both commands');

select is(
  array[
    pg_temp.attempt('00000000-0000-4000-e400-00000000000a', pg_temp.amr('totp', 1),
      $q$ select public.update_member('00000000-0000-4000-e400-00000000000c', null, 'staff_writer') $q$),
    pg_temp.attempt('00000000-0000-4000-e400-00000000000a', pg_temp.amr('totp', 1),
      $q$ select public.update_member('00000000-0000-4000-e400-00000000000c', array['nope'], 'nope') $q$),
    pg_temp.attempt('00000000-0000-4000-e400-00000000000a', pg_temp.amr('totp', 1),
      $q$ select public.update_member('00000000-0000-4000-e400-00000000000c', array['staff_writer'], 'sports_editor') $q$),
    pg_temp.attempt('00000000-0000-4000-e400-00000000000a', pg_temp.amr('totp', 1),
      $q$ select public.update_member('00000000-0000-4000-e400-0000000000ff', array['staff_writer'], 'staff_writer') $q$),
    pg_temp.attempt('00000000-0000-4000-e400-00000000000a', pg_temp.amr('totp', 1),
      $q$ select public.update_member('00000000-0000-4000-e400-00000000000a', array['staff_writer'], 'staff_writer') $q$),
    pg_temp.attempt('00000000-0000-4000-e400-00000000000a', pg_temp.amr('totp', 1),
      $q$ select public.update_member('00000000-0000-4000-e400-000000000012', array['staff_writer'], 'staff_writer') $q$),
    pg_temp.attempt('00000000-0000-4000-e400-00000000000a', pg_temp.amr('totp', 1),
      $q$ select public.update_member('00000000-0000-4000-e400-000000000011', array['staff_writer'], 'staff_writer') $q$)
  ],
  array['P0001 members.no_positions', 'P0001 members.invalid_position',
        'P0001 members.invalid_primary', 'P0001 members.not_found',
        'P0001 members.change_own_positions', 'P0001 members.stale',
        'P0001 members.stale'],
  'update_member refuses empty, unknown, primary-less, missing, own, pending and deactivated');

select is(
  array[
    pg_temp.attempt('00000000-0000-4000-e400-00000000000a', pg_temp.amr('totp', 1),
      $q$ select public.update_member('00000000-0000-4000-e400-00000000000c', array['staff_writer', 'editor_in_chief'], 'staff_writer') $q$),
    pg_temp.attempt('00000000-0000-4000-e400-00000000000a', pg_temp.amr('totp', 1),
      $q$ select public.update_member('00000000-0000-4000-e400-00000000000d', array['sports_editor'], 'sports_editor') $q$),
    pg_temp.attempt('00000000-0000-4000-e400-00000000000a', pg_temp.amr('totp', 1),
      $q$ select public.update_member('00000000-0000-4000-e400-00000000000d', array['editor_in_chief', 'sports_editor'], 'sports_editor') $q$)
  ],
  array['P0001 members.invalid_position', 'P0001 members.invalid_position', 'ok'],
  'Editor-in-Chief is neither added nor removed, and the holder may keep it non-primary');

select is(
  array[
    pg_temp.attempt('00000000-0000-4000-e400-00000000000a', pg_temp.amr('totp', 1),
      $q$ select public.deactivate_member('00000000-0000-4000-e400-0000000000ff') $q$),
    pg_temp.attempt('00000000-0000-4000-e400-00000000000a', pg_temp.amr('totp', 1),
      $q$ select public.deactivate_member('00000000-0000-4000-e400-00000000000a') $q$),
    pg_temp.attempt('00000000-0000-4000-e400-00000000000a', pg_temp.amr('totp', 1),
      $q$ select public.deactivate_member('00000000-0000-4000-e400-00000000000d') $q$),
    pg_temp.attempt('00000000-0000-4000-e400-00000000000d', pg_temp.amr('totp', 1),
      $q$ select public.deactivate_member('00000000-0000-4000-e400-00000000000d') $q$),
    pg_temp.attempt('00000000-0000-4000-e400-00000000000a', pg_temp.amr('totp', 1),
      $q$ select public.deactivate_member('00000000-0000-4000-e400-000000000012') $q$),
    pg_temp.attempt('00000000-0000-4000-e400-00000000000a', pg_temp.amr('totp', 1),
      $q$ select public.deactivate_member('00000000-0000-4000-e400-000000000011') $q$)
  ],
  array['P0001 members.not_found', 'P0001 members.deactivate_self',
        'P0001 members.sole_editor_in_chief', 'P0001 members.sole_editor_in_chief',
        'P0001 members.stale', 'P0001 members.stale'],
  'deactivate_member refuses missing, own, the Editor-in-Chief (also as caller), pending and deactivated');

-- The guard helper.

select is(
  array[private.deactivation_guard('00000000-0000-4000-e400-00000000000d'), private.deactivation_guard('00000000-0000-4000-e400-00000000000c'),
        private.deactivation_guard('00000000-0000-4000-e400-00000000000b')],
  array['members.sole_editor_in_chief', null, null]::text[],
  'the guard names the Editor-in-Chief and no one else while two admins remain');

-- Changing positions: role and approver rights follow at once.

select is(
  pg_temp.attempt('00000000-0000-4000-e400-00000000000a', pg_temp.amr('totp', 1),
    $q$ select public.update_member('00000000-0000-4000-e400-000000000014', array['staff_layout_artist', 'head_layout_artist'], 'head_layout_artist') $q$),
  'ok', 'a fresh code changes positions');

select pg_temp.claims('00000000-0000-4000-e400-00000000000a', pg_temp.amr('totp', 1));
set local role authenticated;
select public.update_member('00000000-0000-4000-e400-000000000014', array['staff_layout_artist', 'head_layout_artist'], 'head_layout_artist');
set local role postgres;

select is(
  (select m.role::text from public.members m where m.id = '00000000-0000-4000-e400-000000000014'),
  'editorial_admin', 'a Board position makes the member an admin');
select is(
  (select array_agg(mp.position order by mp.position) || array[(select mp2.position from public.member_positions mp2 where mp2.member_id = '00000000-0000-4000-e400-000000000014' and mp2.is_primary)]
   from public.member_positions mp where mp.member_id = '00000000-0000-4000-e400-000000000014'),
  array['head_layout_artist', 'staff_layout_artist', 'head_layout_artist'],
  'the positions are replaced with one primary');
select is(
  (select count(*) from public.member_positions mp where mp.member_id = '00000000-0000-4000-e400-000000000014' and mp.is_primary),
  1::bigint, 'exactly one primary');
select is(
  (select count(*) from public.activity a
   where a.entity_type = 'member' and a.action = 'positions_changed'
     and a.entity_id = '00000000-0000-4000-e400-000000000014' and a.actor_id = '00000000-0000-4000-e400-00000000000a'),
  1::bigint, 'one positions_changed row');

select is(
  pg_temp.run_as('00000000-0000-4000-e400-000000000014', null,
    $q$ select private.is_task_approver('00000000-0000-4000-e500-000000000001')::text $q$),
  'true', 'the new head approves layout tasks');

select pg_temp.claims('00000000-0000-4000-e400-00000000000a', pg_temp.amr('totp', 1));
set local role authenticated;
select public.update_member('00000000-0000-4000-e400-000000000014', array['staff_writer'], 'staff_writer');
set local role postgres;

select is(
  (select m.role::text from public.members m where m.id = '00000000-0000-4000-e400-000000000014'),
  'staff', 'demoting to Staff positions makes the role staff at once');
select is(
  pg_temp.run_as('00000000-0000-4000-e400-000000000014', null,
    $q$ select private.is_task_approver('00000000-0000-4000-e500-000000000001')::text $q$),
  'false', 'approver rights are gone');
select is(
  pg_temp.run_as('00000000-0000-4000-e400-000000000014', null, $q$ select private.is_top_editor()::text $q$),
  'false', 'top-editor status is gone');

-- Capabilities agree with the commands.

create temp table matrix (caller uuid, target uuid, upd text, deact text,
  can_change boolean, can_deactivate boolean, blocked text);

do $$
declare
  c uuid;
  t uuid;
  v_cap record;
begin
  foreach c in array array['00000000-0000-4000-e400-00000000000a', '00000000-0000-4000-e400-00000000000d', '00000000-0000-4000-e400-000000000010', '00000000-0000-4000-e400-000000000011', '00000000-0000-4000-e400-000000000012']::uuid[]
  loop
    foreach t in array array['00000000-0000-4000-e400-00000000000a', '00000000-0000-4000-e400-00000000000b', '00000000-0000-4000-e400-00000000000c', '00000000-0000-4000-e400-00000000000d', '00000000-0000-4000-e400-000000000011', '00000000-0000-4000-e400-000000000012']::uuid[]
    loop
      perform pg_temp.claims(c, pg_temp.amr('totp', 1));
      set local role authenticated;
      select mc.can_change_positions, mc.can_deactivate, mc.deactivate_blocked_by
        into v_cap
      from public.member_capabilities(array[t]) mc;
      set local role postgres;
      insert into matrix values (c, t,
        pg_temp.attempt(c, pg_temp.amr('totp', 1), format(
          $q$ select public.update_member(%L, array['staff_writer'], 'staff_writer') $q$, t)),
        pg_temp.attempt(c, pg_temp.amr('totp', 1), format(
          $q$ select public.deactivate_member(%L) $q$, t)),
        coalesce(v_cap.can_change_positions, false),
        coalesce(v_cap.can_deactivate, false),
        v_cap.deactivate_blocked_by);
    end loop;
  end loop;
  perform set_config('request.jwt.claims', '', true);
end
$$;

-- update_member on the EIC with a set that omits it is refused by the
-- command's Editor-in-Chief rule, so compare only where the set is valid:
-- every target except D.
select is(
  (select count(*) from matrix
   where target <> '00000000-0000-4000-e400-00000000000d' and (upd = 'ok') is distinct from can_change),
  0::bigint, 'can_change_positions equals "update_member accepts" for every caller and target');
select is(
  (select count(*) from matrix
   where (deact = 'ok') is distinct from (can_deactivate and blocked is null)),
  0::bigint, 'can_deactivate without a blocker equals "deactivate_member accepts"');
select is(
  (select array_agg(target::text order by target) from matrix
   where can_deactivate and caller = '00000000-0000-4000-e400-00000000000a'),
  array['00000000-0000-4000-e400-00000000000b', '00000000-0000-4000-e400-00000000000c', '00000000-0000-4000-e400-00000000000d']::text[],
  'admin A is offered B, C and D (D blocked), never their own row');
select is(
  (select blocked from matrix where caller = '00000000-0000-4000-e400-00000000000a' and target = '00000000-0000-4000-e400-00000000000d'),
  'members.sole_editor_in_chief', 'the Editor-in-Chief row says why');
select is(
  (select count(*) from matrix
   where (can_change or can_deactivate)
     and caller in ('00000000-0000-4000-e400-000000000010', '00000000-0000-4000-e400-000000000011', '00000000-0000-4000-e400-000000000012')),
  0::bigint, 'staff, deactivated and pending callers are offered nothing');
select is(
  (select count(*) from matrix where can_change and caller = target),
  0::bigint, 'no one is offered their own row');

-- Deactivation.

select is(
  pg_temp.attempt('00000000-0000-4000-e400-00000000000a', pg_temp.amr('totp', 5),
    $q$ select public.deactivate_member('00000000-0000-4000-e400-000000000013') $q$),
  'ok', 'a fresh code deactivates');

select pg_temp.claims('00000000-0000-4000-e400-00000000000a', pg_temp.amr('totp', 5));
set local role authenticated;
select public.deactivate_member('00000000-0000-4000-e400-000000000013');
set local role postgres;

select is(
  (select m.deactivated_at is not null and m.role = 'staff'
   from public.members m where m.id = '00000000-0000-4000-e400-000000000013'),
  true, 'deactivated_at is set and the role is kept');
select is(
  (select count(*) from public.member_positions mp where mp.member_id = '00000000-0000-4000-e400-000000000013'),
  1::bigint, 'positions are kept');
select is(
  (select array_agg(a.state::text order by a.id) from public.task_assignments a
   where a.member_id = '00000000-0000-4000-e400-000000000013'),
  array['needs_reassignment', 'on_it', 'awaiting_response', 'needs_reassignment', 'needs_reassignment'],
  'slots on live non-Done tasks are released; Done and deleted ones are untouched');
select is(
  (select array_agg(r.assignment_id order by r.assignment_id) from public.assignment_reasons r
   where r.reason = 'Member deactivated'),
  array['00000000-0000-4000-e600-000000000001', '00000000-0000-4000-e600-000000000004']::uuid[],
  'the released slots carry "Member deactivated"');
select is(
  (select reason from public.assignment_reasons
   where assignment_id = '00000000-0000-4000-e600-000000000006'),
  'Own reason', 'a slot already handed back keeps its own reason');
select is(
  (select count(*) from public.activity a
   where a.entity_id = '00000000-0000-4000-e600-000000000006'
     and a.action = 'slot_needs_reassignment'),
  0::bigint, 'and is not logged again');
select is(
  (select state::text from public.task_assignments
   where id = '00000000-0000-4000-e600-000000000005'),
  'on_it', 'another member''s slot is untouched');
select is(
  (select count(*) from public.activity a
   where a.entity_type = 'task_assignment' and a.action = 'slot_needs_reassignment'
     and a.actor_id = '00000000-0000-4000-e400-00000000000a'
     and a.entity_id in ('00000000-0000-4000-e600-000000000001',
                         '00000000-0000-4000-e600-000000000004')),
  2::bigint, 'each released slot is logged');
select is(
  (select count(*) from public.activity a
   where a.entity_type = 'member' and a.action = 'deactivated'
     and a.entity_id = '00000000-0000-4000-e400-000000000013' and a.actor_id = '00000000-0000-4000-e400-00000000000a'),
  1::bigint, 'one deactivated row');
select is(
  (select count(distinct a.op_id) from public.activity a
   where a.actor_id = '00000000-0000-4000-e400-00000000000a' and a.created_at = (select max(created_at) from public.activity)
     and a.action in ('deactivated', 'slot_needs_reassignment')),
  1::bigint, 'the deactivation and its releases share one op_id');
select is(
  (select count(*) from public.member_directory d where d.id = '00000000-0000-4000-e400-000000000013'),
  0::bigint, 'the member left the directory');
select is(
  pg_temp.run_as('00000000-0000-4000-e400-000000000013', null, $q$ select count(*)::text from public.tasks $q$),
  '0', 'the deactivated member reads no tasks');
select is(
  pg_temp.attempt('00000000-0000-4000-e400-00000000000a', pg_temp.amr('totp', 1),
    $q$ select public.deactivate_member('00000000-0000-4000-e400-000000000013') $q$),
  'P0001 members.stale', 'deactivating twice is stale');

-- The last-admin race, sequentially: A demotes B, then B's demotion of A is
-- refused. With A the only admin left, the guard names them.

select pg_temp.claims('00000000-0000-4000-e400-00000000000a', pg_temp.amr('totp', 1));
set local role authenticated;
select public.update_member('00000000-0000-4000-e400-00000000000b', array['staff_writer'], 'staff_writer');
set local role postgres;

select is(
  pg_temp.attempt('00000000-0000-4000-e400-00000000000b', pg_temp.amr('totp', 1),
    $q$ select public.update_member('00000000-0000-4000-e400-00000000000a', array['staff_writer'], 'staff_writer') $q$),
  'P0001 members.not_admin', 'the demoted second admin can no longer demote the first');

-- One admin left among the active members.
update public.members set deactivated_at = now()
where role = 'editorial_admin' and id <> '00000000-0000-4000-e400-00000000000a';
select is(
  private.deactivation_guard('00000000-0000-4000-e400-00000000000a'), 'members.last_admin',
  'the guard refuses the last active admin');

select * from finish();

rollback;
