-- tasks_versioned_moves: a column move carries a version (Story 8.4, spine
-- AD-4, AD-14, AD-21), so Board Undo (8.6) can't overwrite someone's later
-- move, and `can_create_task()` tells the UI whether to offer New task (8.8).
-- No screens here. The two-argument `move_task` stays until Story 8.12.

alter table public.tasks
  add column moved_at timestamptz not null default now(),
  add column moved_by uuid references public.members (id),
  add column updated_by uuid references public.members (id);

alter table public.task_assignments
  add column updated_by uuid references public.members (id);

-- One trigger function for both tables. `updated_at` is bumped only when the
-- statement left it alone; `moved_at` and `moved_by` change only when the
-- column does. `clock_timestamp()` so two moves inside one transaction (a
-- pgTAP file) still get different versions; each RPC is its own transaction
-- in production, where the choice changes nothing.
create function private.stamp_task_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.updated_by := private.current_member_id();
    if tg_table_name = 'tasks' then
      new.moved_by := private.current_member_id();
    end if;
    return new;
  end if;

  new.updated_by := private.current_member_id();
  if new.updated_at is not distinct from old.updated_at then
    new.updated_at := now();
  end if;

  if tg_table_name = 'tasks' then
    if new."column" is distinct from old."column" then
      new.moved_at := clock_timestamp();
      new.moved_by := private.current_member_id();
    else
      new.moved_at := old.moved_at;
      new.moved_by := old.moved_by;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.stamp_task_row()
  from public, anon, authenticated, service_role;

create trigger tasks_stamp_row
  before insert or update on public.tasks
  for each row execute function private.stamp_task_row();

create trigger task_assignments_stamp_row
  before insert or update on public.task_assignments
  for each row execute function private.stamp_task_row();

-- The versioned move. The stale check comes before can_move_task, so an Undo
-- after the approver's Done says who moved it, not a bare refusal. The detail
-- carries the name because the mover may be the approver, whom the Board
-- card doesn't list.
create function public.move_task(
  task_id uuid,
  to_column public.task_column,
  expected_moved_at timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_member_id();
  v_op uuid := gen_random_uuid();
  v_task public.tasks;
  v_moved_at timestamptz;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'auth.not_active';
  end if;

  select * into v_task
  from public.tasks t
  where t.id = move_task.task_id and t.deleted_at is null
  for update;

  if v_task.id is null then
    raise exception using errcode = 'P0001', message = 'tasks.not_found';
  end if;

  if v_task.moved_at is distinct from move_task.expected_moved_at then
    raise exception using errcode = 'P0001', message = 'tasks.stale',
      detail = jsonb_build_object(
        'column', v_task."column",
        'moved_by', v_task.moved_by,
        'moved_by_name', (select m.name from public.members m
                          where m.id = v_task.moved_by)
      )::text;
  end if;

  if not private.can_move_task(v_task.id, move_task.to_column) then
    raise exception using errcode = 'P0001', message = 'tasks.not_allowed';
  end if;

  update public.tasks t
  set "column" = move_task.to_column,
      revision_note = null,
      revision_note_by = null,
      revision_note_at = null,
      updated_at = now()
  where t.id = v_task.id
  returning t.moved_at into v_moved_at;

  perform private.log_activity(
    v_op, 'task', v_task.id, v_actor,
    'moved_to_' || move_task.to_column::text
  );

  return v_moved_at;
end;
$$;

grant execute on function public.move_task(uuid, public.task_column, timestamptz)
  to authenticated;

-- Who may create a task: one definition for create_task and the UI.
create function private.can_create_task()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select private.is_admin()
$$;

grant execute on function private.can_create_task() to authenticated;

create function public.can_create_task()
returns boolean
language sql
security invoker
stable
set search_path = ''
as $$
  select private.can_create_task()
$$;

grant execute on function public.can_create_task() to authenticated;

-- create_task is unchanged except the admin check.
create or replace function public.create_task(
  title text,
  description text,
  owning_section_id text,
  owning_desk_id text,
  due_at timestamptz,
  reference_url text,
  slots jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_member_id();
  v_op uuid := gen_random_uuid();
  v_id uuid;
  v_slot jsonb;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'auth.not_active';
  end if;

  if not private.can_create_task() then
    raise exception using errcode = 'P0001', message = 'tasks.not_admin';
  end if;

  if slots is null
    or jsonb_typeof(slots) <> 'array'
    or jsonb_array_length(slots) < 1
  then
    raise exception using errcode = 'P0001', message = 'tasks.no_slots';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(slots) as s
    where not private.is_member_active((s.value ->> 'member_id')::uuid)
  ) then
    raise exception using errcode = 'P0001', message = 'tasks.invalid_slot_member';
  end if;

  insert into public.tasks (
    title, description, owning_section_id, owning_desk_id, due_at,
    reference_url, created_by
  )
  values (
    title, description, owning_section_id, owning_desk_id, due_at,
    reference_url, v_actor
  )
  returning id into v_id;

  for v_slot in select * from jsonb_array_elements(slots)
  loop
    insert into public.task_assignments (task_id, member_id, role)
    values (
      v_id,
      (v_slot ->> 'member_id')::uuid,
      (v_slot ->> 'role')::public.production_role
    );
  end loop;

  perform private.log_activity(v_op, 'task', v_id, v_actor, 'created');

  return v_id;
end;
$$;
