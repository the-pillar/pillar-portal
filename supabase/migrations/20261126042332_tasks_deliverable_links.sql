-- tasks_deliverable_links: a slot's holder hands in work as links, one row
-- each (Story 8.16, spine AD-25, AD-21, AD-16, AD-24). Expand step only, no
-- screens: Story 8.17 builds Task detail on the data, commands and
-- capabilities added here.
--
-- - `task_deliverable_links` holds one link per row, read in `seq` order, a
--   slot's up to five. `slot_id` is `on delete restrict`, so a slot holding
--   links can't be deleted by anything, and `update_task` refuses it first.
--   Clients read it through one SELECT policy (an active member, a live
--   task) and write nothing: no INSERT, UPDATE or DELETE grant, and none for
--   `service_role`. It joins the Realtime publication as a refetch signal.
-- - `private.can_edit_deliverables(slot_id)` is the one edge: the caller is
--   active and holds the slot, the slot is `on_it` and its task isn't
--   deleted. There is no column check, so the holder can add a last link to
--   a Done task. It is granted to `authenticated` because
--   `task_capabilities` runs as the caller.
-- - `add_deliverable_links(slot_id, urls)` checks, in order: active
--   (`auth.not_active`), the list (`tasks.invalid_links`, reason `link`, a
--   null, nested, bad or over-long list or an empty one, before any read),
--   the locks (the slot, then its live task, else `tasks.not_found`), the
--   edge (`tasks.not_allowed`), then the limit (`tasks.invalid_links`,
--   reason `limit`, `remaining`). It inserts every link or none, in array
--   order, and logs one `deliverable_added` row on the task.
-- - `remove_deliverable_link(link_id)` returns false, logging nothing, for a
--   missing link or a deleted task: the one exception to `not_found`. The
--   slot's holder (the edge) or the task's approver may remove; anyone else
--   raises `tasks.not_allowed`. The link is read once to find its slot, and
--   again after the locks, because locking the link row first would lock it
--   before its slot and break AD-21's order. It logs one
--   `deliverable_removed` row on the task.
-- - `task_capabilities` gains `deliverable_add_slot_ids` (the caller's slots
--   at the edge with fewer than five links), `deliverable_remove_slot_ids`
--   (the slots at the edge) and `can_remove_deliverables` (the approver),
--   after the existing columns, which are unchanged.
-- - Both `update_task` overloads are replaced as copies of their latest
--   bodies, plus one check after the `tasks.stale` id checks and before the
--   Done check: a stored slot left out of `slots` that holds links raises
--   `tasks.slot_has_links` with its role. A changed role on an id already
--   raises `tasks.stale`, so a re-role is a removal and is covered.
--
-- Lock order is unchanged: a slot command locks its slot, then the task.
-- Reassign, hand back and `release_member_slots` don't touch the links, so
-- they keep them and `added_by`. The error codes `tasks.slot_has_links` and
-- the two `invalid_links` details aren't mapped in errors.ts yet: no UI adds
-- a link until Story 8.17.

create table public.task_deliverable_links (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  slot_id uuid not null references public.task_assignments (id)
    on delete restrict,
  url text not null
    constraint task_deliverable_links_url_valid
    check (private.is_valid_link(url)),
  added_by uuid not null references public.members (id),
  added_at timestamptz not null default now()
);

create index task_deliverable_links_slot_id_idx
  on public.task_deliverable_links (slot_id);

alter table public.task_deliverable_links enable row level security;

create policy task_deliverable_links_select_active
  on public.task_deliverable_links
  for select
  to authenticated
  using (
    (select private.is_active_member())
    and exists (
      select 1
      from public.task_assignments a
      join public.tasks t on t.id = a.task_id
      where a.id = task_deliverable_links.slot_id
        and t.deleted_at is null
    )
  );

grant select on public.task_deliverable_links to authenticated;
revoke all on table public.task_deliverable_links from service_role;
revoke all on sequence public.task_deliverable_links_seq_seq from service_role;

-- Guarded, like tasks_realtime: a table already switched on in a project's
-- dashboard would otherwise make this migration fail there.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'task_deliverable_links'
  ) then
    alter publication supabase_realtime add table public.task_deliverable_links;
  end if;
end
$$;

