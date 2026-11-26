-- Email outbox (Story 4.1): the table, its RLS, `private.enqueue_email` and
-- the four service_role commands.
--
-- - Reads: the four spine callers read no row; an active admin reads every
--   row. Nobody writes the table directly, and service_role holds nothing on
--   it.
-- - Every row of the story's I/O matrix: enqueue and its dedupe, claim order,
--   the daily and monthly limits, the confirmation cap, a stuck row, prepare
--   and mark, and the advisory lock a claim holds.
-- - Per-kind checks are created here, inside the transaction, so no later
--   story's real check changes what this file proves.
--
-- Fixtures are created here and rolled back; the outbox is emptied (inside
-- the transaction) before each section so a real queued row can't change a
-- result. It runs locally and on staging (`supabase test db --linked`).

begin;

-- See members/members.test.sql: run as `postgres` with `extensions` on the
-- path, whichever role `supabase test db --linked` connected as.
set local role postgres;
set local search_path = "$user", public, extensions;

select plan(47);

-- Shape: the spine's closed enums, and the row's own version.

select enum_has_labels(
  'public', 'email_kind',
  array['reminder', 'decision', 'confirmation', 'status_code', 'report_notice'],
  'email_kind has the spine''s five kinds'
);
select enum_has_labels(
  'public', 'outbox_status',
  array['queued', 'sending', 'sent', 'failed', 'bounced', 'canceled', 'dropped'],
  'outbox_status has the spine''s seven statuses'
);
select col_not_null(
  'public', 'email_outbox', 'updated_at',
  'email_outbox carries updated_at'
);

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

-- Attempts one statement as the current role: `ok` when accepted (then
-- rolled back by the sentinel), `23514 <constraint>` for a CHECK, else
-- `<sqlstate> <message>`.
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

-- The same, as the caller.
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

-- A queued row for the recipient, through the one creator. `p_key` is also
-- how the test finds the row again.
create function pg_temp.enqueue(
  p_kind public.email_kind,
  p_key text,
  p_requires_action boolean default false,
  p_payload jsonb default '{}'
)
returns uuid
language sql as $$
  select private.enqueue_email(
    p_kind, '00000000-0000-4000-a000-0000000000e4', 'pgtap_template',
    p_payload, 'pgtap:' || p_key, '{}', p_requires_action)
$$;

create function pg_temp.row_of(p_key text)
returns public.email_outbox
language sql stable as $$
  select o from public.email_outbox o where o.dedupe_key = 'pgtap:' || p_key
$$;

-- a0..e1 pending, e2 declined, e3 deactivated former Head Layout Artist,
-- e4 active staff (Staff Layout Artist), e5 active admin (Sports Editor).
select pg_temp.new_member('00000000-0000-4000-a000-0000000000e1', 'em-pending@example.com', null);
select pg_temp.new_member('00000000-0000-4000-a000-0000000000e2', 'em-declined@example.com', null);
select pg_temp.new_member('00000000-0000-4000-a000-0000000000e3', 'em-deactivated@example.com', 'head_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-0000000000e4', 'em-staff@example.com', 'staff_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-0000000000e5', 'em-admin@example.com', 'sports_editor');

update public.members set declined_at = now()
where id = '00000000-0000-4000-a000-0000000000e2';
update public.members set deactivated_at = now()
where id = '00000000-0000-4000-a000-0000000000e3';

-- Per-kind checks, created in this transaction only. The reminder's send
-- check drops a row whose payload says so; the report notice's claim check
-- holds a row whose payload says so. `status_code` and `confirmation` have
-- no send check.
create function private.email_send_check_reminder(p_id uuid)
returns text
language sql stable
set search_path = ''
as $$
  select case when o.payload ->> 'drop' = 'yes' then 'task_gone' end
  from public.email_outbox o where o.id = p_id
$$;

