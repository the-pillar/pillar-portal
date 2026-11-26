-- Quota status and bounce tracking (Story 4.2): `email_quota_status`,
-- `record_email_event`, `email_webhook_events`, and the replaced sent_at
-- CHECK.
--
-- - The status agrees with `claim_email_batch` on the same limits, and
--   finishes_on follows the day-by-day simulation (spill, month remainder,
--   confirmation cap).
-- - An active admin reads the real counts; the four spine callers read none.
-- - Every event outcome: recorded, duplicate, unmatched, ignored, and the
--   code each of the four bounce-class types stores.
--
-- Fixtures are created here and rolled back; the outbox is emptied (inside
-- the transaction) before each section. It runs locally and on staging
-- (`supabase test db --linked`).

begin;

-- See members/members.test.sql: run as `postgres` with `extensions` on the
-- path, whichever role `supabase test db --linked` connected as.
set local role postgres;
set local search_path = "$user", public, extensions;

select plan(35);

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
begin
  execute p_call;
  raise exception using errcode = 'P0001', message = 'probe.accepted';
exception when others then
  return case
    when sqlerrm = 'probe.accepted' then 'ok'
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

-- The status as the caller reads it, as `sent|limit|queued|finishes`.
create function pg_temp.status_as(
  p_caller uuid, p_daily integer, p_monthly integer, p_cap integer)
returns text
language plpgsql as $$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_caller, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select format('%s|%s|%s|%s', s.sent_today, s.limit_today, s.queued,
                coalesce(s.finishes_on::text, 'none'))
  into v_out
  from public.email_quota_status(p_daily, p_monthly, p_cap) s;
  set local role postgres;
  return v_out;
end;
$$;

-- Empties the outbox, then adds `p_attempted` rows attempted today (`sent`),
-- `p_conf` queued confirmations and `p_other` queued reminders.
create function pg_temp.seed(p_attempted integer, p_conf integer, p_other integer)
returns void
language plpgsql as $$
begin
  delete from public.email_outbox;
  perform private.enqueue_email('reminder',
    '00000000-0000-4000-a000-0000000000f4', 'pgtap_template', '{}',
    'pgtap:a:' || n, '{}', false)
  from generate_series(1, p_attempted) n;
  update public.email_outbox
  set status = 'sent', provider_attempted_at = now(), sent_at = now(),
      attempt_count = 1;
  perform private.enqueue_email('confirmation',
    '00000000-0000-4000-a000-0000000000f4', 'pgtap_template', '{}',
    'pgtap:c:' || n, '{}', false)
  from generate_series(1, p_conf) n;
  perform private.enqueue_email('reminder',
    '00000000-0000-4000-a000-0000000000f4', 'pgtap_template', '{}',
    'pgtap:o:' || n, '{}', false)
  from generate_series(1, p_other) n;
end;
$$;

-- f1 pending, f2 declined, f3 deactivated, f4 active staff, f5 admin.
select pg_temp.new_member('00000000-0000-4000-a000-0000000000f1', 'qb-pending@example.com', null);
select pg_temp.new_member('00000000-0000-4000-a000-0000000000f2', 'qb-declined@example.com', null);
select pg_temp.new_member('00000000-0000-4000-a000-0000000000f3', 'qb-deactivated@example.com', 'head_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-0000000000f4', 'qb-staff@example.com', 'staff_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-0000000000f5', 'qb-admin@example.com', 'sports_editor');

update public.members set declined_at = now()
where id = '00000000-0000-4000-a000-0000000000f2';
update public.members set deactivated_at = now()
where id = '00000000-0000-4000-a000-0000000000f3';

-- Grants and shape.

select is(
  array[
    has_function_privilege('authenticated', 'public.email_quota_status(integer, integer, integer)', 'EXECUTE'),
    has_function_privilege('anon', 'public.email_quota_status(integer, integer, integer)', 'EXECUTE'),
    has_function_privilege('service_role', 'public.email_quota_status(integer, integer, integer)', 'EXECUTE'),
    has_function_privilege('service_role', 'public.record_email_event(text, text, text, text, text)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.record_email_event(text, text, text, text, text)', 'EXECUTE'),
    has_function_privilege('anon', 'public.record_email_event(text, text, text, text, text)', 'EXECUTE')
  ],
  array[true, false, false, true, false, false],
  'the quota status is authenticated only; the event recorder is service_role only');

select is(
  pg_temp.attempt_as('00000000-0000-4000-a000-0000000000f5',
    $q$ select public.record_email_event('msg_x', 'email.bounced', 'x', null, null) $q$),
  '42501 permission denied for function record_email_event',
  'an admin session may not record an event');

select is(
  (select array_agg(r order by r) from (
    select format('%s %s %s %s', p.privilege_type, g.grantee, 'table', c.relname) r
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated'), ('service_role')) g(grantee)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(privilege_type)
    where n.nspname = 'public' and c.relname = 'email_webhook_events'
      and has_table_privilege(g.grantee, c.oid, p.privilege_type)
  ) t),
  null::text[],
  'no API role holds a privilege on email_webhook_events');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.email_webhook_events'::regclass),
  'email_webhook_events has RLS on');