-- The one edge for adding links, and for a holder's removal.
create function private.can_edit_deliverables(p_slot_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce((
    select a.state = 'on_it'
      and a.member_id = private.current_member_id()
    from public.task_assignments a
    join public.tasks t on t.id = a.task_id
    where a.id = p_slot_id
      and t.deleted_at is null
      and private.is_active_member()
  ), false)
$$;

grant execute on function private.can_edit_deliverables(uuid) to authenticated;

-- Adds one or more links to a slot the caller holds. Raises
-- `auth.not_active`, `tasks.invalid_links` (detail `{"reason":"link"}` or
-- `{"reason":"limit","remaining":n}`), `tasks.not_found` or
-- `tasks.not_allowed`.
create function public.add_deliverable_links(slot_id uuid, urls text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_member_id();
  v_op uuid := gen_random_uuid();
  v_slot_id uuid;
  v_task_id uuid;
  v_count integer;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'auth.not_active';
  end if;

  if not private.is_valid_link_list(add_deliverable_links.urls)
    or cardinality(add_deliverable_links.urls) = 0
  then
    raise exception using errcode = 'P0001', message = 'tasks.invalid_links',
      detail = jsonb_build_object('reason', 'link')::text;
  end if;

  select a.id into v_slot_id
  from public.task_assignments a
  where a.id = add_deliverable_links.slot_id
  for update;

  if v_slot_id is null then
    raise exception using errcode = 'P0001', message = 'tasks.not_found';
  end if;

  select t.id into v_task_id
  from public.tasks t
  join public.task_assignments a on a.task_id = t.id
  where a.id = v_slot_id
    and t.deleted_at is null
  for update of t;

  if v_task_id is null then
    raise exception using errcode = 'P0001', message = 'tasks.not_found';
  end if;

  if not private.can_edit_deliverables(v_slot_id) then
    raise exception using errcode = 'P0001', message = 'tasks.not_allowed';
  end if;

  select count(*) into v_count
  from public.task_deliverable_links l
  where l.slot_id = v_slot_id;

  if v_count + cardinality(add_deliverable_links.urls) > 5 then
    raise exception using errcode = 'P0001', message = 'tasks.invalid_links',
      detail = jsonb_build_object('reason', 'limit', 'remaining', 5 - v_count)::text;
  end if;

  insert into public.task_deliverable_links (slot_id, url, added_by)
  select v_slot_id, u.url, v_actor
  from unnest(add_deliverable_links.urls) with ordinality as u (url, n)
  order by u.n;

  perform private.log_activity(v_op, 'task', v_task_id, v_actor, 'deliverable_added');
end;
$$;

grant execute on function public.add_deliverable_links(uuid, text[]) to authenticated;

-- Removes one link. Returns false when it is already gone or its task is
-- deleted. Raises `auth.not_active` or `tasks.not_allowed`.
create function public.remove_deliverable_link(link_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_member_id();
  v_op uuid := gen_random_uuid();
  v_slot_id uuid;
  v_task_id uuid;
  v_found uuid;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'auth.not_active';
  end if;

  -- Unlocked: it only finds the slot to lock. The link is read again below.
  select l.slot_id into v_slot_id
  from public.task_deliverable_links l
  where l.id = remove_deliverable_link.link_id;

  if v_slot_id is null then
    return false;
  end if;

  perform 1
  from public.task_assignments a
  where a.id = v_slot_id
  for update;

  select t.id into v_task_id
  from public.tasks t
  join public.task_assignments a on a.task_id = t.id
  where a.id = v_slot_id
    and t.deleted_at is null
  for update of t;

  if v_task_id is null then
    return false;
  end if;

  if not (
    private.can_edit_deliverables(v_slot_id)
    or private.is_task_approver(v_task_id)
  ) then
    raise exception using errcode = 'P0001', message = 'tasks.not_allowed';
  end if;

  -- Another removal may have taken it while this one waited for the locks.
  delete from public.task_deliverable_links l
  where l.id = remove_deliverable_link.link_id
  returning l.id into v_found;

  if v_found is null then
    return false;
  end if;

  perform private.log_activity(v_op, 'task', v_task_id, v_actor, 'deliverable_removed');

  return true;
end;
$$;

grant execute on function public.remove_deliverable_link(uuid) to authenticated;

-- A new set of columns changes the return type, so the function is replaced.
drop function public.task_capabilities(uuid[]);

-- What the caller may do on each task, as tasks_reassign left it, plus the
-- slots it may add deliverable links to (at the edge, fewer than five links)
-- or remove them from (at the edge), in slot order (created_at, then id), and
-- whether it may remove any link on the task (the approver). The only source
-- of the actions a page offers. Runs with the caller's rights, so it returns
-- rows only for tasks the caller can read: never a deleted one.
create function public.task_capabilities(ids uuid[])
returns table (
  task_id uuid,
  allowed_moves public.task_column[],
  respondable_slot_ids uuid[],
  hand_back_slot_ids uuid[],
  can_review boolean,
  can_reopen boolean,
  can_manage boolean,
  can_reassign boolean,
  deliverable_add_slot_ids uuid[],
  deliverable_remove_slot_ids uuid[],
  can_remove_deliverables boolean
)
language sql
security invoker
stable
set search_path = ''
as $$
  -- The approver check, once per task, shared by can_manage, can_reassign and
  -- can_remove_deliverables. Every approver is an admin: the InitPlan runs
  -- once per call, so a staff caller pays nothing per task. Materialized, so
  -- it isn't flattened into the select below and run once per column.
  with ap as materialized (
    select
      t.id,
      case
        when (select private.is_admin()) then private.is_task_approver(t.id)
        else false
      end as is_approver
    from public.tasks t
    where t.id = any (ids)
  )
  select
    t.id,
    array(
      select c.col
      from unnest(enum_range(null::public.task_column)) with ordinality as c (col, n)
      where private.can_move_task(t.id, c.col)
      order by c.n
    ),
    array(
      select a.id
      from public.task_assignments a
      where a.task_id = t.id
        and private.can_respond_to_slot(a.id)
      order by a.created_at, a.id
    ),
    array(
      select a.id
      from public.task_assignments a
      where a.task_id = t.id
        and private.can_hand_back_slot(a.id)
      order by a.created_at, a.id
    ),
    private.can_review_task(t.id),
    private.can_reopen_task(t.id),
    ap.is_approver,
    ap.is_approver and t."column" <> 'done',
    array(
      select a.id
      from public.task_assignments a
      where a.task_id = t.id
        and private.can_edit_deliverables(a.id)
        and (
          select count(*)
          from public.task_deliverable_links l
          where l.slot_id = a.id
        ) < 5
      order by a.created_at, a.id
    ),
    array(
      select a.id
      from public.task_assignments a
      where a.task_id = t.id
        and private.can_edit_deliverables(a.id)
      order by a.created_at, a.id
    ),
    ap.is_approver
  from public.tasks t
  join ap on ap.id = t.id
$$;

grant execute on function public.task_capabilities(uuid[]) to authenticated;

-- The single-link overload, as tasks_reassign left it, plus the links check.
create or replace function public.update_task(
  task_id uuid,
  title text,
  description text,
  due_at timestamptz,
  reference_url text,
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
  v_links_role public.production_role;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'auth.not_active';
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

  -- A stored slot left out (or re-roled, which raised above) can't take its
  -- deliverable links with it. The first such slot, in slot order, names the
  -- role; the approver removes the links or reassigns the slot instead.
  select a.role into v_links_role
  from public.task_assignments a
  where a.task_id = v_task.id
    and not exists (
      select 1
      from jsonb_array_elements(update_task.slots) as s
      where (s.value ->> 'id')::uuid = a.id
    )
    and exists (
      select 1
      from public.task_deliverable_links l
      where l.slot_id = a.id
    )
  order by a.created_at, a.id
  limit 1;

  if v_links_role is not null then
    raise exception using errcode = 'P0001', message = 'tasks.slot_has_links',
      detail = jsonb_build_object('role', v_links_role)::text;
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
    or v_task.reference_url is distinct from update_task.reference_url;

  -- Nothing to save: no write, no activity, the version stays.
  if not v_fields_changed and not v_slots_changed then
    return false;
  end if;

  update public.tasks t
  set title = update_task.title,
      description = update_task.description,
      due_at = update_task.due_at,
      reference_url = update_task.reference_url,
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

-- The list overload, as tasks_reference_links left it, plus the links check.
create or replace function public.update_task(
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
  v_links_role public.production_role;
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

  -- A stored slot left out (or re-roled, which raised above) can't take its
  -- deliverable links with it. The first such slot, in slot order, names the
  -- role; the approver removes the links or reassigns the slot instead.
  select a.role into v_links_role
  from public.task_assignments a
  where a.task_id = v_task.id
    and not exists (
      select 1
      from jsonb_array_elements(update_task.slots) as s
      where (s.value ->> 'id')::uuid = a.id
    )
    and exists (
      select 1
      from public.task_deliverable_links l
      where l.slot_id = a.id
    )
  order by a.created_at, a.id
  limit 1;

  if v_links_role is not null then
    raise exception using errcode = 'P0001', message = 'tasks.slot_has_links',
      detail = jsonb_build_object('role', v_links_role)::text;
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

grant execute on function
  public.update_task(uuid, text, text, timestamptz, text, jsonb)
to authenticated;

grant execute on function public.update_task(
  uuid, text, text, timestamptz, text[], jsonb
) to authenticated;
