-- members_pending_helper: one definition of "pending" (Story 8.1).
--
-- `private.is_member_pending(uuid)` is the only definition of pending, the
-- counterpart of `private.is_member_active`: role `pending` with neither
-- `declined_at` nor `deactivated_at` set. approve_member, decline_member and
-- bootstrap_admin call it instead of restating the predicate. Each still
-- locks its target `for update` first, then checks, so the helper reads the
-- locked row. Signatures, grants, error codes, details and order are
-- unchanged. Pinned like is_member_active but, unlike it, granted to no
-- role: no policy or view calls it, only definer commands and the owner.

create function private.is_member_pending(p_member_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    where m.id = p_member_id
      and m.role = 'pending'
      and m.declined_at is null
      and m.deactivated_at is null
  )
$$;

revoke all on function private.is_member_pending(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.approve_member(
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
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'auth.not_active';
  end if;

  if not private.is_admin() then
    raise exception using errcode = 'P0001', message = 'members.not_admin';
  end if;

  v_positions := array(
    select distinct p.id
    from unnest(coalesce(approve_member.positions, '{}'::text[])) as p (id)
  );

  if cardinality(v_positions) = 0 then
    raise exception using errcode = 'P0001', message = 'members.no_positions';
  end if;

  if exists (
    select 1
    from unnest(v_positions) as p (id)
    where p.id is null
      or p.id = 'editor_in_chief'
      or not exists (select 1 from public.positions pos where pos.id = p.id)
  ) then
    raise exception using errcode = 'P0001', message = 'members.invalid_position';
  end if;

  if not coalesce(approve_member.primary_position = any (v_positions), false) then
    raise exception using errcode = 'P0001', message = 'members.invalid_primary';
  end if;

  select m.id into v_target
  from public.members m
  where m.id = approve_member.member_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'members.not_found';
  end if;

  if not private.is_member_pending(v_target.id) then
    raise exception using errcode = 'P0001', message = 'members.stale';
  end if;

  insert into public.member_positions (member_id, position, is_primary)
  select v_target.id, p.id, p.id = approve_member.primary_position
  from unnest(v_positions) as p (id);

  update public.members m
  set updated_at = now(),
      updated_by = v_actor
  where m.id = v_target.id;

  perform private.log_activity(v_op, 'member', v_target.id, v_actor, 'approved');
end;
$$;

create or replace function public.decline_member(member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_member_id();
  v_op uuid := gen_random_uuid();
  v_target record;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'auth.not_active';
  end if;

  if not private.is_admin() then
    raise exception using errcode = 'P0001', message = 'members.not_admin';
  end if;

  select m.id into v_target
  from public.members m
  where m.id = decline_member.member_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'members.not_found';
  end if;

  if not private.is_member_pending(v_target.id) then
    raise exception using errcode = 'P0001', message = 'members.stale';
  end if;

  update public.members m
  set declined_at = now(),
      updated_at = now(),
      updated_by = v_actor
  where m.id = v_target.id;

  perform private.log_activity(v_op, 'member', v_target.id, v_actor, 'declined');
end;
$$;

create or replace function private.bootstrap_admin(email text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_email text := lower(
    regexp_replace(bootstrap_admin.email, '^[[:space:]]+|[[:space:]]+$', '', 'g')
  );
  v_member record;
begin
  -- Two bootstraps at once would both see no admin.
  perform pg_advisory_xact_lock(hashtextextended('members:bootstrap_admin', 0));

  if exists (
    select 1 from public.members m where m.role = 'editorial_admin'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'members.admin_exists',
      detail = 'An Editorial Board member already exists, so the bootstrap '
        || 'is closed. An admin approves new members at /admin/members.';
  end if;

  select m.id into v_member
  from public.members m
  where m.email = v_email
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'members.not_found',
      detail = 'No member has that email. They must sign in once with '
        || 'Google first, then the bootstrap can run.';
  end if;

  if not private.is_member_pending(v_member.id) then
    raise exception using
      errcode = 'P0001',
      message = 'members.not_pending',
      detail = 'That member is declined, deactivated or already active. '
        || 'Only a member waiting for approval can be bootstrapped.';
  end if;

  insert into public.member_positions (member_id, position, is_primary)
  values (v_member.id, 'editor_in_chief', true);

  insert into public.job_runs (job, status, finished_at)
  values ('bootstrap', 'ok', now());

  return v_member.id;
end;
$$;
