-- members_two_factor: step-up for high-impact commands, and the first command
-- behind it (Story 5.1, AD-22).
--
-- `private.recent_mfa()` is true when the caller's JWT `amr` holds a `totp`
-- entry from the last 15 minutes. It and 5.2's `session_id` are the only
-- `auth.jwt()` reads. Every function calling it is listed in
-- supabase/tests/00_security/step-up-commands.txt.
--
-- `reset_member_mfa` deletes another admin's TOTP factors so they enroll
-- again. `can_reset_member_mfa` is shared by the command and by
-- `member_capabilities`, so what is offered is what the command accepts
-- (apart from the fresh code, which the UI prompts for).

-- Invoker: it reads only the caller's own JWT. Not granted to any API role;
-- the definer commands that call it run as the owner.
create function private.recent_mfa()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      select bool_or(
        case
          when jsonb_typeof(e -> 'timestamp') = 'number'
            then to_timestamp((e ->> 'timestamp')::double precision)
                 > now() - interval '15 minutes'
          else false
        end
      )
      from jsonb_array_elements(
        case
          when jsonb_typeof(auth.jwt() -> 'amr') = 'array'
            then auth.jwt() -> 'amr'
          else '[]'::jsonb
        end
      ) e
      where jsonb_typeof(e) = 'object'
        and e ->> 'method' = 'totp'
    ),
    false
  )
$$;

revoke all on function private.recent_mfa()
  from public, anon, authenticated, service_role;

-- Whether the caller may reset the target's two-factor: an admin, the target
-- an active editorial_admin other than the caller with a verified TOTP
-- factor. Definer because auth.mfa_factors is not readable by API roles.
create function private.can_reset_member_mfa(p_member_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select private.is_admin()
    and p_member_id is distinct from (select auth.uid())
    and private.is_member_active(p_member_id)
    and exists (
      select 1
      from public.members m
      where m.id = p_member_id
        and m.role = 'editorial_admin'
    )
    and exists (
      select 1
      from auth.mfa_factors f
      where f.user_id = p_member_id
        and f.factor_type = 'totp'
        and f.status = 'verified'
    )
$$;

grant execute on function private.can_reset_member_mfa(uuid) to authenticated;

create function public.reset_member_mfa(member_id uuid)
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

  if not private.recent_mfa() then
    raise exception using errcode = 'P0001', message = 'auth.step_up_required';
  end if;

  select m.id into v_target
  from public.members m
  where m.id = reset_member_mfa.member_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'members.not_found';
  end if;

  if v_target.id = v_actor then
    raise exception using errcode = 'P0001', message = 'members.reset_own_factor';
  end if;

  if not private.can_reset_member_mfa(v_target.id) then
    raise exception using errcode = 'P0001', message = 'members.stale';
  end if;

  delete from auth.mfa_factors f
  where f.user_id = v_target.id
    and f.factor_type = 'totp';

  perform private.log_activity(v_op, 'member', v_target.id, v_actor, 'mfa_reset');
end;
$$;

grant execute on function public.reset_member_mfa(uuid) to authenticated;

-- member_capabilities gains can_reset_mfa; the return type changes, so drop
-- and recreate.
drop function public.member_capabilities(uuid[]);

create function public.member_capabilities(ids uuid[])
returns table (member_id uuid, can_rename boolean, can_reset_mfa boolean)
language sql
security invoker
stable
set search_path = ''
as $$
  select m.id,
         private.can_rename_member(m.id),
         private.can_reset_member_mfa(m.id)
  from public.members m
  where m.id = any (ids)
$$;

grant execute on function public.member_capabilities(uuid[]) to authenticated;
