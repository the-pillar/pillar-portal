-- tasks_reference_links: a task's reference links become one ordered list
-- (Story 8.14, spine AD-24, AD-17). Expand step only, no screens: the
-- `reference_url` column, its CHECK and the single-link `create_task` and
-- `update_task` stay until Story 8.12, and a sync trigger keeps
-- `reference_url` equal to link 1 so the deployed code keeps working.

-- The one element predicate (deliverable links, AD-25, share it). Not a
-- definer and no grant: it is an exception to Conventions > Function
-- security, called by CHECKs and by definer commands. Not `strict`, so a null
-- link gives false, never null. The refused characters are an explicit set,
-- never `\s`, whose meaning differs between Postgres locales and JavaScript:
-- U+0001-U+0020, U+007F, U+0085, U+00A0, U+200B-U+200F, U+2028, U+2029,
-- U+202F, U+205F, U+3000, U+FEFF.
create function private.is_valid_link(link text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    link ~ '^https?://'
    and char_length(link) <= 2048
    and link !~ '[\u0001-\u0020\u007f\u0085\u00a0\u200b-\u200f\u2028\u2029\u202f\u205f\u3000\ufeff]',
    false
  )
$$;

revoke all on function private.is_valid_link(text)
  from public, anon, authenticated, service_role;

-- The list: one-dimensional with lower bound 1 (or empty), at most 5
-- elements, each a valid link. A null array is false.
create function private.is_valid_link_list(links text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    links is not null
    and cardinality(links) <= 5
    and (
      cardinality(links) = 0
      or (array_ndims(links) = 1 and array_lower(links, 1) = 1)
    )
    and not exists (
      select 1 from unnest(links) as l where not private.is_valid_link(l)
    ),
    false
  )
$$;

revoke all on function private.is_valid_link_list(text[])
  from public, anon, authenticated, service_role;

-- 1. The column.
alter table public.tasks
  add column reference_urls text[] not null default '{}'
    constraint tasks_reference_urls_valid
    check (private.is_valid_link_list(reference_urls));

-- 2. The backfill, with `tasks_stamp_row` off so no `updated_*` changes. It
-- stays for pgTAP until Story 8.12. A `reference_url` the old `\S` CHECK
-- accepted but `is_valid_link` refuses fails here and rolls the migration
-- back whole.
create function private.backfill_reference_urls()
returns void
language plpgsql
set search_path = ''
as $$
begin
  alter table public.tasks disable trigger tasks_stamp_row;

  update public.tasks t
  set reference_urls = array[t.reference_url]
  where t.reference_url is not null
    and cardinality(t.reference_urls) = 0;

  alter table public.tasks enable trigger tasks_stamp_row;
end;
$$;

revoke all on function private.backfill_reference_urls()
  from public, anon, authenticated, service_role;

select private.backfill_reference_urls();

-- 3. `reference_url` is always link 1.
alter table public.tasks
  add constraint tasks_reference_url_is_link_1
  check (reference_url is not distinct from reference_urls[1]);

-- 4. The sync trigger. Insert: a row given only `reference_url` gets it as
-- its one link; otherwise `reference_url` becomes link 1. Update: a changed
-- list wins; else a changed `reference_url` replaces link 1 (or becomes the
-- list when it was empty), and null removes link 1, keeping links 2-5.
create function private.sync_reference_urls()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if cardinality(new.reference_urls) = 0 and new.reference_url is not null then
      new.reference_urls := array[new.reference_url];
    end if;
  elsif new.reference_urls is distinct from old.reference_urls then
    null;
  elsif new.reference_url is distinct from old.reference_url then
    if new.reference_url is null then
      new.reference_urls := old.reference_urls[2:];
    elsif cardinality(old.reference_urls) = 0 then
      new.reference_urls := array[new.reference_url];
    else
      new.reference_urls := array[new.reference_url] || old.reference_urls[2:];
    end if;
  end if;

  new.reference_url := new.reference_urls[1];
  return new;
end;
$$;

revoke all on function private.sync_reference_urls()
  from public, anon, authenticated, service_role;

create trigger tasks_sync_reference_urls
  before insert or update on public.tasks
  for each row execute function private.sync_reference_urls();

-- The list overloads, beside the single-link ones. PostgREST picks by
-- argument names; in SQL an untyped null or literal in that position resolves
-- to the `reference_url` overload, so list callers pass `array[...]`, a typed
-- `::text[]`, or named arguments.

