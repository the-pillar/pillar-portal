-- members_onboarding: onboarding is remembered per member on the server
-- (Story 8.3, PRD 1.11, spine AD-23), since the office PCs share one Windows
-- login. No screens here; Story 8.9 builds them on `my_onboarding()`.
--
-- No row in `member_onboarding` means nothing seen, and this migration
-- inserts none. Onboarding commands write no `activity` row (AD-16).

create type public.onboarding_step as enum (
  'tour_seen',
  'copied_task',
  'checklist_done',
  'first_run_shown',
  'first_run_closed'
);

create table public.member_onboarding (
  member_id uuid primary key references public.members (id) on delete cascade,
  tour_seen_at timestamptz,
  copied_task_at timestamptz,
  checklist_done_at timestamptz,
  first_run_shown_at timestamptz,
  first_run_closed_at timestamptz
);

alter table public.member_onboarding enable row level security;

create policy member_onboarding_select_own on public.member_onboarding
  for select
  to authenticated
  using (member_id = (select auth.uid()));

grant select on public.member_onboarding to authenticated;
revoke all on table public.member_onboarding from service_role;

-- Records one step for the caller. Keeps a timestamp already there.
create function public.record_onboarding(step public.onboarding_step)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_member_id();
begin
  if v_me is null then
    raise exception using errcode = 'P0001', message = 'auth.not_active';
  end if;

  if record_onboarding.step is null then
    return;
  end if;

  -- The upsert takes the row lock itself.
  insert into public.member_onboarding as o (
    member_id, tour_seen_at, copied_task_at, checklist_done_at,
    first_run_shown_at, first_run_closed_at
  )
  values (
    v_me,
    case when record_onboarding.step = 'tour_seen' then now() end,
    case when record_onboarding.step = 'copied_task' then now() end,
    case when record_onboarding.step = 'checklist_done' then now() end,
    case when record_onboarding.step = 'first_run_shown' then now() end,
    case when record_onboarding.step = 'first_run_closed' then now() end
  )
  on conflict (member_id) do update
    set tour_seen_at = coalesce(o.tour_seen_at, excluded.tour_seen_at),
        copied_task_at = coalesce(o.copied_task_at, excluded.copied_task_at),
        checklist_done_at = coalesce(o.checklist_done_at, excluded.checklist_done_at),
        first_run_shown_at = coalesce(o.first_run_shown_at, excluded.first_run_shown_at),
        first_run_closed_at = coalesce(o.first_run_closed_at, excluded.first_run_closed_at);
end;
$$;

grant execute on function public.record_onboarding(public.onboarding_step) to authenticated;

-- "Show tips again": clears the card's two timestamps, so the card shows
-- again and `private.close_first_run` acts only on that showing.
create function public.reset_first_run()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_member_id();
begin
  if v_me is null then
    raise exception using errcode = 'P0001', message = 'auth.not_active';
  end if;

  update public.member_onboarding o
  set first_run_shown_at = null,
      first_run_closed_at = null
  where o.member_id = v_me;
end;
$$;

grant execute on function public.reset_first_run() to authenticated;

-- Closes the staff first-run card once the member responds to a slot. Plain
-- (not `security definer`) like `private.log_activity`: it only runs nested
-- inside `respond_to_slot`, so it needs no grant. Never inserts.
create function private.close_first_run(p_member_id uuid)
returns void
language sql
set search_path = ''
as $$
  update public.member_onboarding o
  set first_run_closed_at = now()
  where o.member_id = p_member_id
    and o.first_run_shown_at is not null
    and o.first_run_closed_at is null
$$;

revoke all on function private.close_first_run(uuid)
  from public, anon, authenticated, service_role;

-- Whether the caller has a verified authenticator-app factor. Definer because
-- `auth.mfa_factors` is not readable by the API roles.
create function private.has_verified_factor()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from auth.mfa_factors f
    where f.user_id = (select auth.uid())
      and f.factor_type = 'totp'
      and f.status = 'verified'
  )
$$;

grant execute on function private.has_verified_factor() to authenticated;

-- Whether the caller has approved a member. Definer because `activity` has no
-- SELECT policy for members.
create function private.has_approved_member()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.activity a
    where a.entity_type = 'member'
      and a.action = 'approved'
      and a.actor_id = (select auth.uid())
  )
$$;

grant execute on function private.has_approved_member() to authenticated;

-- Which onboarding applies to the caller and what they have seen. One row for
-- an active caller, none otherwise. Runs with the caller's rights, so RLS
-- shows only their own `member_onboarding` row.
create function public.my_onboarding()
returns table (
  tour_and_checklist boolean,
  tour_seen boolean,
  copied_task boolean,
  checklist_done boolean,
  first_run_shown boolean,
  first_run_closed boolean,
  two_factor boolean,
  approved_member boolean
)
language sql
security invoker
stable
set search_path = ''
as $$
  select
    private.is_admin(),
    o.tour_seen_at is not null,
    o.copied_task_at is not null,
    o.checklist_done_at is not null,
    o.first_run_shown_at is not null,
    o.first_run_closed_at is not null,
    private.has_verified_factor(),
    private.has_approved_member()
  from (select private.current_member_id() as id) me
  left join public.member_onboarding o on o.member_id = me.id
  where me.id is not null
$$;

grant execute on function public.my_onboarding() to authenticated;

-- respond_to_slot, as in tasks_delete, plus one call that closes the staff
-- first-run card. The existing grant survives.
create or replace function public.respond_to_slot(
  slot_id uuid,
  response public.slot_state,
  reason text default null
)
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
  v_reason text;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'auth.not_active';
  end if;

  select a.id into v_slot_id
  from public.task_assignments a
  where a.id = respond_to_slot.slot_id
  for update;

  if v_slot_id is null then
    raise exception using errcode = 'P0001', message = 'tasks.not_found';
  end if;

  -- Lock the task too, as hand_back_slot does, so a Mark done can't commit
  -- between the check below and the write. A deleted task is missing.
  select t.id into v_task_id
  from public.tasks t
  join public.task_assignments a on a.task_id = t.id
  where a.id = v_slot_id
    and t.deleted_at is null
  for update of t;

  if v_task_id is null then
    raise exception using errcode = 'P0001', message = 'tasks.not_found';
  end if;

  if respond_to_slot.response is null
    or respond_to_slot.response not in ('on_it', 'needs_reassignment')
    or not private.can_respond_to_slot(v_slot_id)
  then
    raise exception using errcode = 'P0001', message = 'tasks.not_allowed';
  end if;

  update public.task_assignments a
  set state = respond_to_slot.response,
      updated_at = now()
  where a.id = v_slot_id;

  perform private.close_first_run(v_actor);

  v_reason := nullif(
    regexp_replace(
      coalesce(respond_to_slot.reason, ''),
      '^[[:space:]]+|[[:space:]]+$', '', 'g'
    ),
    ''
  );

  if respond_to_slot.response = 'needs_reassignment' and v_reason is not null then
    insert into public.assignment_reasons (assignment_id, reason)
    values (v_slot_id, v_reason)
    on conflict (assignment_id) do update
      set reason = excluded.reason,
          updated_at = now();
  else
    delete from public.assignment_reasons r
    where r.assignment_id = v_slot_id;
  end if;

  perform private.log_activity(
    v_op, 'task_assignment', v_slot_id, v_actor,
    'slot_' || respond_to_slot.response::text
  );
end;
$$;
