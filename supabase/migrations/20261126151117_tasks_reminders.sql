-- tasks_reminders: the deadline reminder (Story 4.3, PRD 4.5, AD-1, AD-12,
-- AD-13).
--
-- - `private.tasks_due_for_reminder` decides who gets one: an active member
--   with an open slot (`awaiting_response` or `on_it`) on a task that isn't
--   done or deleted and is due after `p_now` and before 09:00 Manila
--   tomorrow. One row per task and member, with the roles they hold. The
--   open-slot predicate is restated, not called: `private.open_slots` is
--   `security invoker`.
-- - `public.enqueue_due_reminders` queues them through
--   `private.enqueue_email`. The dedupe key carries the due time, so a rerun
--   queues nothing and a moved task's new time gets its own reminder.
-- - `private.email_send_check_reminder` is the send-time check the outbox
--   looks up by name. It drops a stale reminder (`reminder.*` codes).

create function private.tasks_due_for_reminder(
  p_now timestamptz default now()
)
returns table (
  task_id uuid,
  member_id uuid,
  due_at timestamptz,
  title text,
  roles text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, a.member_id, t.due_at, t.title,
         array_agg(a.role::text order by a.role::text)
  from public.tasks t
  join public.task_assignments a on a.task_id = t.id
  where t.deleted_at is null
    and t."column" <> 'done'
    and a.state in ('awaiting_response', 'on_it')
    and t.due_at > p_now
    and t.due_at < (
      (date_trunc('day', p_now at time zone 'Asia/Manila') + interval '1 day'
        + interval '9 hours') at time zone 'Asia/Manila'
    )
    and private.is_member_active(a.member_id)
  group by t.id, a.member_id, t.due_at, t.title
$$;

-- Queues the reminders due now and returns how many were new.
create function public.enqueue_due_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_due text;
  v_count integer := 0;
begin
  for v_row in
    select * from private.tasks_due_for_reminder(now())
  loop
    v_due := to_char(
      v_row.due_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );
    if private.enqueue_email(
      'reminder',
      v_row.member_id,
      'reminder',
      jsonb_build_object(
        'task_id', v_row.task_id,
        'title', v_row.title,
        'due_at', v_due,
        'roles', to_jsonb(v_row.roles)
      ),
      'reminder:' || v_row.task_id || ':' || v_row.member_id || ':' || v_due,
      jsonb_build_object('task_id', v_row.task_id)
    ) is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

-- The send-time check: null to send, or the reason to drop the row.
create function private.email_send_check_reminder(p_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.email_outbox%rowtype;
  v_task public.tasks%rowtype;
  v_due timestamptz;
begin
  select o.* into v_row from public.email_outbox o where o.id = p_id;
  if not found then
    return 'reminder.row_gone';
  end if;

  if not private.is_member_active(v_row.recipient_member_id) then
    return 'reminder.member_inactive';
  end if;

  select t.* into v_task
  from public.tasks t
  where t.id = v_row.task_id
    and t.deleted_at is null
    and t."column" <> 'done';
  if not found then
    return 'reminder.task_gone';
  end if;

  if not exists (
    select 1
    from public.task_assignments a
    where a.task_id = v_task.id
      and a.member_id = v_row.recipient_member_id
      and a.state in ('awaiting_response', 'on_it')
  ) then
    return 'reminder.slot_closed';
  end if;

  v_due := (v_row.payload ->> 'due_at')::timestamptz;
  if v_due is null
    or date_trunc('milliseconds', v_task.due_at) <> v_due
  then
    return 'reminder.due_changed';
  end if;

  if v_task.due_at <= now() then
    return 'reminder.past_due';
  end if;

  return null;
end;
$$;

revoke all on function
  private.tasks_due_for_reminder(timestamptz),
  public.enqueue_due_reminders(),
  private.email_send_check_reminder(uuid)
from public, anon, authenticated;

grant execute on function public.enqueue_due_reminders() to service_role;