create function public.create_task(
  title text,
  description text,
  owning_section_id text,
  owning_desk_id text,
  due_at timestamptz,
  reference_urls text[],
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

  if not private.is_valid_link_list(reference_urls) then
    raise exception using errcode = 'P0001', message = 'tasks.invalid_links';
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
    reference_urls, created_by
  )
  values (
    title, description, owning_section_id, owning_desk_id, due_at,
    reference_urls, v_actor
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

create function public.update_task(
  task_id uuid,
  title text,
  description text,
  due_at timestamptz,
  reference_urls text[],
  slots jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_member_id();
  v_op uuid := gen_random_uuid();
  v_locked_slots uuid[];
  v_task public.tasks%rowtype;
  v_fields_changed boolean;
  v_slots_changed boolean;
  v_new_member boolean := false;
  v_slot record;
  v_slot_id uuid;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'auth.not_active';
  end if;

  if not private.is_valid_link_list(update_task.reference_urls) then
    raise exception using errcode = 'P0001', message = 'tasks.invalid_links';
  end if;

  -- Slots before their task, in id order, so this can't deadlock with
  -- respond_to_slot, hand_back_slot or reassign_slot, nor with another
  -- update_task. The ids locked here are the only slots this command may
  -- write.
  select coalesce(array_agg(l.id), '{}') into v_locked_slots
  from (
    select a.id
    from public.task_assignments a
    where a.task_id = update_task.task_id
    order by a.id
    for update
  ) as l;

  select t.* into v_task
  from public.tasks t
  where t.id = update_task.task_id and t.deleted_at is null
  for update;

  if v_task.id is null then
    raise exception using errcode = 'P0001', message = 'tasks.not_found';
  end if;

  if not private.is_task_approver(v_task.id) then
    raise exception using errcode = 'P0001', message = 'tasks.not_approver';
  end if;

  -- A slot another update_task added while this one waited for the task
  -- isn't locked, and locking it now would lock a slot after its task.
  if exists (
    select 1
    from public.task_assignments a
    where a.task_id = v_task.id
      and a.id <> all (v_locked_slots)
  ) then
    raise exception using errcode = 'P0001', message = 'tasks.stale';
  end if;

  if update_task.slots is null
    or jsonb_typeof(update_task.slots) <> 'array'
    or jsonb_array_length(update_task.slots) < 1
  then
    raise exception using errcode = 'P0001', message = 'tasks.no_slots';
  end if;

  -- An id that isn't one of this task's slots (another approver removed
  -- it), an id listed twice, an id whose role isn't the stored one, or an id
  -- whose stored member isn't the one the form loaded (another approver
  -- reassigned it since; a missing loaded member counts as a mismatch).
  if exists (
    select 1
    from jsonb_array_elements(update_task.slots) as s
    where s.value ->> 'id' is not null
      and not exists (
        select 1
        from public.task_assignments a
        where a.id = (s.value ->> 'id')::uuid
          and a.task_id = v_task.id
          and a.role = (s.value ->> 'role')::public.production_role
      )
  ) or exists (
    select 1
    from jsonb_array_elements(update_task.slots) as s
    where s.value ->> 'id' is not null
    group by (s.value ->> 'id')::uuid
    having count(*) > 1
  ) or exists (
    select 1
    from jsonb_array_elements(update_task.slots) as s
    join public.task_assignments a
      on a.id = (s.value ->> 'id')::uuid
    where s.value ->> 'id' is not null
      and a.member_id is distinct from (s.value ->> 'loaded_member_id')::uuid
  ) then
    raise exception using errcode = 'P0001', message = 'tasks.stale';
  end if;

  -- Whether any slot is removed (a stored slot left out), reassigned (same
  -- id, another member) or added (no id).
  v_slots_changed := exists (
    select 1
    from public.task_assignments a
    where a.task_id = v_task.id
      and not exists (
        select 1
        from jsonb_array_elements(update_task.slots) as s
        where (s.value ->> 'id')::uuid = a.id
      )
  ) or exists (
    select 1
    from jsonb_array_elements(update_task.slots) as s
    left join public.task_assignments a
      on a.id = (s.value ->> 'id')::uuid
    where a.id is null
       or a.member_id is distinct from (s.value ->> 'member_id')::uuid
  );

  -- A Done task's slots offer no answers, so its edits are text-only.
  if v_task."column" = 'done' and v_slots_changed then
    raise exception using errcode = 'P0001', message = 'tasks.not_allowed';
  end if;

  -- A new row's member, or a changed member, must be active. An unchanged
  -- slot keeps its member, active or not.
  if exists (
    select 1
    from jsonb_array_elements(update_task.slots) as s
    left join public.task_assignments a
      on a.id = (s.value ->> 'id')::uuid
    where (a.id is null
           or a.member_id is distinct from (s.value ->> 'member_id')::uuid)
      and not private.is_member_active((s.value ->> 'member_id')::uuid)
  ) then
    raise exception using errcode = 'P0001', message = 'tasks.invalid_slot_member';
  end if;

  -- The list is the final set of slots, so a duplicate is one within it.
  if exists (
    select 1
    from jsonb_array_elements(update_task.slots) as s
    group by (s.value ->> 'role')::public.production_role,
             (s.value ->> 'member_id')::uuid
    having count(*) > 1
  ) then
    raise exception using errcode = 'P0001', message = 'tasks.duplicate_slot';
  end if;

  v_fields_changed :=
    v_task.title is distinct from update_task.title
    or v_task.description is distinct from update_task.description
    or v_task.due_at is distinct from update_task.due_at
    or v_task.reference_urls is distinct from update_task.reference_urls;

  -- Nothing to save: no write, no activity, the version stays.
  if not v_fields_changed and not v_slots_changed then
    return false;
  end if;

  update public.tasks t
  set title = update_task.title,
      description = update_task.description,
      due_at = update_task.due_at,
      reference_urls = update_task.reference_urls,
      updated_at = now()
  where t.id = v_task.id;

  -- Two same-role slots may trade members, which holds a duplicate pair
  -- between the two writes. Set back to immediate below.
  set constraints public.task_assignments_task_id_member_id_role_key deferred;

  -- Every slot left out (all of them locked above). Its reason row
  -- cascades.
  for v_slot_id in
    delete from public.task_assignments a
    where a.task_id = v_task.id
      and not exists (
        select 1
        from jsonb_array_elements(update_task.slots) as s
        where (s.value ->> 'id')::uuid = a.id
      )
    returning a.id
  loop
    perform private.log_activity(
      v_op, 'task_assignment', v_slot_id, v_actor, 'slot_removed'
    );
  end loop;

  -- The same id with a new member. The loop's query reads the slots as they
  -- stood before it, so each slot's stored member is compared once.
  for v_slot in
    select a.id, (s.value ->> 'member_id')::uuid as member_id
    from jsonb_array_elements(update_task.slots) with ordinality as s (value, n)
    join public.task_assignments a on a.id = (s.value ->> 'id')::uuid
    where a.member_id is distinct from (s.value ->> 'member_id')::uuid
    order by s.n
  loop
    perform private.reassign_slot_member(
      v_slot.id, v_slot.member_id, v_actor, v_op
    );
    v_new_member := true;
  end loop;

  -- Rows without an id, in the form's order (created_at is clock_timestamp,
  -- so they list in that order too).
  for v_slot in
    select (s.value ->> 'member_id')::uuid as member_id,
           (s.value ->> 'role')::public.production_role as role
    from jsonb_array_elements(update_task.slots) with ordinality as s (value, n)
    where s.value ->> 'id' is null
    order by s.n
  loop
    insert into public.task_assignments (task_id, member_id, role)
    values (v_task.id, v_slot.member_id, v_slot.role)
    returning id into v_slot_id;

    perform private.log_activity(
      v_op, 'task_assignment', v_slot_id, v_actor, 'slot_added'
    );
    v_new_member := true;
  end loop;

  -- Checks the pairs written above now, and leaves the rest of the
  -- transaction as every other command expects it.
  set constraints public.task_assignments_task_id_member_id_role_key immediate;

  perform private.log_activity(v_op, 'task', v_task.id, v_actor, 'updated');

  return v_new_member;
end;
$$;

grant execute on function public.create_task(
  text, text, text, text, timestamptz, text[], jsonb
) to authenticated;

grant execute on function public.update_task(
  uuid, text, text, timestamptz, text[], jsonb
) to authenticated;
