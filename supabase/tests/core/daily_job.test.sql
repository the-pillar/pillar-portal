-- The daily job's database side (Story 4.3): record_job_step, the shared
-- session sweep and retention.
--
-- Job names here start `pgtap_`, so a real `daily` run can't change what
-- these commands do. Fixtures are created here and rolled back. It runs
-- locally and on staging (`supabase test db --linked`).

begin;

-- See members/members.test.sql: run as `postgres` with `extensions` on the
-- path, whichever role `supabase test db --linked` connected as.
set local role postgres;
set local search_path = "$user", public, extensions;

select plan(23);

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

create function pg_temp.attempt(p_call text)
returns text
language plpgsql as $$
declare
  v_constraint text;
begin
  execute p_call;
  raise exception using errcode = 'P0001', message = 'probe.accepted';
exception when others then
  get stacked diagnostics v_constraint = constraint_name;
  return case
    when sqlerrm = 'probe.accepted' then 'ok'
    when sqlstate = '23514' then sqlstate || ' ' || v_constraint
    else sqlstate || ' ' || sqlerrm
  end;
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

select pg_temp.new_member('00000000-0000-4000-a000-0000000000c1', 'dj-pending@example.com', null);
select pg_temp.new_member('00000000-0000-4000-a000-0000000000c2', 'dj-declined@example.com', null);
select pg_temp.new_member('00000000-0000-4000-a000-0000000000c3', 'dj-deactivated@example.com', 'head_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-0000000000c4', 'dj-staff@example.com', 'staff_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-0000000000c5', 'dj-admin@example.com', 'sports_editor');

update public.members set declined_at = now()
where id = '00000000-0000-4000-a000-0000000000c2';
update public.members set deactivated_at = now()
where id = '00000000-0000-4000-a000-0000000000c3';

-- record_job_step.

create temp table runs (label text primary key, id bigint);
insert into runs select 'open', public.begin_job_run('pgtap_daily');

select lives_ok(
  $$ select public.record_job_step(
       (select id from runs where label = 'open'), 'reminders', 'ok', 1500,
       '{"queued": 3}') $$,
  'record_job_step records a step under an open run');

select ok(
  (select s.job = 'pgtap_daily'
     and s.step = 'reminders'
     and s.status = 'ok'
     and s.run_id = r.id
     and s.finished_at is not null
     and s.finished_at - s.started_at between interval '1.4 seconds' and interval '1.6 seconds'
     and s.detail = '{"queued": 3}'::jsonb
   from public.job_runs s join runs r on r.id = s.run_id
   where r.label = 'open'),
  'the step row carries the run''s job, its id, the status, a start backdated by the duration and the detail');

select ok(
  (select j.finished_at is null and j.step is null and j.run_id is null
   from public.job_runs j join runs r on r.id = j.id where r.label = 'open'),
  'the run''s own row stays open, with no step and no run_id');

select is(
  array[
    pg_temp.attempt($q$ select public.record_job_step(
      (select max(id) + 1000 from public.job_runs), 'drain', 'ok', 1) $q$),
    pg_temp.attempt($q$ select public.record_job_step(null, 'drain', 'ok', 1) $q$),
    pg_temp.attempt($q$ select public.record_job_step(
      (select run_id from public.job_runs where step = 'reminders'
        and job = 'pgtap_daily'), 'drain', 'ok', 1) $q$),
    pg_temp.attempt($q$ select public.record_job_step(
      (select id from runs where label = 'open'), 'Drain', 'ok', 1) $q$),
    pg_temp.attempt($q$ select public.record_job_step(
      (select id from runs where label = 'open'), null, 'ok', 1) $q$),
    pg_temp.attempt($q$ select public.record_job_step(
      (select id from runs where label = 'open'), repeat('a', 41), 'ok', 1) $q$)
  ],
  array[
    'P0001 core.job_run_not_open', 'P0001 core.job_run_not_open',
    'ok',
    'P0001 core.invalid_step', 'P0001 core.invalid_step', 'P0001 core.invalid_step'
  ],
  'a missing run is refused, a bad step name is refused (the open run id is accepted)');

