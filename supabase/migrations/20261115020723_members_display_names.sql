-- members_display_names: admins fix display names (Story 8.2, PRD 1.10).
--
-- Google names arrive as given (all caps, nicknames). `members.google_name`
-- keeps what Google sent, written only by the sign-up trigger and the
-- backfill below; `name` is what the portal shows, which an admin can change
-- with `set_member_name`. Names are capped at 100 characters from here on
-- (the sign-up trigger and the command); `members_name_length` still allows
-- 200 and is not tightened here.
--
-- `member_capabilities(ids)` is the roster's source of offered actions
-- (AD-4), starting with `can_rename`; it and `set_member_name` share
-- `private.can_rename_member`, so what is offered is what the command
-- accepts.

-- Trim, cut to 100 characters, trim again (the cut can land on a space), and
-- null when nothing is left. No grant: only definer functions and the owner
-- call it.
create function private.clean_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      left(
        regexp_replace(p_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'),
        100
      ),
      '^[[:space:]]+|[[:space:]]+$', '', 'g'
    ),
    ''
  )
$$;

revoke all on function private.clean_name(text)
  from public, anon, authenticated, service_role;

alter table public.members
  add column google_name text
    constraint members_google_name_length
      check (char_length(google_name) between 1 and 100);

-- The sign-up trigger: names capped at 100, and the Google name kept.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(new.email));
  v_avatar text := new.raw_user_meta_data ->> 'avatar_url';
  v_google text := coalesce(
    private.clean_name(new.raw_user_meta_data ->> 'full_name'),
    private.clean_name(new.raw_user_meta_data ->> 'name')
  );
begin
  insert into public.members (id, name, google_name, avatar_url, email)
  values (
    new.id,
    coalesce(
      v_google,
      private.clean_name(split_part(v_email, '@', 1)),
      'Member'
    ),
    v_google,
    case
      when v_avatar ~ '^https?://\S+$' and char_length(v_avatar) <= 100
        then v_avatar
    end,
    v_email
  );
  return new;
end;
$$;

-- One-time: cut names over 100 characters, and fill google_name the way the
-- trigger derives it.
update public.members m
set name = private.clean_name(m.name)
where char_length(m.name) > 100;

update public.members m
set google_name = coalesce(
  private.clean_name(u.raw_user_meta_data ->> 'full_name'),
  private.clean_name(u.raw_user_meta_data ->> 'name')
)
from auth.users u
where u.id = m.id;

-- Who may be renamed, by whom: an admin, and a pending or active target.
-- Definer because is_member_pending is granted to no role.
create function private.can_rename_member(p_member_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select private.is_admin()
    and (
      private.is_member_pending(p_member_id)
      or private.is_member_active(p_member_id)
    )
$$;

grant execute on function private.can_rename_member(uuid) to authenticated;

create function public.set_member_name(member_id uuid, name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_member_id();
  v_op uuid := gen_random_uuid();
  v_name text := regexp_replace(
    set_member_name.name, '^[[:space:]]+|[[:space:]]+$', '', 'g'
  );
  v_target record;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'auth.not_active';
  end if;

  if not private.is_admin() then
    raise exception using errcode = 'P0001', message = 'members.not_admin';
  end if;

  if v_name is null or v_name = '' then
    raise exception using errcode = 'P0001', message = 'members.name_blank';
  end if;

  if char_length(v_name) > 100 then
    raise exception using errcode = 'P0001', message = 'members.name_too_long';
  end if;

  select m.id into v_target
  from public.members m
  where m.id = set_member_name.member_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'members.not_found';
  end if;

  if not private.can_rename_member(v_target.id) then
    raise exception using errcode = 'P0001', message = 'members.stale';
  end if;

  update public.members m
  set name = v_name,
      updated_at = now(),
      updated_by = v_actor
  where m.id = v_target.id;

  perform private.log_activity(v_op, 'member', v_target.id, v_actor, 'renamed');

  return v_name;
end;
$$;

grant execute on function public.set_member_name(uuid, text) to authenticated;

-- What the caller may do with each listed member. Runs with the caller's
-- rights, so RLS picks the rows: an admin sees every member, anyone else
-- only their own, with nothing allowed.
create function public.member_capabilities(ids uuid[])
returns table (member_id uuid, can_rename boolean)
language sql
security invoker
stable
set search_path = ''
as $$
  select m.id, private.can_rename_member(m.id)
  from public.members m
  where m.id = any (ids)
$$;

grant execute on function public.member_capabilities(uuid[]) to authenticated;