select is(
  (select count(*) from pg_policies where tablename = 'email_webhook_events')::int, 0,
  'email_webhook_events has no policy');

select is(
  (select prosecdef from pg_proc where oid = 'public.email_quota_status(integer, integer, integer)'::regprocedure),
  false,
  'email_quota_status runs with the caller''s rights');

-- The quota status.

select pg_temp.seed(0, 0, 150);
select is(
  pg_temp.status_as('00000000-0000-4000-a000-0000000000f5', 100, 3000, 30),
  '0|100|150|' || ((now() at time zone 'utc')::date + 1)::text,
  'spill: 0 attempted, 150 queued, 100/3000 finishes tomorrow');

select pg_temp.seed(0, 0, 50);
select is(
  pg_temp.status_as('00000000-0000-4000-a000-0000000000f5', 100, 3000, 30),
  '0|100|50|' || (now() at time zone 'utc')::date::text,
  'a queue that fits today finishes today');

select pg_temp.seed(0, 0, 50);
select is(
  pg_temp.status_as('00000000-0000-4000-a000-0000000000f5', 100, 40, 30),
  '0|40|50|' ||
    (date_trunc('month', now() at time zone 'utc') + interval '1 month')::date::text,
  'month remainder: a limit of 40 with 50 queued finishes on the 1st of next month');

select pg_temp.seed(0, 45, 0);
select is(
  pg_temp.status_as('00000000-0000-4000-a000-0000000000f5', 100, 3000, 30),
  '0|100|45|' || ((now() at time zone 'utc')::date + 1)::text,
  'confirmation cap: 45 confirmations at cap 30 finish tomorrow');

select pg_temp.seed(0, 45, 0);
select is(
  pg_temp.status_as('00000000-0000-4000-a000-0000000000f5', 100, 3000, 0),
  '0|100|45|none',
  'a confirmation cap of 0 never empties the queue: finishes_on is null');

select pg_temp.seed(100, 0, 81);
select is(
  pg_temp.status_as('00000000-0000-4000-a000-0000000000f5', 100, 3000, 30),
  '100|100|81|' || ((now() at time zone 'utc')::date + 1)::text,
  'at the limit: 100 sent, 81 queued, finishes tomorrow');

select pg_temp.seed(10, 0, 0);
select is(
  pg_temp.status_as('00000000-0000-4000-a000-0000000000f5', 100, 3000, 30),
  '10|100|0|none',
  'nothing queued: finishes_on is null');

select pg_temp.seed(0, 0, 3);
select is(
  pg_temp.status_as('00000000-0000-4000-a000-0000000000f5', 0, 3000, 30),
  '0|0|3|none',
  'a daily limit of 0 never empties the queue');

-- The status agrees with a claim run on the same limits.

select pg_temp.seed(0, 0, 150);
select count(*) from public.claim_email_batch(1000, 100, 3000, 30);
select is(
  pg_temp.status_as('00000000-0000-4000-a000-0000000000f5', 100, 3000, 30),
  '100|100|50|' || ((now() at time zone 'utc')::date + 1)::text,
  'after a claim of the whole day, the status shows 100 sent and 50 queued');

select is(
  (select count(*) from public.claim_email_batch(1000, 100, 3000, 30))::int, 0,
  'and the same claim finds no room left');

select pg_temp.seed(0, 40, 80);
select is(
  (select count(*) from public.claim_email_batch(1000, 100, 3000, 30))::int,
  (select least(s.queued, s.limit_today - s.sent_today)
   from public.email_quota_status(100, 3000, 30) s),
  'a claim takes exactly the room the status reports');

select pg_temp.seed(0, 30, 0);
select private.enqueue_email('report_notice',
  '00000000-0000-4000-a000-0000000000f4', 'pgtap_template', '{}',
  'pgtap:r:' || n, '{}', false)
from generate_series(1, 100) n;
select is(
  pg_temp.status_as('00000000-0000-4000-a000-0000000000f5', 100, 3000, 10),
  '0|100|130|' || ((now() at time zone 'utc')::date + 2)::text,
  'confirmations go ahead of priority 4-5 rows: 100 report notices and 30 confirmations at cap 10 finish on the third day');

select pg_temp.seed(0, 0, 0);
select is(
  array[
    pg_temp.attempt('select * from public.email_quota_status(-1, 1, 1)'),
    pg_temp.attempt('select * from public.email_quota_status(1, -1, 1)'),
    pg_temp.attempt('select * from public.email_quota_status(1, 1, -1)')
  ],
  array['P0001 email.invalid_limits', 'P0001 email.invalid_limits', 'P0001 email.invalid_limits'],
  'a negative limit raises email.invalid_limits');

-- Who reads what.