select public.end_job_run((select id from runs where label = 'open'), 'ok');

select isnt(
  public.begin_job_run('pgtap_daily'), null,
  'step rows don''t count as an open run: once the run is closed, a new one begins');

select ok(
  exists (select 1 from public.job_runs where job = 'pgtap_daily' and step = 'reminders'),
  'and the closed run''s step rows remain');

select is(
  pg_temp.attempt($q$ select public.record_job_step(
    (select id from runs where label = 'open'), 'drain', 'ok', 1) $q$),
  'P0001 core.job_run_not_open', 'a finished run takes no more steps');

select is(
  pg_temp.attempt($q$ insert into public.job_runs (job, step, status, finished_at)
    values ('pgtap_daily', 'x', 'ok', now()) $q$),
  '23514 job_runs_run_id_with_step', 'a step without a run_id is refused by the CHECK');

select is(
  pg_temp.attempt($q$ insert into public.job_runs (job, run_id, status, finished_at)
    values ('pgtap_daily', (select id from runs where label = 'open'), 'ok', now()) $q$),
  '23514 job_runs_run_id_with_step', 'a run_id without a step is refused by the CHECK');

-- sweep_shared_sessions. Real sessions (staging) would change the counts,
-- so the table is emptied first, inside this rolled-back transaction.

delete from private.shared_sessions;

insert into private.shared_sessions (session_id, user_id, last_activity_at) values
  ('00000000-0000-4000-a200-000000000001', '00000000-0000-4000-a000-0000000000c4',
   now() - interval '24 hours 1 second'),
  ('00000000-0000-4000-a200-000000000002', '00000000-0000-4000-a000-0000000000c4',
   now() - interval '23 hours');

select is(public.sweep_shared_sessions(), 1,
  'the sweep deletes the one session idle 24 h + 1 s');

select is(
  (select array_agg(session_id::text order by session_id) from private.shared_sessions
   where session_id in ('00000000-0000-4000-a200-000000000001',
                        '00000000-0000-4000-a200-000000000002')),
  array['00000000-0000-4000-a200-000000000002'],
  'and keeps the one idle 23 h');

select is(public.sweep_shared_sessions(), 0, 'a second sweep deletes nothing');

-- run_retention.

delete from public.email_outbox;

insert into public.error_events (occurred_at, code, route) values
  (now() - interval '31 days', 'pgtap_old', 'route old'),
  (now() - interval '29 days', 'pgtap_new', 'route new');

insert into public.email_outbox (
  id, kind, recipient_member_id, template, payload, dedupe_key, priority,
  status, recipient_address, error, created_at, sent_at
)
select ('00000000-0000-4000-a300-00000000000' || n)::uuid,
       'reminder', '00000000-0000-4000-a000-0000000000c4', 'reminder',
       '{"title":"x"}', 'pgtap:ret:' || n, 1, s::public.outbox_status,
       'someone@example.com', 'email.x',
       now() - interval '31 days',
       case when s = 'sent' then now() - interval '31 days' end
from (values (1, 'sent'), (2, 'failed'), (3, 'bounced'), (4, 'canceled'),
             (5, 'dropped'), (6, 'queued'), (7, 'sending')) v (n, s);

insert into public.email_outbox (
  id, kind, recipient_member_id, template, payload, dedupe_key, priority,
  status, recipient_address, created_at
) values (
  '00000000-0000-4000-a300-000000000008', 'reminder',
  '00000000-0000-4000-a000-0000000000c4', 'reminder', '{"title":"x"}',
  'pgtap:ret:8', 1, 'failed', 'recent@example.com', now() - interval '29 days');

select is(
  public.run_retention(),
  '{"error_events_deleted": 1, "outbox_cleared": 5}'::jsonb,
  'retention deletes the old error event and clears the five old final outbox rows');

select is(
  (select count(*)::int from public.error_events where code like 'pgtap_%'),
  1, 'the 29-day-old error event stays');

