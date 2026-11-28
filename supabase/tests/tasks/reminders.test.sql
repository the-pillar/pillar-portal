-- Deadline reminders (Story 4.3): the window, who is eligible, the enqueue
-- and its dedupe, the send-time check, and the grants.
--
-- - `private.tasks_due_for_reminder(p_now)` is tested at a fixed `p_now`
--   (Dec 1 2026, 09:30 Manila): due 08:59 tomorrow is in, 09:00 tomorrow and
--   anything already past are out.
-- - `public.enqueue_due_reminders()` runs at the real now, so its fixtures
--   are due tomorrow 08:30 Manila, computed in SQL.
--
-- Fixtures are created here and rolled back; the outbox is emptied (inside
-- the transaction) first so a real queued row can't change a result. It runs
-- locally and on staging (`supabase test db --linked`).

begin;

-- See members/members.test.sql: run as `postgres` with `extensions` on the
-- path, whichever role `supabase test db --linked` connected as.
set local role postgres;
set local search_path = "$user", public, extensions;

select plan(24);

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

create function pg_temp.attempt_as(p_caller uuid, p_call text)
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

create function pg_temp.new_task(
  p_id uuid, p_due timestamptz, p_column public.task_column default 'to_do'
)
returns void
language sql as $$
  insert into public.tasks (id, title, owning_desk_id, due_at, "column", done_at)
  values (p_id, 'Reminder task ' || right(p_id::text, 4), 'layout', p_due,
          p_column, case when p_column = 'done' then now() end)
$$;

create function pg_temp.new_slot(
  p_task uuid, p_member uuid, p_role public.production_role,
  p_state public.slot_state default 'on_it'
)
returns void
language sql as $$
  insert into public.task_assignments (task_id, member_id, role, state)
  values (p_task, p_member, p_role, p_state)
$$;

-- d1 pending, d2 declined, d3 deactivated, d4 active staff, d5 active admin.
select pg_temp.new_member('00000000-0000-4000-a000-0000000000d1', 'rm-pending@example.com', null);
select pg_temp.new_member('00000000-0000-4000-a000-0000000000d2', 'rm-declined@example.com', null);
select pg_temp.new_member('00000000-0000-4000-a000-0000000000d3', 'rm-deactivated@example.com', 'head_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-0000000000d4', 'rm-staff@example.com', 'staff_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-0000000000d5', 'rm-admin@example.com', 'sports_editor');

update public.members set declined_at = now()
where id = '00000000-0000-4000-a000-0000000000d2';
update public.members set deactivated_at = now()
where id = '00000000-0000-4000-a000-0000000000d3';

delete from public.email_outbox;

-- The window, at p_now = 2026-12-01 09:30 Manila.

select pg_temp.new_task('00000000-0000-4000-a100-000000000001', '2026-12-02T08:59:00+08');
select pg_temp.new_task('00000000-0000-4000-a100-000000000002', '2026-12-02T09:00:00+08');
select pg_temp.new_task('00000000-0000-4000-a100-000000000003', '2026-12-01T09:00:00+08');
select pg_temp.new_task('00000000-0000-4000-a100-000000000004', '2026-12-02T08:00:00+08', 'done');
select pg_temp.new_task('00000000-0000-4000-a100-000000000005', '2026-12-02T08:00:00+08');
select pg_temp.new_task('00000000-0000-4000-a100-000000000006', '2026-12-02T08:00:00+08');
select pg_temp.new_task('00000000-0000-4000-a100-000000000007', '2026-12-02T08:00:00+08');
select pg_temp.new_task('00000000-0000-4000-a100-000000000008', '2026-12-02T07:00:00+08');

