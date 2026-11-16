-- members_lifecycle: an admin changes another member's positions or
-- deactivates them (Story 5.4, AD-4, AD-5, AD-22).
--
-- - Both commands call `private.recent_mfa()` (listed in
--   supabase/tests/00_security/step-up-commands.txt) and take
--   `pg_advisory_xact_lock(hashtextextended('members:roster_guard', 0))`
--   before their guards, so two admins demoting or deactivating each other
--   at once can't both pass the "last admin" check. Story 5.3's transfer
--   reuses the same lock.
-- - The role is never written: the positions decide it through
--   `member_positions_sync_role`. Editor-in-Chief is neither added nor
--   removed here (5.3 transfers it): a holder's set must include it, and a
--   non-holder's must not.
-- - A deactivated member keeps their row, positions and history. Their open
--   slots on live, not-Done tasks become `needs_reassignment` with the reason
--   "Member deactivated", each logged; slots on Done or deleted tasks stay.
-- - `private.can_manage_member` and `private.deactivation_guard` are shared by
--   the commands and `member_capabilities`, so what is offered is what the
--   commands accept (apart from the fresh code, which the UI prompts for).

-- The slots of one member, released for reassignment. Invoker: only the
-- definer commands call it, as the owner. Locks the member's slots, then the
-- tasks they sit on (slots before their tasks, as delete_task does), and
-- flips the slots on live non-Done tasks.
create function private.release_member_slots(
  p_member_id uuid,
  p_op_id uuid,
  p_actor uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_slot_ids uuid[];
  v_released uuid;
begin
  v_slot_ids := array(
    select a.id
    from public.task_assignments a
    where a.member_id = p_member_id
    order by a.id
    for update
  );

  perform 1
  from public.tasks t
  where t.id in (
    select a.task_id
    from public.task_assignments a
    where a.id = any (v_slot_ids)
  )
  order by t.id
  for update;

  for v_released in
    update public.task_assignments a
    set state = 'needs_reassignment',
        updated_at = now()
    from public.tasks t
    where a.id = any (v_slot_ids)
      and a.state <> 'needs_reassignment'
      and t.id = a.task_id
      and t.deleted_at is null
      and t."column" <> 'done'
    returning a.id
  loop
    insert into public.assignment_reasons (assignment_id, reason)
    values (v_released, 'Member deactivated')
    on conflict (assignment_id) do update
      set reason = excluded.reason,
          updated_at = now();

    perform private.log_activity(
      p_op_id, 'task_assignment', v_released, p_actor, 'slot_needs_reassignment'
    );
  end loop;
end;
$$;

revoke all on function private.release_member_slots(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

-- Why a member can't be deactivated: `members.sole_editor_in_chief` when they
-- hold Editor-in-Chief, `members.last_admin` when they are the only active
-- Editorial Board admin, otherwise null. Definer so it reads every position.
create function private.deactivation_guard(p_member_id uuid)
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from public.member_positions mp
      where mp.member_id = p_member_id
        and mp.position = 'editor_in_chief'
    ) then 'members.sole_editor_in_chief'
    when private.is_member_active(p_member_id)
      and exists (
        select 1
        from public.members m
        where m.id = p_member_id
          and m.role = 'editorial_admin'
      )
      and not exists (
        select 1
        from public.members o
        where o.id <> p_member_id
          and o.role = 'editorial_admin'
          and private.is_member_active(o.id)
      ) then 'members.last_admin'
  end
$$;

grant execute on function private.deactivation_guard(uuid) to authenticated;

-- Whether the caller may manage the target: an admin, the target an active
-- member other than the caller.
create function private.can_manage_member(p_member_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select private.is_admin()
    and p_member_id is distinct from (select auth.uid())
    and private.is_member_active(p_member_id)
$$;

grant execute on function private.can_manage_member(uuid) to authenticated;

-- Raises `auth.not_active`, `members.not_admin`, `auth.step_up_required`,
-- `members.no_positions`, `members.invalid_position` (unknown, null, or an
-- Editor-in-Chief change), `members.invalid_primary`, `members.not_found`,
-- `members.change_own_positions`, `members.stale` or `members.last_admin`.
create function public.update_member(
  member_id uuid,
  positions text[],
  primary_position text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_member_id();
  v_op uuid := gen_random_uuid();
  v_positions text[];
  v_target record;
  v_holds_eic boolean;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'auth.not_active';
  end if;

  if not private.is_admin() then
    raise exception using errcode = 'P0001', message = 'members.not_admin';
  end if;

  if not private.recent_mfa() then
    raise exception using errcode = 'P0001', message = 'auth.step_up_required';
  end if;

  v_positions := array(
    select distinct p.id
    from unnest(coalesce(update_member.positions, '{}'::text[])) as p (id)
  );

  if cardinality(v_positions) = 0 then
    raise exception using errcode = 'P0001', message = 'members.no_positions';
  end if;

  if exists (
    select 1
    from unnest(v_positions) as p (id)
    where p.id is null
      or not exists (select 1 from public.positions pos where pos.id = p.id)
  ) then
    raise exception using errcode = 'P0001', message = 'members.invalid_position';
  end if;

  if not coalesce(update_member.primary_position = any (v_positions), false) then
    raise exception using errcode = 'P0001', message = 'members.invalid_primary';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('members:roster_guard', 0));

  -- A caller demoted or deactivated while waiting on the lock is not an admin.
  if not private.is_admin() or private.current_member_id() is null then
    raise exception using errcode = 'P0001', message = 'members.not_admin';
  end if;

  select m.id into v_target
  from public.members m
  where m.id = update_member.member_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'members.not_found';
  end if;

  if v_target.id = v_actor then
    raise exception using errcode = 'P0001', message = 'members.change_own_positions';
  end if;

  if not private.is_member_active(v_target.id) then
    raise exception using errcode = 'P0001', message = 'members.stale';
  end if;

  v_holds_eic := exists (
    select 1
    from public.member_positions mp
    where mp.member_id = v_target.id
      and mp.position = 'editor_in_chief'
  );

  if v_holds_eic is distinct from ('editor_in_chief' = any (v_positions)) then
    raise exception using errcode = 'P0001', message = 'members.invalid_position';
  end if;

  -- Never through zero positions, which would flip the role to pending.
  update public.member_positions mp
  set is_primary = false
  where mp.member_id = v_target.id
    and mp.is_primary;

  insert into public.member_positions (member_id, position, is_primary)
  select v_target.id, p.id, false
  from unnest(v_positions) as p (id)
  on conflict on constraint member_positions_pkey do nothing;

  delete from public.member_positions mp
  where mp.member_id = v_target.id
    and mp.position <> all (v_positions);

  update public.member_positions mp
  set is_primary = true
  where mp.member_id = v_target.id
    and mp.position = update_member.primary_position;

  update public.members m
  set updated_at = now(),
      updated_by = v_actor
  where m.id = v_target.id;

  if not exists (
    select 1
    from public.members m
    where m.role = 'editorial_admin'
      and private.is_member_active(m.id)
  ) then
    raise exception using errcode = 'P0001', message = 'members.last_admin';
  end if;

  perform private.log_activity(v_op, 'member', v_target.id, v_actor, 'positions_changed');
end;
$$;

-- Raises `auth.not_active`, `members.not_admin`, `auth.step_up_required`,
-- `members.not_found`, `members.sole_editor_in_chief`, `members.deactivate_self`,
-- `members.stale` or `members.last_admin`.
create function public.deactivate_member(member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_member_id();
  v_op uuid := gen_random_uuid();
  v_target record;
  v_guard text;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'auth.not_active';
  end if;

  if not private.is_admin() then
    raise exception using errcode = 'P0001', message = 'members.not_admin';
  end if;

  if not private.recent_mfa() then
    raise exception using errcode = 'P0001', message = 'auth.step_up_required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('members:roster_guard', 0));

  -- A caller demoted or deactivated while waiting on the lock is not an admin.
  if not private.is_admin() or private.current_member_id() is null then
    raise exception using errcode = 'P0001', message = 'members.not_admin';
  end if;

  select m.id into v_target
  from public.members m
  where m.id = deactivate_member.member_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'members.not_found';
  end if;

  v_guard := private.deactivation_guard(v_target.id);

  if v_guard is not null then
    raise exception using errcode = 'P0001', message = v_guard;
  end if;

  if v_target.id = v_actor then
    raise exception using errcode = 'P0001', message = 'members.deactivate_self';
  end if;

  if not private.is_member_active(v_target.id) then
    raise exception using errcode = 'P0001', message = 'members.stale';
  end if;

  update public.members m
  set deactivated_at = now(),
      updated_at = now(),
      updated_by = v_actor
  where m.id = v_target.id;

  if not exists (
    select 1
    from public.members m
    where m.role = 'editorial_admin'
      and private.is_member_active(m.id)
  ) then
    raise exception using errcode = 'P0001', message = 'members.last_admin';
  end if;

  perform private.release_member_slots(v_target.id, v_op, v_actor);

  perform private.log_activity(v_op, 'member', v_target.id, v_actor, 'deactivated');
end;
$$;

grant execute on function
  public.update_member(uuid, text[], text),
  public.deactivate_member(uuid)
to authenticated;

-- member_capabilities gains the two controls and why Deactivate is blocked;
-- the return type changes, so drop and recreate.
drop function public.member_capabilities(uuid[]);

create function public.member_capabilities(ids uuid[])
returns table (
  member_id uuid,
  can_rename boolean,
  can_reset_mfa boolean,
  can_change_positions boolean,
  can_deactivate boolean,
  deactivate_blocked_by text
)
language sql
security invoker
stable
set search_path = ''
as $$
  select m.id,
         private.can_rename_member(m.id),
         private.can_reset_member_mfa(m.id),
         private.can_manage_member(m.id),
         private.can_manage_member(m.id),
         case
           when private.can_manage_member(m.id)
             then private.deactivation_guard(m.id)
         end
  from public.members m
  where m.id = any (ids)
$$;

grant execute on function public.member_capabilities(uuid[]) to authenticated;