select is(
  (select count(*)::int from public.email_outbox
   where status in ('sent','failed','bounced','canceled','dropped')
     and created_at < now() - interval '30 days'
     and recipient_address is null and error is null and payload = '{}'),
  5, 'final rows older than 30 days have no address, no error and an empty payload');

select is(
  (select count(*)::int from public.email_outbox
   where status in ('queued', 'sending')
     and recipient_address is not null and error is not null
     and payload = '{"title":"x"}'),
  2, 'queued and sending rows are untouched');

select is(
  (select recipient_address from public.email_outbox
   where id = '00000000-0000-4000-a300-000000000008'),
  'recent@example.com', 'a final row under 30 days old is untouched');

select is(public.run_retention(),
  '{"error_events_deleted": 0, "outbox_cleared": 0}'::jsonb,
  'a second retention run changes nothing');

-- Grants.

select is(
  array[
    has_function_privilege('service_role', 'private.clear_old_email_rows()', 'EXECUTE'),
    has_function_privilege('authenticated', 'private.clear_old_email_rows()', 'EXECUTE'),
    has_function_privilege('anon', 'private.clear_old_email_rows()', 'EXECUTE')
  ],
  array[false, false, false],
  'the email slice''s retention function is granted to nobody');

select is(
  array[
    has_function_privilege('service_role', 'public.record_job_step(bigint, text, public.job_status, integer, jsonb)', 'EXECUTE'),
    has_function_privilege('service_role', 'public.sweep_shared_sessions()', 'EXECUTE'),
    has_function_privilege('service_role', 'public.run_retention()', 'EXECUTE'),
    has_function_privilege('anon', 'public.record_job_step(bigint, text, public.job_status, integer, jsonb)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.sweep_shared_sessions()', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.run_retention()', 'EXECUTE')
  ],
  array[true, true, true, false, false, false],
  'only service_role executes the three commands');

select is(
  array[
    pg_temp.attempt_as('00000000-0000-4000-a000-0000000000c1', $q$ select public.run_retention() $q$),
    pg_temp.attempt_as('00000000-0000-4000-a000-0000000000c2', $q$ select public.run_retention() $q$),
    pg_temp.attempt_as('00000000-0000-4000-a000-0000000000c3', $q$ select public.sweep_shared_sessions() $q$),
    pg_temp.attempt_as('00000000-0000-4000-a000-0000000000c4', $q$ select public.sweep_shared_sessions() $q$),
    pg_temp.attempt_as('00000000-0000-4000-a000-0000000000c5',
      $q$ select public.record_job_step(1, 'drain', 'ok', 1) $q$)
  ],
  array[
    '42501 permission denied for function run_retention',
    '42501 permission denied for function run_retention',
    '42501 permission denied for function sweep_shared_sessions',
    '42501 permission denied for function sweep_shared_sessions',
    '42501 permission denied for function record_job_step'
  ],
  'pending, declined, deactivated, staff and admin callers are denied');

select results_eq(
  $$ select p.proname::text collate "default", p.prosecdef,
            pg_get_userbyid(p.proowner)::text collate "default",
            p.proconfig::text[] collate "default"
     from pg_proc p
     where p.oid in (
       'public.record_job_step(bigint, text, public.job_status, integer, jsonb)'::regprocedure,
       'public.sweep_shared_sessions()'::regprocedure,
       'public.run_retention()'::regprocedure)
     order by p.proname $$,
  $$ values ('record_job_step', true, 'postgres', array['search_path=""']),
            ('run_retention', true, 'postgres', array['search_path=""']),
            ('sweep_shared_sessions', true, 'postgres', array['search_path=""']) $$,
  'the three commands are security definer, owned by postgres, with search_path = ''''');

select ok(
  (select p.prosrc ~* 'for update' from pg_proc p
   where p.oid = 'public.record_job_step(bigint, text, public.job_status, integer, jsonb)'::regprocedure),
  'record_job_step locks the run FOR UPDATE');

select * from finish();
rollback;