select pg_temp.new_slot('00000000-0000-4000-a100-000000000001', '00000000-0000-4000-a000-0000000000d4', 'layout_artist');
select pg_temp.new_slot('00000000-0000-4000-a100-000000000002', '00000000-0000-4000-a000-0000000000d4', 'layout_artist');
select pg_temp.new_slot('00000000-0000-4000-a100-000000000003', '00000000-0000-4000-a000-0000000000d4', 'layout_artist');
select pg_temp.new_slot('00000000-0000-4000-a100-000000000004', '00000000-0000-4000-a000-0000000000d4', 'layout_artist');
-- 5: soft-deleted. 6: slot handed back. 7: inactive members only.
select pg_temp.new_slot('00000000-0000-4000-a100-000000000005', '00000000-0000-4000-a000-0000000000d4', 'layout_artist');
select pg_temp.new_slot('00000000-0000-4000-a100-000000000006', '00000000-0000-4000-a000-0000000000d4', 'layout_artist', 'needs_reassignment');
select pg_temp.new_slot('00000000-0000-4000-a100-000000000007', '00000000-0000-4000-a000-0000000000d3', 'layout_artist');
select pg_temp.new_slot('00000000-0000-4000-a100-000000000007', '00000000-0000-4000-a000-0000000000d1', 'writer');
-- 8: two slots, one member.
select pg_temp.new_slot('00000000-0000-4000-a100-000000000008', '00000000-0000-4000-a000-0000000000d4', 'writer', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-a100-000000000008', '00000000-0000-4000-a000-0000000000d4', 'layout_artist');

update public.tasks set deleted_at = now()
where id = '00000000-0000-4000-a100-000000000005';

select results_eq(
  $$ select task_id::text collate "default", member_id::text collate "default", roles
     from private.tasks_due_for_reminder('2026-12-01T09:30:00+08')
     order by task_id $$,
  $$ values ('00000000-0000-4000-a100-000000000001',
             '00000000-0000-4000-a000-0000000000d4', array['layout_artist']),
            ('00000000-0000-4000-a100-000000000008',
             '00000000-0000-4000-a000-0000000000d4',
             array['layout_artist', 'writer']) $$,
  'due 08:59 tomorrow is in; 09:00 tomorrow, past, Done, deleted, handed-back and inactive-member slots are out; two slots make one row with both roles');

select is(
  (select count(*)::int from private.tasks_due_for_reminder('2026-12-01T09:30:00+08')
   where task_id = '00000000-0000-4000-a100-000000000002'),
  0, 'a task due 09:00 tomorrow is out');

select is(
  (select count(*)::int from private.tasks_due_for_reminder('2026-12-01T00:00:00+08')
   where task_id = '00000000-0000-4000-a100-000000000003'),
  1, 'the window follows p_now: at midnight Dec 1, a task due 09:00 Dec 1 is in');

select is(
  (select count(*)::int from private.tasks_due_for_reminder('2026-12-01T09:30:00+08')
   where task_id = '00000000-0000-4000-a100-000000000003'),
  0, 'a task already past is out');

-- enqueue_due_reminders at the real now.

create temp table soon (id uuid primary key, due timestamptz);
insert into soon values (
  '00000000-0000-4000-a100-0000000000a1',
  (date_trunc('day', now() at time zone 'Asia/Manila') + interval '1 day 8 hours 30 minutes')
    at time zone 'Asia/Manila');

select pg_temp.new_task('00000000-0000-4000-a100-0000000000a1', (select due from soon));
select pg_temp.new_slot('00000000-0000-4000-a100-0000000000a1', '00000000-0000-4000-a000-0000000000d4', 'writer', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-a100-0000000000a1', '00000000-0000-4000-a000-0000000000d4', 'layout_artist');
select pg_temp.new_slot('00000000-0000-4000-a100-0000000000a1', '00000000-0000-4000-a000-0000000000d5', 'cartoonist');

-- Other tasks the real now may catch (the seed's) are cleared first.
delete from public.email_outbox;

select is(
  (select count(*)::int from public.enqueue_due_reminders() e
   cross join lateral (select 1) x
   where e >= 2),
  1, 'enqueue_due_reminders returns how many it queued (at least our two)');

select is(
  (select count(*)::int from public.email_outbox
   where task_id = '00000000-0000-4000-a100-0000000000a1'),
  2, 'one row per member: the two-slot member and the admin');

select results_eq(
  $$ select kind::text collate "default", template, priority::int,
            payload ->> 'title', payload -> 'roles',
            payload ->> 'due_at'
     from public.email_outbox
     where task_id = '00000000-0000-4000-a100-0000000000a1'
       and recipient_member_id = '00000000-0000-4000-a000-0000000000d4' $$,
  $$ select 'reminder', 'reminder', 1,
            (select title from public.tasks where id = '00000000-0000-4000-a100-0000000000a1'),
            '["layout_artist","writer"]'::jsonb,
            to_char((select due from soon) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$,
  'the row is a reminder with the title, both roles sorted and the due time as UTC ISO');

select is(
  (select dedupe_key from public.email_outbox
   where task_id = '00000000-0000-4000-a100-0000000000a1'
     and recipient_member_id = '00000000-0000-4000-a000-0000000000d4'),
  'reminder:00000000-0000-4000-a100-0000000000a1:00000000-0000-4000-a000-0000000000d4:'
    || to_char((select due from soon) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'the dedupe key is reminder:<task>:<member>:<due UTC ISO>');

select is(
  public.enqueue_due_reminders(), 0,
  'a rerun queues nothing');

update public.tasks set due_at = due_at - interval '1 hour'
where id = '00000000-0000-4000-a100-0000000000a1';

select is(
  (select count(*)::int from (select public.enqueue_due_reminders()) q
   where q.enqueue_due_reminders >= 2),
  1, 'a moved due time (still in the window) queues fresh rows');

-- The send check.

create function pg_temp.check_of(p_member uuid)
returns text
language sql as $$
  select private.email_send_check_reminder(o.id)
  from public.email_outbox o
  where o.task_id = '00000000-0000-4000-a100-0000000000a1'
    and o.recipient_member_id = p_member
    and o.payload ->> 'due_at' = to_char(
      (select due from soon) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- The first time (before the move) is now stale; the new row carries the new
-- due time.
select is(
  pg_temp.check_of('00000000-0000-4000-a000-0000000000d4'),
  'reminder.due_changed',
  'a reminder whose task due time has moved is dropped as reminder.due_changed');

-- Move it back: the original row is fresh again.
update public.tasks set due_at = (select due from soon)
where id = '00000000-0000-4000-a100-0000000000a1';

select is(
  pg_temp.check_of('00000000-0000-4000-a000-0000000000d4'),
  null, 'a fresh reminder passes the send check');

update public.task_assignments set state = 'needs_reassignment'
where task_id = '00000000-0000-4000-a100-0000000000a1'
  and member_id = '00000000-0000-4000-a000-0000000000d5';
select is(
  pg_temp.check_of('00000000-0000-4000-a000-0000000000d5'),
  'reminder.slot_closed', 'a handed-back slot is dropped as reminder.slot_closed');
update public.task_assignments set state = 'on_it'
where task_id = '00000000-0000-4000-a100-0000000000a1'
  and member_id = '00000000-0000-4000-a000-0000000000d5';

update public.members set deactivated_at = now()
where id = '00000000-0000-4000-a000-0000000000d5';
select is(
  pg_temp.check_of('00000000-0000-4000-a000-0000000000d5'),
  'reminder.member_inactive', 'an inactive member is dropped as reminder.member_inactive');
update public.members set deactivated_at = null
where id = '00000000-0000-4000-a000-0000000000d5';

update public.tasks set due_at = now() - interval '1 minute'
where id = '00000000-0000-4000-a100-0000000000a1';
update public.email_outbox
set payload = jsonb_set(payload, '{due_at}', to_jsonb(to_char(
  (select due_at from public.tasks where id = '00000000-0000-4000-a100-0000000000a1')
    at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
where task_id = '00000000-0000-4000-a100-0000000000a1'
  and recipient_member_id = '00000000-0000-4000-a000-0000000000d4'
  and payload ->> 'due_at' = to_char(
    (select due from soon) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
select is(
  (select private.email_send_check_reminder(o.id)
   from public.email_outbox o
   where o.task_id = '00000000-0000-4000-a100-0000000000a1'
     and o.recipient_member_id = '00000000-0000-4000-a000-0000000000d4'
     and (o.payload ->> 'due_at')::timestamptz < now()),
  'reminder.past_due', 'a reminder whose due time has passed is dropped as reminder.past_due');

update public.tasks set due_at = (select due from soon)
where id = '00000000-0000-4000-a100-0000000000a1';

update public.tasks set "column" = 'done', done_at = now()
where id = '00000000-0000-4000-a100-0000000000a1';
select is(
  (select private.email_send_check_reminder(o.id) from public.email_outbox o
   where o.task_id = '00000000-0000-4000-a100-0000000000a1'
     and o.recipient_member_id = '00000000-0000-4000-a000-0000000000d5'
   limit 1),
  'reminder.task_gone', 'a Done task is dropped as reminder.task_gone');

update public.tasks set "column" = 'to_do', done_at = null, deleted_at = now()
where id = '00000000-0000-4000-a100-0000000000a1';
select is(
  (select private.email_send_check_reminder(o.id) from public.email_outbox o
   where o.task_id = '00000000-0000-4000-a100-0000000000a1'
     and o.recipient_member_id = '00000000-0000-4000-a000-0000000000d5'
   limit 1),
  'reminder.task_gone', 'a deleted task is dropped as reminder.task_gone');

select is(
  private.email_send_check_reminder('00000000-0000-4000-a900-000000000000'),
  'reminder.row_gone', 'a row that is gone is dropped as reminder.row_gone');

-- Through the drain's own command: prepare_email_send drops with the code.
update public.tasks set deleted_at = null
where id = '00000000-0000-4000-a100-0000000000a1';
update public.email_outbox set status = 'sending', attempt_count = 1
where task_id = '00000000-0000-4000-a100-0000000000a1'
  and recipient_member_id = '00000000-0000-4000-a000-0000000000d5'
  and (payload ->> 'due_at')::timestamptz = (select due from soon);
update public.tasks set due_at = due_at + interval '2 hours'
where id = '00000000-0000-4000-a100-0000000000a1';

select is(
  (select outcome from public.prepare_email_send(
     (select id from public.email_outbox
      where task_id = '00000000-0000-4000-a100-0000000000a1'
        and recipient_member_id = '00000000-0000-4000-a000-0000000000d5'
        and status = 'sending'), 1)),
  'dropped', 'prepare_email_send drops a stale reminder');

select is(
  (select error from public.email_outbox
   where task_id = '00000000-0000-4000-a100-0000000000a1'
     and recipient_member_id = '00000000-0000-4000-a000-0000000000d5'
     and status = 'dropped'),
  'reminder.due_changed', 'and keeps the reminder code as the row''s error');

-- Pins and grants.

select results_eq(
  $$ select p.prosecdef, p.proconfig::text[] collate "default"
     from pg_proc p
     where p.oid in (
       'private.tasks_due_for_reminder(timestamptz)'::regprocedure,
       'public.enqueue_due_reminders()'::regprocedure,
       'private.email_send_check_reminder(uuid)'::regprocedure)
     order by p.proname $$,
  $$ values (true, array['search_path=""']),
            (true, array['search_path=""']),
            (true, array['search_path=""']) $$,
  'the three functions are security definer with search_path = ''''');

select is(
  array[
    has_function_privilege('service_role', 'public.enqueue_due_reminders()', 'EXECUTE'),
    has_function_privilege('service_role', 'private.tasks_due_for_reminder(timestamptz)', 'EXECUTE'),
    has_function_privilege('service_role', 'private.email_send_check_reminder(uuid)', 'EXECUTE'),
    has_function_privilege('anon', 'public.enqueue_due_reminders()', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.enqueue_due_reminders()', 'EXECUTE')
  ],
  array[true, false, false, false, false],
  'only service_role executes enqueue_due_reminders; the private functions are granted to nobody');

select is(
  array[
    pg_temp.attempt_as('00000000-0000-4000-a000-0000000000d1', $q$ select public.enqueue_due_reminders() $q$),
    pg_temp.attempt_as('00000000-0000-4000-a000-0000000000d2', $q$ select public.enqueue_due_reminders() $q$),
    pg_temp.attempt_as('00000000-0000-4000-a000-0000000000d3', $q$ select public.enqueue_due_reminders() $q$),
    pg_temp.attempt_as('00000000-0000-4000-a000-0000000000d4', $q$ select public.enqueue_due_reminders() $q$),
    pg_temp.attempt_as('00000000-0000-4000-a000-0000000000d5', $q$ select public.enqueue_due_reminders() $q$)
  ],
  array[
    '42501 permission denied for function enqueue_due_reminders',
    '42501 permission denied for function enqueue_due_reminders',
    '42501 permission denied for function enqueue_due_reminders',
    '42501 permission denied for function enqueue_due_reminders',
    '42501 permission denied for function enqueue_due_reminders'
  ],
  'pending, declined, deactivated, staff and admin callers are all denied');

select is(
  array[
    pg_temp.attempt_as('00000000-0000-4000-a000-0000000000d5',
      $q$ select * from private.tasks_due_for_reminder() $q$),
    pg_temp.attempt_as('00000000-0000-4000-a000-0000000000d5',
      $q$ select private.email_send_check_reminder(gen_random_uuid()) $q$)
  ],
  array[
    '42501 permission denied for function tasks_due_for_reminder',
    '42501 permission denied for function email_send_check_reminder'
  ],
  'the private functions are out of reach of an admin');

select * from finish();
rollback;