create function private.email_claim_check_report_notice(p_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select o.payload ->> 'hold' is distinct from 'yes'
  from public.email_outbox o where o.id = p_id
$$;

-- Grants and pins.

select is(
  array[
    has_table_privilege('authenticated', 'public.email_outbox', 'SELECT'),
    has_table_privilege('authenticated', 'public.email_outbox', 'INSERT'),
    has_table_privilege('authenticated', 'public.email_outbox', 'UPDATE'),
    has_table_privilege('authenticated', 'public.email_outbox', 'DELETE'),
    has_table_privilege('authenticated', 'public.email_outbox', 'TRUNCATE'),
    has_table_privilege('anon', 'public.email_outbox', 'SELECT'),
    has_table_privilege('anon', 'public.email_outbox', 'INSERT')
  ],
  array[true, false, false, false, false, false, false],
  'authenticated may only SELECT the outbox (RLS decides which rows); anon holds nothing');

select is(
  array[
    has_table_privilege('service_role', 'public.email_outbox', 'SELECT'),
    has_table_privilege('service_role', 'public.email_outbox', 'INSERT'),
    has_table_privilege('service_role', 'public.email_outbox', 'UPDATE'),
    has_table_privilege('service_role', 'public.email_outbox', 'DELETE'),
    has_table_privilege('service_role', 'public.email_outbox', 'TRUNCATE')
  ],
  array[false, false, false, false, false],
  'service_role holds no privilege on the outbox: only the commands reach it');

select results_eq(
  $$ select p.proname::text collate "default", p.prosecdef,
            pg_get_userbyid(p.proowner)::text collate "default",
            p.proconfig::text[] collate "default"
     from pg_proc p
     where p.oid in (
       'private.enqueue_email(public.email_kind, uuid, text, jsonb, text, jsonb, boolean)'::regprocedure,
       'public.claim_email_batch(integer, integer, integer, integer)'::regprocedure,
       'public.prepare_email_send(uuid, integer)'::regprocedure,
       'public.mark_email_sent(uuid, integer, text)'::regprocedure,
       'public.mark_email_failed(uuid, integer, text)'::regprocedure
     )
     order by p.proname $$,
  $$ values ('claim_email_batch', true, 'postgres', array['search_path=""']),
            ('enqueue_email', true, 'postgres', array['search_path=""']),
            ('mark_email_failed', true, 'postgres', array['search_path=""']),
            ('mark_email_sent', true, 'postgres', array['search_path=""']),
            ('prepare_email_send', true, 'postgres', array['search_path=""']) $$,
  'the five commands are security definer, owned by postgres, with search_path = ''''');

select is(
  array[
    has_function_privilege('service_role', 'public.claim_email_batch(integer, integer, integer, integer)', 'EXECUTE'),
    has_function_privilege('service_role', 'public.prepare_email_send(uuid, integer)', 'EXECUTE'),
    has_function_privilege('service_role', 'public.mark_email_sent(uuid, integer, text)', 'EXECUTE'),
    has_function_privilege('service_role', 'public.mark_email_failed(uuid, integer, text)', 'EXECUTE'),
    has_function_privilege('service_role', 'private.enqueue_email(public.email_kind, uuid, text, jsonb, text, jsonb, boolean)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.claim_email_batch(integer, integer, integer, integer)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.prepare_email_send(uuid, integer)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.mark_email_sent(uuid, integer, text)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.mark_email_failed(uuid, integer, text)', 'EXECUTE'),
    has_function_privilege('authenticated', 'private.enqueue_email(public.email_kind, uuid, text, jsonb, text, jsonb, boolean)', 'EXECUTE'),
    has_function_privilege('anon', 'public.claim_email_batch(integer, integer, integer, integer)', 'EXECUTE')
  ],
  array[true, true, true, true, false, false, false, false, false, false, false],
  'service_role executes the four commands and not enqueue_email; authenticated and anon execute none');

select ok(
  (select bool_and(p.prosrc ~* 'for update')
   from pg_proc p
   where p.oid in (
     'public.prepare_email_send(uuid, integer)'::regprocedure,
     'public.mark_email_sent(uuid, integer, text)'::regprocedure,
     'public.mark_email_failed(uuid, integer, text)'::regprocedure))
  and (select p.prosrc ~* 'pg_advisory_xact_lock' and p.prosrc ~* 'skip locked'
       from pg_proc p
       where p.oid = 'public.claim_email_batch(integer, integer, integer, integer)'::regprocedure),
  'prepare and the marks lock their row FOR UPDATE; claim takes the advisory lock and SKIP LOCKED');

-- Enqueue.

delete from public.email_outbox;

create temp table priorities (label text, kind public.email_kind, requires_action boolean, expected smallint);
insert into priorities values
  ('reminder', 'reminder', false, 1),
  ('reminder, action', 'reminder', true, 1),
  ('decision, action', 'decision', true, 2),
  ('confirmation', 'confirmation', false, 3),
  ('confirmation, action', 'confirmation', true, 3),
  ('status_code', 'status_code', false, 3),
  ('report_notice', 'report_notice', false, 4),
  ('report_notice, action', 'report_notice', true, 4),
  ('decision', 'decision', false, 5);

create temp table enqueued as
select p.label, pg_temp.enqueue(p.kind, p.label, p.requires_action) as id
from priorities p;

select set_eq(
  $$ select e.label, o.status::text collate "default", o.priority
     from enqueued e join public.email_outbox o on o.id = e.id $$,
  $$ select label, 'queued', expected from priorities $$,
  'every kind, with and without requires_action, is queued with its derived priority');

select is(
  (select count(*) from public.email_outbox)::int, 9,
  'the nine enqueues made nine rows');

select ok(
  pg_temp.enqueue('reminder', 'reminder') is null
  and (select count(*) from public.email_outbox)::int = 9
  and (pg_temp.row_of('reminder')).attempt_count = 0,
  'a dedupe conflict returns null and changes nothing');

select is(
  pg_temp.attempt($$ select private.enqueue_email('reminder', '00000000-0000-4000-a000-0000000000e4',
    't', '{}', 'pgtap:bad-ref', '{"member_id":"x"}', false) $$),
  'P0001 email.unknown_ref',
  'a ref other than task_id raises email.unknown_ref');

select is(
  pg_temp.attempt($$ select private.enqueue_email('reminder', '00000000-0000-4000-a000-0000000000e4',
    't', '{}', 'pgtap:bad-task', '{"task_id":"00000000-0000-4000-a100-00000000dead"}', false) $$),
  '23503 insert or update on table "email_outbox" violates foreign key constraint "email_outbox_task_id_fkey"',
  'task_id is the one ref taken, and it must name a task');

select is(
  array[
    pg_temp.attempt($$ insert into public.email_outbox (kind, recipient_member_id, template, dedupe_key, priority)
      values ('reminder', '00000000-0000-4000-a000-0000000000e4', 't', repeat('x', 201), 1) $$),
    pg_temp.attempt($$ insert into public.email_outbox (kind, recipient_member_id, template, dedupe_key, priority, payload)
      values ('reminder', '00000000-0000-4000-a000-0000000000e4', 't', 'pgtap:big', 1,
              jsonb_build_object('x', repeat('x', 5000))) $$),
    pg_temp.attempt($$ insert into public.email_outbox (kind, recipient_member_id, template, dedupe_key, priority, error)
      values ('reminder', '00000000-0000-4000-a000-0000000000e4', 't', 'pgtap:err', 1, 'a@b.com wrote: hi') $$),
    pg_temp.attempt($$ insert into public.email_outbox (kind, recipient_member_id, template, dedupe_key, priority)
      values ('reminder', null, 't', 'pgtap:nobody', 1) $$)
  ],
  array[
    '23514 email_outbox_dedupe_key_length',
    '23514 email_outbox_payload_size',
    '23514 email_outbox_error_format',
    '23502 null value in column "recipient_member_id" of relation "email_outbox" violates not-null constraint'
  ],
  'the CHECKs cap the dedupe key and the payload, keep error to a code, and a recipient is required');

-- The read matrix.

create temp table callers (label text primary key, member_id uuid not null);
insert into callers values
  ('pending', '00000000-0000-4000-a000-0000000000e1'),
  ('declined', '00000000-0000-4000-a000-0000000000e2'),
  ('deactivated former Head Layout Artist', '00000000-0000-4000-a000-0000000000e3'),
  ('active staff', '00000000-0000-4000-a000-0000000000e4'),
  ('active admin (Sports Editor)', '00000000-0000-4000-a000-0000000000e5');

create temp table expected as
select e.*
from (select (select count(*) from public.email_outbox)::int as n) t
cross join lateral (values
  ('pending', 0),
  ('declined', 0),
  ('deactivated former Head Layout Artist', 0),
  ('active staff', 0),
  ('active admin (Sports Editor)', t.n)
) as e (label, rows_read);

create temp table observed (like expected);

do $$
declare
  v_callers callers[];
  c callers;
  o observed;
begin
  select array_agg(x) into v_callers from callers x;

  foreach c in array v_callers loop
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', c.member_id, 'role', 'authenticated')::text,
      true
    );
    set local role authenticated;

    o.label := c.label;
    o.rows_read := (select count(*) from public.email_outbox);

    set local role postgres;
    insert into observed values (o.*);
  end loop;
  perform set_config('request.jwt.claims', '', true);
end
$$;

select set_eq(
  $$ select * from observed $$,
  $$ select * from expected $$,
  'only an active admin reads the outbox; the four spine callers read no row');

select is(
  (select rows_read from expected where label = 'active admin (Sports Editor)'), 9,
  'the admin row of the matrix counts real rows');

select is(
  array[
    pg_temp.attempt_as('00000000-0000-4000-a000-0000000000e5',
      $q$ insert into public.email_outbox (kind, recipient_member_id, template, dedupe_key, priority)
          values ('reminder', '00000000-0000-4000-a000-0000000000e5', 't', 'pgtap:direct', 1) $q$),
    pg_temp.attempt_as('00000000-0000-4000-a000-0000000000e5',
      $q$ update public.email_outbox set status = 'sent' $q$),
    pg_temp.attempt_as('00000000-0000-4000-a000-0000000000e5',
      $q$ delete from public.email_outbox $q$),
    pg_temp.attempt_as('00000000-0000-4000-a000-0000000000e5',
      $q$ select public.claim_email_batch(1, 1, 1, 1) $q$),
    pg_temp.attempt_as('00000000-0000-4000-a000-0000000000e5',
      $q$ select private.enqueue_email('reminder', '00000000-0000-4000-a000-0000000000e5', 't', '{}', 'pgtap:as-admin') $q$)
  ],
  array[
    '42501 permission denied for table email_outbox',
    '42501 permission denied for table email_outbox',
    '42501 permission denied for table email_outbox',
    '42501 permission denied for function claim_email_batch',
    '42501 permission denied for function enqueue_email'
  ],
  'even an admin writes the table, claims or enqueues through no direct path');

-- Claim order.

delete from public.email_outbox;

select pg_temp.enqueue('report_notice', 'e-report');
select pg_temp.enqueue('decision', 'f-decision');
select pg_temp.enqueue('confirmation', 'd-confirmation');
select pg_temp.enqueue('decision', 'c-decision-action', true);
select pg_temp.enqueue('reminder', 'b-reminder-new');
select pg_temp.enqueue('reminder', 'a-reminder-old');
update public.email_outbox set created_at = now() - interval '3 hours'
where dedupe_key = 'pgtap:a-reminder-old';
update public.email_outbox set created_at = now() - interval '1 hour'
where dedupe_key = 'pgtap:b-reminder-new';

select is(
  (select array_agg(c.dedupe_key)
   from public.claim_email_batch(10, 100, 3000, 30) c),
  array['pgtap:a-reminder-old', 'pgtap:b-reminder-new', 'pgtap:c-decision-action',
        'pgtap:d-confirmation', 'pgtap:e-report', 'pgtap:f-decision'],
  'a claim returns rows by priority, then oldest first');

select is(
  (select array[count(*) filter (where status = 'sending'),
                count(*) filter (where provider_attempted_at is not null),
                count(*) filter (where attempt_count = 1)]
   from public.email_outbox),
  array[6::bigint, 6, 6],
  'claimed rows are sending, stamped with provider_attempted_at, at attempt 1');

select ok(
  (select count(*) = 1 from pg_locks
   where locktype = 'advisory' and pid = pg_backend_pid() and granted),
  'the claim still holds its advisory lock until the transaction ends');

-- Two claims in sequence share no row.

delete from public.email_outbox;
select pg_temp.enqueue('reminder', 'seq-' || n) from generate_series(1, 5) n;

create temp table first_claim as
select c.id from public.claim_email_batch(3, 100, 3000, 30) c;
create temp table second_claim as
select c.id from public.claim_email_batch(3, 100, 3000, 30) c;

select ok(
  (select count(*) from first_claim) = 3
  and (select count(*) from second_claim) = 2
  and not exists (select 1 from first_claim join second_claim using (id)),
  'a second claim in sequence shares no row with the first and takes only what is left');

-- Limits.

delete from public.email_outbox;
select pg_temp.enqueue('reminder', 'daily-' || n) from generate_series(1, 4) n;

-- Two attempts earlier today; the limit is 2.
insert into public.email_outbox (kind, recipient_member_id, template, dedupe_key, priority,
  status, attempt_count, provider_attempted_at, sent_at)
select 'reminder', '00000000-0000-4000-a000-0000000000e4', 't', 'pgtap:today-' || n, 1,
  'sent', 1, now(), now()
from generate_series(1, 2) n;

select is(
  (select count(*) from public.claim_email_batch(10, 2, 3000, 30))::int, 0,
  'with the daily limit used up, a claim takes nothing');

-- An attempt from before UTC midnight doesn't count toward the day.
update public.email_outbox
set provider_attempted_at = date_trunc('day', now() at time zone 'utc') at time zone 'utc' - interval '1 second'
where dedupe_key = 'pgtap:today-1';

select is(
  (select count(*) from public.claim_email_batch(10, 2, 3000, 30))::int, 1,
  'an attempt from before UTC midnight does not count: one of the two is free');

delete from public.email_outbox;
select pg_temp.enqueue('reminder', 'month-' || n) from generate_series(1, 5) n;
insert into public.email_outbox (kind, recipient_member_id, template, dedupe_key, priority,
  status, attempt_count, provider_attempted_at, sent_at)
select 'reminder', '00000000-0000-4000-a000-0000000000e4', 't', 'pgtap:earlier-' || n, 1,
  'sent', 1, date_trunc('month', now() at time zone 'utc') at time zone 'utc', now()
from generate_series(1, 2) n;

select is(
  (select count(*) from public.claim_email_batch(10, 100, 3, 30))::int, 1,
  'when the monthly remainder is below the daily room, a claim takes only the remainder');

-- Confirmation cap.

delete from public.email_outbox;
select pg_temp.enqueue('confirmation', 'cap-confirmation');
select pg_temp.enqueue('status_code', 'cap-status');
select pg_temp.enqueue('reminder', 'cap-reminder');
select pg_temp.enqueue('decision', 'cap-decision');
insert into public.email_outbox (kind, recipient_member_id, template, dedupe_key, priority,
  status, attempt_count, provider_attempted_at, sent_at)
values ('confirmation', '00000000-0000-4000-a000-0000000000e4', 't', 'pgtap:cap-sent', 3,
  'sent', 1, now(), now());

select is(
  (select array_agg(c.dedupe_key order by c.dedupe_key)
   from public.claim_email_batch(10, 100, 3000, 1) c),
  array['pgtap:cap-decision', 'pgtap:cap-reminder'],
  'with the confirmation cap reached, other kinds are still claimed');

select is(
  array[(pg_temp.row_of('cap-confirmation')).status::text,
        (pg_temp.row_of('cap-status')).status::text],
  array['queued', 'queued'],
  'confirmation-class rows stay queued past the cap');

-- Claim check, and invalid limits.

delete from public.email_outbox;
select pg_temp.enqueue('report_notice', 'held', false, '{"hold":"yes"}');
select pg_temp.enqueue('report_notice', 'free');

select is(
  (select array_agg(c.dedupe_key) from public.claim_email_batch(10, 100, 3000, 30) c),
  array['pgtap:free'],
  'a claim check that returns false leaves its row queued');

select is(
  array[
    pg_temp.attempt('select public.claim_email_batch(-1, 1, 1, 1)'),
    pg_temp.attempt('select public.claim_email_batch(1, -1, 1, 1)'),
    pg_temp.attempt('select public.claim_email_batch(1, 1, -1, 1)'),
    pg_temp.attempt('select public.claim_email_batch(1, 1, 1, -1)'),
    pg_temp.attempt('select public.claim_email_batch(0, 0, 0, 0)')
  ],
  array['P0001 email.invalid_limits', 'P0001 email.invalid_limits',
        'P0001 email.invalid_limits', 'P0001 email.invalid_limits', 'ok'],
  'a negative limit raises email.invalid_limits; zero is a valid limit');

-- Stuck rows.

delete from public.email_outbox;
select pg_temp.enqueue('reminder', 'stuck-16');
select pg_temp.enqueue('reminder', 'stuck-14');
update public.email_outbox
set status = 'sending', attempt_count = 1, provider_attempted_at = now() - interval '16 minutes'
where dedupe_key = 'pgtap:stuck-16';
update public.email_outbox
set status = 'sending', attempt_count = 1, provider_attempted_at = now() - interval '14 minutes'
where dedupe_key = 'pgtap:stuck-14';

select is(
  (select array[c.dedupe_key, c.attempt::text]
   from public.claim_email_batch(10, 100, 3000, 30) c),
  array['pgtap:stuck-16', '1'],
  'a row sending for 16 minutes is reclaimed and keeps its attempt number');

select is(
  (pg_temp.row_of('stuck-14')).status::text || ' ' || (pg_temp.row_of('stuck-14')).attempt_count,
  'sending 1',
  'a row sending for 14 minutes is untouched');

-- Prepare.

delete from public.email_outbox;
select pg_temp.enqueue('reminder', 'prep-ready');
select pg_temp.enqueue('reminder', 'prep-drop', false, '{"drop":"yes"}');
select pg_temp.enqueue('status_code', 'prep-nocheck');
select pg_temp.enqueue('report_notice', 'prep-queued');
create temp table prep_claim as
select c.id, c.dedupe_key, c.attempt
from public.claim_email_batch(3, 100, 3000, 30) c;

select is(
  (select array[p.outcome, p.address]
   from prep_claim c, public.prepare_email_send(c.id, c.attempt) p
   where c.dedupe_key = 'pgtap:prep-ready'),
  array['ready', 'em-staff@example.com'],
  'prepare reads the address from members.email and returns ready');

select is(
  (pg_temp.row_of('prep-ready')).recipient_address || ' ' || (pg_temp.row_of('prep-ready')).status,
  'em-staff@example.com sending',
  'prepare records the address on the row and leaves it sending');

create temp table out_prep_drop as
select p.outcome from prep_claim c, public.prepare_email_send(c.id, c.attempt) p
where c.dedupe_key = 'pgtap:prep-drop';

select is(
  (select outcome from out_prep_drop)
  || ' ' || (pg_temp.row_of('prep-drop')).status || ' ' || (pg_temp.row_of('prep-drop')).error,
  'dropped dropped task_gone',
  'a send check that returns a reason drops the row with that reason');

create temp table out_prep_nocheck as
select p.outcome from prep_claim c, public.prepare_email_send(c.id, c.attempt) p
where c.dedupe_key = 'pgtap:prep-nocheck';

select is(
  (select outcome from out_prep_nocheck)
  || ' ' || (pg_temp.row_of('prep-nocheck')).status || ' ' || (pg_temp.row_of('prep-nocheck')).error,
  'failed failed email.no_send_check',
  'a kind with no send check fails closed');

select is(
  array[
    (select p.outcome from public.prepare_email_send((pg_temp.row_of('prep-ready')).id, 99) p),
    (select p.outcome from public.prepare_email_send((pg_temp.row_of('prep-queued')).id, 1) p),
    (select p.outcome from public.prepare_email_send((pg_temp.row_of('prep-drop')).id, 1) p),
    (select p.outcome from public.prepare_email_send('00000000-0000-4000-a000-00000000dead', 1) p)
  ],
  array['gone', 'gone', 'gone', 'gone'],
  'a wrong attempt, a queued row, a final row or an unknown id is gone');

select is(
  (pg_temp.row_of('prep-ready')).status::text || ' ' || (pg_temp.row_of('prep-queued')).status,
  'sending queued',
  'a prepare that is gone changes nothing');

-- Mark.

select is(
  public.mark_email_sent((pg_temp.row_of('prep-ready')).id, 99, 'sink:x'), false,
  'a mark at a stale attempt returns false');

select is(
  public.mark_email_sent((pg_temp.row_of('prep-ready')).id, 1, 'sink:3f2b8c1e-0000-4000-8000-000000000001'),
  true,
  'mark_email_sent returns true for the sending row at its attempt');

select is(
  (pg_temp.row_of('prep-ready')).status::text || ' ' || (pg_temp.row_of('prep-ready')).provider_message_id
  || ' ' || ((pg_temp.row_of('prep-ready')).sent_at is not null),
  'sent sink:3f2b8c1e-0000-4000-8000-000000000001 true',
  'a sent row holds its provider message id and sent_at');

select is(
  array[
    public.mark_email_sent((pg_temp.row_of('prep-ready')).id, 1, 'sink:again'),
    public.mark_email_failed((pg_temp.row_of('prep-ready')).id, 1, 'email.send_failed'),
    public.mark_email_failed((pg_temp.row_of('prep-drop')).id, 1, 'email.send_failed')
  ],
  array[false, false, false],
  'a row that is already final is not marked again');

select is(
  (pg_temp.row_of('prep-ready')).status::text, 'sent',
  'a refused mark leaves a sent row sent');

create temp table fail_claim as
select c.id, c.attempt from public.claim_email_batch(5, 100, 3000, 30) c
where c.dedupe_key = 'pgtap:prep-queued';

select is(
  public.mark_email_failed((select id from fail_claim), (select attempt from fail_claim), 'rate_limit_exceeded'),
  true,
  'mark_email_failed returns true for the sending row at its attempt');

select is(
  (pg_temp.row_of('prep-queued')).status::text || ' ' || (pg_temp.row_of('prep-queued')).error
  || ' ' || ((pg_temp.row_of('prep-queued')).sent_at is null),
  'failed rate_limit_exceeded true',
  'a failed row holds its error code and no sent_at');

select pg_temp.enqueue('reminder', 'free-text');
update public.email_outbox set status = 'sending', attempt_count = 1
where dedupe_key = 'pgtap:free-text';
select public.mark_email_failed((pg_temp.row_of('free-text')).id, 1, 'Resend said: bad address a@b.com');

select is(
  (pg_temp.row_of('free-text')).error, 'email.unknown_error',
  'anything that is not a code is stored as email.unknown_error, never as text');

select is(
  array[
    pg_temp.attempt($$ update public.email_outbox set status = 'sent' where dedupe_key = 'pgtap:free-text' $$),
    pg_temp.attempt($$ update public.email_outbox set provider_message_id = 'a b@c' where dedupe_key = 'pgtap:free-text' $$)
  ],
  array['23514 email_outbox_sent_at_when_sent', '23514 email_outbox_provider_message_id_format'],
  'a sent row needs sent_at, and a provider message id is a code too');

-- The recorded address never reaches a non-admin.

select is(
  pg_temp.attempt_as('00000000-0000-4000-a000-0000000000e4',
    $q$ select recipient_address from public.email_outbox $q$),
  'ok',
  'active staff may query the table (RLS returns no row)');

select is(
  (select count(*) from public.email_outbox where kind = 'reminder' and priority <> 1)::int, 0,
  'every reminder row carries priority 1');

select * from finish();

rollback;