select pg_temp.seed(5, 2, 3);
select is(
  array[
    pg_temp.status_as('00000000-0000-4000-a000-0000000000f1', 100, 3000, 30),
    pg_temp.status_as('00000000-0000-4000-a000-0000000000f2', 100, 3000, 30),
    pg_temp.status_as('00000000-0000-4000-a000-0000000000f3', 100, 3000, 30),
    pg_temp.status_as('00000000-0000-4000-a000-0000000000f4', 100, 3000, 30)
  ],
  array['0|100|0|none', '0|100|0|none', '0|100|0|none', '0|100|0|none'],
  'pending, declined, deactivated and active staff read zeros');

select is(
  pg_temp.status_as('00000000-0000-4000-a000-0000000000f5', 100, 3000, 30),
  '5|100|5|' || (now() at time zone 'utc')::date::text,
  'an active admin reads the real counts');

-- record_email_event.

select pg_temp.seed(0, 0, 0);
select private.enqueue_email('reminder',
  '00000000-0000-4000-a000-0000000000f4', 'pgtap_template', '{}',
  'pgtap:ev:' || n, '{}', false)
from generate_series(1, 7) n;
update public.email_outbox
set status = 'sent', sent_at = '2026-11-20 01:00+00', provider_attempted_at = now(),
    attempt_count = 1,
    provider_message_id = 'msg_' || substr(dedupe_key, 10);

select is(
  public.record_email_event('svix_1', 'email.bounced', 'msg_1', 'Permanent', 'General'),
  'recorded',
  'a bounce for a sent row is recorded');

select is(
  (select format('%s|%s|%s', status, error, sent_at)
   from public.email_outbox where dedupe_key = 'pgtap:ev:1'),
  'bounced|email.bounced.permanent.general|2026-11-20 01:00:00+00',
  'the row is bounced, carries its code and keeps sent_at');

select is(
  public.record_email_event('svix_1', 'email.bounced', 'msg_1', 'Permanent', 'General'),
  'duplicate',
  'the same Svix id again is a duplicate');

update public.email_outbox set status = 'sent'
where dedupe_key = 'pgtap:ev:1';
select is(
  public.record_email_event('svix_1', 'email.bounced', 'msg_1', 'Transient', 'Other'),
  'duplicate',
  'a replay after the row was sent again changes nothing');
select is(
  (select status::text from public.email_outbox where dedupe_key = 'pgtap:ev:1'),
  'sent',
  'and the row stays as it was');

select is(
  public.record_email_event('svix_2', 'email.bounced', 'msg_unknown', 'Permanent', 'General'),
  'unmatched',
  'an unknown message id is unmatched');
select is(
  (select count(*) from public.email_webhook_events where svix_id = 'svix_2')::int, 1,
  'and its Svix id is stored');

select is(
  public.record_email_event('svix_3', 'email.delivered', 'msg_2', null, null),
  'ignored',
  'another event type is ignored');
select is(
  array[
    (select count(*) from public.email_webhook_events where svix_id = 'svix_3')::int,
    (select count(*) from public.email_outbox where status = 'bounced')::int
  ],
  array[0, 0],
  'and stores nothing, and bounces nothing');

select public.record_email_event('svix_4', 'email.complained', 'msg_3', null, null);
select public.record_email_event('svix_5', 'email.suppressed', 'msg_4', 'OnAccountSuppressionList', null);
select public.record_email_event('svix_6', 'email.failed', 'msg_5', 'Ignored', 'x');
select public.record_email_event('svix_7', 'email.bounced', 'msg_6', 'Per man/ent', repeat('Z', 80));
select is(
  (select array_agg(error order by dedupe_key) from public.email_outbox
   where dedupe_key in ('pgtap:ev:3', 'pgtap:ev:4', 'pgtap:ev:5', 'pgtap:ev:6')),
  array[
    'email.complained',
    'email.suppressed.onaccountsuppressionlist',
    'email.failed',
    left('email.bounced.per_man_ent.' || repeat('z', 80), 64)
  ],
  'complained, suppressed and failed store their codes; free text is sanitized and capped at 64');

select is(
  public.record_email_event('svix_8', 'email.bounced', 'msg_3', 'Permanent', 'General'),
  'recorded',
  'a new id for an already bounced row is recorded');
select is(
  (select error from public.email_outbox where dedupe_key = 'pgtap:ev:3'),
  'email.complained',
  'and its first code stays');

select is(
  pg_temp.attempt($$ select public.record_email_event('bad id!', 'email.bounced', 'msg_7', null, null) $$),
  '23514 new row for relation "email_webhook_events" violates check constraint "email_webhook_events_svix_id_format"',
  'a malformed Svix id is refused');

select is(
  pg_temp.attempt($$ update public.email_outbox set status = 'failed' where dedupe_key = 'pgtap:ev:7' $$),
  '23514 new row for relation "email_outbox" violates check constraint "email_outbox_sent_at_when_sent"',
  'only a sent or bounced row may hold sent_at');

select * from finish();

rollback;
