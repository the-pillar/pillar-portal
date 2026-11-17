-- Reference links (Story 8.14, AD-24): the link predicates and their shared
-- vectors, the list column and its CHECKs, the backfill, the sync trigger, and
-- the list overloads of create_task and update_task beside the single-link
-- ones. The vectors in link-vectors.json are also read by Story 8.15's Vitest.
--
-- Fixtures are inserted directly as `postgres` and rolled back, so the test
-- doesn't depend on seed.sql and runs on staging (`test db --linked`).

begin;

-- See responses_and_moves.test.sql: run as `postgres` with `extensions` on the
-- path, whichever role `supabase test db --linked` connected as.
set local role postgres;
set local search_path = "$user", public, extensions;

-- Relative to supabase/tests, like catalog.test.sql's grants file. If `cat`
-- fails psql leaves this empty and the `::jsonb` cast below fails loudly; the
-- count check guards a file that parses but holds too few vectors.
\set vectors_json `cat tasks/link-vectors.json`

select plan(93);

create temp table link_vectors as
select (e ->> 'url') as url,
       (e ->> 'pad_to')::int as pad_to,
       (e ->> 'valid')::boolean as valid,
       (e ->> 'why') as why
from jsonb_array_elements(:'vectors_json'::jsonb -> 'vectors') as e;

select ok((select count(*) from link_vectors) > 50,
  'the link vectors file loaded');

-- Fixtures.

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

-- Fixture tasks were last updated on Oct 1, with the old single-link column
-- only (the sync trigger turns it into the list).
create function pg_temp.new_task(p_id uuid)
returns void
language sql as $$
  insert into public.tasks (
    id, title, description, owning_section_id, owning_desk_id, due_at,
    reference_url, "column", created_by, created_at, updated_at, moved_at
  )
  values (p_id, 'Fixture task ' || p_id, 'Fixture description', null,
          'layout', '2026-11-01T00:00:00+08', 'https://example.com/fixture',
          'to_do', '00000000-0000-4000-a000-000000000004',
          '2026-10-01T00:00:00+08', '2026-10-01T00:00:00+08',
          '2026-10-01T00:00:00+08');
  insert into public.task_assignments (task_id, member_id, role, state,
                                       updated_at)
  values (p_id, '00000000-0000-4000-a000-000000000002', 'layout_artist',
          'on_it', '2026-10-01T00:00:00+08')
$$;

-- A fixture task holding the given list (inserted with it, so its version
-- stays Oct 1: an update to the same value would stamp a new one).
create function pg_temp.new_linked_task(p_id uuid, p_links text[])
returns void
language plpgsql as $$
begin
  perform pg_temp.new_task(p_id);
  alter table public.tasks disable trigger tasks_stamp_row;
  update public.tasks
  set reference_urls = p_links, updated_at = '2026-10-01T00:00:00+08'
  where id = p_id;
  alter table public.tasks enable trigger tasks_stamp_row;
end;
$$;

create function pg_temp.slot(p_id uuid, p_role text, p_member uuid)
returns jsonb
language sql as $$
  select jsonb_build_object(
    'id', p_id, 'role', p_role, 'member_id', p_member,
    'loaded_member_id',
    (select a.member_id from public.task_assignments a where a.id = p_id))
$$;

create function pg_temp.loaded_slots(p_task uuid)
returns jsonb
language sql as $$
  select coalesce(
    jsonb_agg(pg_temp.slot(a.id, a.role::text, a.member_id)
              order by a.created_at, a.id),
    '[]'::jsonb
  )
  from public.task_assignments a
  where a.task_id = p_task
$$;

delete from public.member_positions where position = 'editor_in_chief';

-- a01 pending, a02 staff layout artist, a03 staff writer, a04 head layout
-- artist (the approver), a10 managing editor (admin), a13 a deactivated
-- former managing editor, a15 a declined applicant.
select pg_temp.new_member('00000000-0000-4000-a000-000000000001', 'rl-pending@example.com', null);
select pg_temp.new_member('00000000-0000-4000-a000-000000000002', 'rl-assignee@example.com', 'staff_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-000000000003', 'rl-staff@example.com', 'staff_writer');
select pg_temp.new_member('00000000-0000-4000-a000-000000000004', 'rl-head-layout@example.com', 'head_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-000000000010', 'rl-admin@example.com', 'managing_editor');
select pg_temp.new_member('00000000-0000-4000-a000-000000000013', 'rl-former-admin@example.com', 'managing_editor');
update public.members set deactivated_at = now()
where id = '00000000-0000-4000-a000-000000000013';
select pg_temp.new_member('00000000-0000-4000-a000-000000000015', 'rl-declined@example.com', null);
update public.members set declined_at = now()
where id = '00000000-0000-4000-a000-000000000015';

-- The backfill, first: rows made with the CHECK dropped and the sync trigger
-- off, as they stood before this migration. r01 has only `reference_url` (its
-- `updated_*` are by a04), r02 has no link, r03 already has a two-link list.
alter table public.tasks drop constraint tasks_reference_url_is_link_1;
alter table public.tasks disable trigger tasks_sync_reference_urls;

select set_config('request.jwt.claims',
  jsonb_build_object('sub', '00000000-0000-4000-a000-000000000004',
                     'role', 'authenticated')::text, true);
insert into public.tasks (id, title, owning_desk_id, due_at, reference_url,
                          created_by, updated_at)
values ('00000000-0000-4000-b000-0000000000e1', 'Backfill one', 'layout',
        '2026-11-01T00:00:00+08', 'https://example.com/old',
        '00000000-0000-4000-a000-000000000004', '2026-10-01T00:00:00+08'),
       ('00000000-0000-4000-b000-0000000000e2', 'Backfill none', 'layout',
        '2026-11-01T00:00:00+08', null,
        '00000000-0000-4000-a000-000000000004', '2026-10-01T00:00:00+08');
insert into public.tasks (id, title, owning_desk_id, due_at, reference_url,
                          reference_urls, created_by, updated_at)
values ('00000000-0000-4000-b000-0000000000e3', 'Backfill listed', 'layout',
        '2026-11-01T00:00:00+08', 'https://example.com/a',
        array['https://example.com/a', 'https://example.com/b'],
        '00000000-0000-4000-a000-000000000004', '2026-10-01T00:00:00+08');

select set_config('request.jwt.claims',
  jsonb_build_object('sub', '00000000-0000-4000-a000-000000000010',
                     'role', 'authenticated')::text, true);
select private.backfill_reference_urls();

select results_eq(
  $$ select t.reference_urls, t.reference_url, t.updated_at, t.updated_by
     from public.tasks t
     where t.id = '00000000-0000-4000-b000-0000000000e1' $$,
  $$ values (array['https://example.com/old'], 'https://example.com/old',
             '2026-10-01T00:00:00+08'::timestamptz,
             '00000000-0000-4000-a000-000000000004'::uuid) $$,
  'the backfill sets the one-link list and leaves updated_at and updated_by alone');
select results_eq(
  $$ select t.reference_urls, t.reference_url
     from public.tasks t where t.id = '00000000-0000-4000-b000-0000000000e2' $$,
  $$ values ('{}'::text[], null::text) $$,
  'the backfill leaves a task without a link at the empty list');
select results_eq(
  $$ select t.reference_urls
     from public.tasks t where t.id = '00000000-0000-4000-b000-0000000000e3' $$,
  $$ values (array['https://example.com/a', 'https://example.com/b']) $$,
  'the backfill leaves a task that already has a list alone');
select is(
  (select tgenabled from pg_trigger
   where tgname = 'tasks_stamp_row' and tgrelid = 'public.tasks'::regclass),
  'O'::"char",
  'the backfill leaves tasks_stamp_row enabled');

-- Back to how the migration leaves the table.
alter table public.tasks enable trigger tasks_sync_reference_urls;
alter table public.tasks
  add constraint tasks_reference_url_is_link_1
  check (reference_url is not distinct from reference_urls[1]);

-- Tasks. b01-b03 are untouched fixtures; the rest are named where used.
select pg_temp.new_task('00000000-0000-4000-b000-000000000001');

-- Pins.

select ok(
  (select count(*) = 1
     and bool_and(not p.prosecdef
                  and p.provolatile = 'i'
                  and not p.proisstrict
                  and p.proowner = 'postgres'::regrole
                  and p.proconfig = array['search_path=""']
                  and p.prolang = (select oid from pg_language where lanname = 'sql')
                  and not has_function_privilege('anon', p.oid, 'execute')
                  and not has_function_privilege('authenticated', p.oid, 'execute')
                  and not has_function_privilege('service_role', p.oid, 'execute'))
   from pg_proc p
   where p.oid = 'private.is_valid_link(text)'::regprocedure),
  'private.is_valid_link is sql, immutable, not strict, not definer, owned by postgres, search_path empty, no grant');
select ok(
  (select count(*) = 1
     and bool_and(not p.prosecdef
                  and p.provolatile = 'i'
                  and not p.proisstrict
                  and p.proowner = 'postgres'::regrole
                  and p.proconfig = array['search_path=""']
                  and p.prolang = (select oid from pg_language where lanname = 'sql')
                  and not has_function_privilege('anon', p.oid, 'execute')
                  and not has_function_privilege('authenticated', p.oid, 'execute')
                  and not has_function_privilege('service_role', p.oid, 'execute'))
   from pg_proc p
   where p.oid = 'private.is_valid_link_list(text[])'::regprocedure),
  'private.is_valid_link_list is sql, immutable, not strict, not definer, owned by postgres, search_path empty, no grant');
select ok(
  (select count(*) = 1
     and bool_and(not p.prosecdef
                  and p.proowner = 'postgres'::regrole
                  and p.proconfig = array['search_path=""']
                  and p.prolang = (select oid from pg_language where lanname = 'plpgsql')
                  and not has_function_privilege('anon', p.oid, 'execute')
                  and not has_function_privilege('authenticated', p.oid, 'execute')
                  and not has_function_privilege('service_role', p.oid, 'execute'))
   from pg_proc p
   where p.oid = 'private.backfill_reference_urls()'::regprocedure),
  'private.backfill_reference_urls is plpgsql, not definer, owned by postgres, search_path empty, no grant');
select ok(
  (select count(*) = 1
     and bool_and(not p.prosecdef
                  and p.proowner = 'postgres'::regrole
                  and p.proconfig = array['search_path=""']
                  and p.prolang = (select oid from pg_language where lanname = 'plpgsql')
                  and not has_function_privilege('anon', p.oid, 'execute')
                  and not has_function_privilege('authenticated', p.oid, 'execute')
                  and not has_function_privilege('service_role', p.oid, 'execute'))
   from pg_proc p
   where p.oid = 'private.sync_reference_urls()'::regprocedure),
  'private.sync_reference_urls is plpgsql, not definer, owned by postgres, search_path empty, no grant');
select has_trigger('public', 'tasks', 'tasks_sync_reference_urls',
  'tasks has the sync trigger');
select ok(
  (select t.tgtype & 1 = 1 and t.tgtype & 2 = 2 and t.tgtype & 4 = 4
          and t.tgtype & 16 = 16 and t.tgtype & 8 = 0
   from pg_trigger t
   where t.tgname = 'tasks_sync_reference_urls'
     and t.tgrelid = 'public.tasks'::regclass),
  'the sync trigger is BEFORE INSERT OR UPDATE FOR EACH ROW');

select is_definer('public', 'create_task',
  array['text', 'text', 'text', 'text', 'timestamp with time zone', 'text[]', 'jsonb'],
  'the list create_task is security definer');
select function_owner_is('public', 'create_task',
  array['text', 'text', 'text', 'text', 'timestamp with time zone', 'text[]', 'jsonb'], 'postgres',
  'the list create_task is owned by postgres');
select is(
  (select p.proconfig from pg_proc p
   where p.oid = 'public.create_task(text, text, text, text, timestamptz, text[], jsonb)'::regprocedure),
  array['search_path=""'],
  'the list create_task sets search_path = ''''');
select ok(
  has_function_privilege('authenticated',
    'public.create_task(text, text, text, text, timestamptz, text[], jsonb)'::regprocedure, 'execute')
  and not has_function_privilege('anon',
    'public.create_task(text, text, text, text, timestamptz, text[], jsonb)'::regprocedure, 'execute')
  and not has_function_privilege('service_role',
    'public.create_task(text, text, text, text, timestamptz, text[], jsonb)'::regprocedure, 'execute'),
  'the list create_task is granted to authenticated only');

select is_definer('public', 'update_task',
  array['uuid', 'text', 'text', 'timestamp with time zone', 'text[]', 'jsonb'],
  'the list update_task is security definer');
select function_owner_is('public', 'update_task',
  array['uuid', 'text', 'text', 'timestamp with time zone', 'text[]', 'jsonb'], 'postgres',
  'the list update_task is owned by postgres');
select is(
  (select p.proconfig from pg_proc p
   where p.oid = 'public.update_task(uuid, text, text, timestamptz, text[], jsonb)'::regprocedure),
  array['search_path=""'],
  'the list update_task sets search_path = ''''');
select ok(
  has_function_privilege('authenticated',
    'public.update_task(uuid, text, text, timestamptz, text[], jsonb)'::regprocedure, 'execute')
  and not has_function_privilege('anon',
    'public.update_task(uuid, text, text, timestamptz, text[], jsonb)'::regprocedure, 'execute')
  and not has_function_privilege('service_role',
    'public.update_task(uuid, text, text, timestamptz, text[], jsonb)'::regprocedure, 'execute'),
  'the list update_task is granted to authenticated only');

select ok(
  not exists (
    select 1 from pg_proc p
    where p.oid in (
      'public.create_task(text, text, text, text, timestamptz, text[], jsonb)'::regprocedure,
      'public.update_task(uuid, text, text, timestamptz, text[], jsonb)'::regprocedure)
      and p.prosrc ~ '\mreference_url\M'),
  'neither list overload names reference_url');

create temp table list_update_def as
select pg_get_functiondef(
  'public.update_task(uuid, text, text, timestamptz, text[], jsonb)'::regprocedure
) as def;

select ok(
  (select def from list_update_def)
    ~* 'select\s+coalesce\(array_agg\(l\.id\),\s*''\{\}''\)\s+into\s+v_locked_slots\s+from\s*\(\s*select\s+a\.id\s+from\s+public\.task_assignments\s+a\s+where\s+a\.task_id\s*=\s*update_task\.task_id\s+order\s+by\s+a\.id\s+for\s+update\s*\)\s*as\s+l\s*;\s*select\s+t\.\*\s+into\s+v_task\s+from\s+public\.tasks\s+t\s+where\s+t\.id\s*=\s*update_task\.task_id\s+and\s+t\.deleted_at\s+is\s+null\s+for\s+update\s*;'
    and (select count(*) from regexp_matches(
           (select def from list_update_def), 'for\s+update', 'gi')) = 2,
  'the list update_task locks every slot of the task (in id order), then the live task, and nothing else');
select ok(
  (select strpos(def, 'from public.tasks t') < strpos(def, '<> all (v_locked_slots)')
      and strpos(def, '<> all (v_locked_slots)') < strpos(def, 'update public.tasks t')
      and strpos(def, '<> all (v_locked_slots)') < strpos(def, 'set constraints')
   from list_update_def),
  'the list update_task checks for an unlocked slot after the task lock and before any write');
select ok(
  (select strpos(def, 'auth.not_active') < strpos(def, 'tasks.invalid_links')
      and strpos(def, 'tasks.invalid_links') < strpos(def, 'for update')
   from list_update_def),
  'the list update_task checks the list right after auth.not_active, before any lock');

create temp table list_create_def as
select pg_get_functiondef(
  'public.create_task(text, text, text, text, timestamptz, text[], jsonb)'::regprocedure
) as def;
select ok(
  (select strpos(def, 'auth.not_active') < strpos(def, 'tasks.invalid_links')
      and strpos(def, 'tasks.invalid_links') < strpos(def, 'tasks.not_admin')
   from list_create_def),
  'the list create_task checks the list right after auth.not_active');

-- The vectors.

select is(
  (select coalesce(string_agg(v.why, '; '), '')
   from link_vectors v
   where private.is_valid_link(
           case when v.pad_to is null then v.url else rpad(v.url, v.pad_to, 'a') end)
         is distinct from v.valid),
  '',
  'is_valid_link agrees with every vector');
select is(
  (select coalesce(string_agg(v.why, '; '), '')
   from link_vectors v
   where private.is_valid_link_list(array[
           case when v.pad_to is null then v.url else rpad(v.url, v.pad_to, 'a') end])
         is distinct from v.valid),
  '',
  'is_valid_link_list of one element agrees with every vector');
select is(private.is_valid_link(null), false, 'is_valid_link(null) is false, not null');

-- The list rules.

select is(private.is_valid_link_list('{}'::text[]), true, 'the empty list is valid');
select is(private.is_valid_link_list(null::text[]), false, 'a null list is invalid');
select is(private.is_valid_link_list(array[
  'https://a.example', 'https://b.example', 'https://c.example',
  'https://d.example', 'https://e.example']), true, 'five links are valid');
select is(private.is_valid_link_list(array[
  'https://a.example', 'https://b.example', 'https://c.example',
  'https://d.example', 'https://e.example', 'https://f.example']), false,
  'six links are invalid');
select is(private.is_valid_link_list(
  array[['https://a.example'], ['https://b.example']]), false,
  'a nested array is invalid');
select is(private.is_valid_link_list(
  '[0:0]={https://a.example}'::text[]), false,
  'an array with lower bound 0 is invalid');
select is(private.is_valid_link_list(
  array['https://a.example', null]), false,
  'a null element is invalid');
select is(private.is_valid_link_list(
  array['https://a.example', 'https://a.example']), true,
  'duplicates are not refused');

-- The sync trigger, directly as postgres.

insert into public.tasks (id, title, owning_desk_id, due_at, reference_url,
                          created_by)
values ('00000000-0000-4000-b000-0000000000f1', 'Sync 1', 'layout',
        '2026-11-01T00:00:00+08', 'https://example.com/one',
        '00000000-0000-4000-a000-000000000004');
select results_eq(
  $$ select reference_urls, reference_url from public.tasks
     where id = '00000000-0000-4000-b000-0000000000f1' $$,
  $$ values (array['https://example.com/one'], 'https://example.com/one') $$,
  'an insert with only reference_url becomes a one-link list');

insert into public.tasks (id, title, owning_desk_id, due_at, reference_urls,
                          created_by)
values ('00000000-0000-4000-b000-0000000000f2', 'Sync 2', 'layout',
        '2026-11-01T00:00:00+08',
        array['https://example.com/a', 'https://example.com/b'],
        '00000000-0000-4000-a000-000000000004');
select results_eq(
  $$ select reference_urls, reference_url from public.tasks
     where id = '00000000-0000-4000-b000-0000000000f2' $$,
  $$ values (array['https://example.com/a', 'https://example.com/b'],
             'https://example.com/a') $$,
  'an insert with only a list sets reference_url to link 1');

insert into public.tasks (id, title, owning_desk_id, due_at, reference_url,
                          reference_urls, created_by)
values ('00000000-0000-4000-b000-0000000000f3', 'Sync 3', 'layout',
        '2026-11-01T00:00:00+08', 'https://example.com/x',
        array['https://example.com/a', 'https://example.com/b'],
        '00000000-0000-4000-a000-000000000004');
select results_eq(
  $$ select reference_urls, reference_url from public.tasks
     where id = '00000000-0000-4000-b000-0000000000f3' $$,
  $$ values (array['https://example.com/a', 'https://example.com/b'],
             'https://example.com/a') $$,
  'an insert with both lets the list win');

insert into public.tasks (id, title, owning_desk_id, due_at, created_by)
values ('00000000-0000-4000-b000-0000000000f4', 'Sync 4', 'layout',
        '2026-11-01T00:00:00+08', '00000000-0000-4000-a000-000000000004');
select results_eq(
  $$ select reference_urls, reference_url from public.tasks
     where id = '00000000-0000-4000-b000-0000000000f4' $$,
  $$ values ('{}'::text[], null::text) $$,
  'an insert with neither is the empty list and null');

update public.tasks
set reference_urls = array['https://example.com/n1', 'https://example.com/n2',
                           'https://example.com/n3']
where id = '00000000-0000-4000-b000-0000000000f4';
select results_eq(
  $$ select reference_urls, reference_url from public.tasks
     where id = '00000000-0000-4000-b000-0000000000f4' $$,
  $$ values (array['https://example.com/n1', 'https://example.com/n2',
                   'https://example.com/n3'], 'https://example.com/n1') $$,
  'a changed list sets reference_url to link 1');

update public.tasks set reference_url = 'https://example.com/new'
where id = '00000000-0000-4000-b000-0000000000f4';
select results_eq(
  $$ select reference_urls, reference_url from public.tasks
     where id = '00000000-0000-4000-b000-0000000000f4' $$,
  $$ values (array['https://example.com/new', 'https://example.com/n2',
                   'https://example.com/n3'], 'https://example.com/new') $$,
  'a changed reference_url replaces link 1 and keeps links 2 and 3');

update public.tasks set reference_url = null
where id = '00000000-0000-4000-b000-0000000000f4';
select results_eq(
  $$ select reference_urls, reference_url from public.tasks
     where id = '00000000-0000-4000-b000-0000000000f4' $$,
  $$ values (array['https://example.com/n2', 'https://example.com/n3'],
             'https://example.com/n2') $$,
  'a null reference_url removes link 1 and keeps the rest');

update public.tasks
set reference_urls = '{}', reference_url = 'https://example.com/again'
where id = '00000000-0000-4000-b000-0000000000f4';
select results_eq(
  $$ select reference_urls, reference_url from public.tasks
     where id = '00000000-0000-4000-b000-0000000000f4' $$,
  $$ values ('{}'::text[], null::text) $$,
  'when the list and reference_url both change, the list wins');

update public.tasks set reference_url = 'https://example.com/solo'
where id = '00000000-0000-4000-b000-0000000000f4';
select results_eq(
  $$ select reference_urls, reference_url from public.tasks
     where id = '00000000-0000-4000-b000-0000000000f4' $$,
  $$ values (array['https://example.com/solo'], 'https://example.com/solo') $$,
  'a new reference_url on an empty list becomes the list');

update public.tasks set reference_url = null
where id = '00000000-0000-4000-b000-0000000000f4';
select results_eq(
  $$ select reference_urls, reference_url from public.tasks
     where id = '00000000-0000-4000-b000-0000000000f4' $$,
  $$ values ('{}'::text[], null::text) $$,
  'a null reference_url on a one-link list empties it');

select throws_ok(
  $$ update public.tasks set reference_urls = array[
       'https://a.example', 'https://b.example', 'https://c.example',
       'https://d.example', 'https://e.example', 'https://f.example']
     where id = '00000000-0000-4000-b000-0000000000f4' $$,
  '23514', null,
  'the CHECK refuses six links written straight to the table');
select throws_ok(
  $$ update public.tasks set reference_urls = null
     where id = '00000000-0000-4000-b000-0000000000f4' $$,
  '23502', null,
  'the column refuses a null list');

-- Callers.

create function pg_temp.as_caller(p_caller uuid)
returns void
language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_caller, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;
end;
$$;

create function pg_temp.create_list_as(p_caller uuid, p_links text[])
returns uuid
language plpgsql as $$
declare
  v uuid;
begin
  perform pg_temp.as_caller(p_caller);
  select public.create_task('New', null, null, 'layout',
    '2026-11-01T00:00:00+08', p_links,
    '[{"member_id":"00000000-0000-4000-a000-000000000002","role":"layout_artist"}]')
  into v;
  set local role postgres;
  return v;
end;
$$;

create function pg_temp.create_old_as(p_caller uuid, p_url text)
returns uuid
language plpgsql as $$
declare
  v uuid;
begin
  perform pg_temp.as_caller(p_caller);
  select public.create_task('New', null, null, 'layout',
    '2026-11-01T00:00:00+08', p_url,
    '[{"member_id":"00000000-0000-4000-a000-000000000002","role":"layout_artist"}]')
  into v;
  set local role postgres;
  return v;
end;
$$;

-- Both edits resend the task's stored text, due date and slots, so only the
-- link argument differs from what is stored.
create function pg_temp.update_list_as(p_caller uuid, p_task uuid, p_links text[])
returns boolean
language plpgsql as $$
declare
  t public.tasks%rowtype;
  v_slots jsonb := pg_temp.loaded_slots(p_task);
  v boolean;
begin
  select * into t from public.tasks where id = p_task;
  perform pg_temp.as_caller(p_caller);
  select public.update_task(p_task, t.title, t.description, t.due_at,
                            p_links, v_slots) into v;
  set local role postgres;
  return v;
end;
$$;

create function pg_temp.update_old_as(p_caller uuid, p_task uuid, p_url text)
returns boolean
language plpgsql as $$
declare
  t public.tasks%rowtype;
  v_slots jsonb := pg_temp.loaded_slots(p_task);
  v boolean;
begin
  select * into t from public.tasks where id = p_task;
  perform pg_temp.as_caller(p_caller);
  select public.update_task(p_task, t.title, t.description, t.due_at,
                            p_url, v_slots) into v;
  set local role postgres;
  return v;
end;
$$;

create function pg_temp.links_of(p_task uuid)
returns table (reference_urls text[], reference_url text)
language sql as $$
  select t.reference_urls, t.reference_url from public.tasks t where t.id = p_task
$$;

create function pg_temp.updated_count(p_task uuid)
returns bigint
language sql as $$
  select count(*) from public.activity a
  where a.entity_type = 'task' and a.entity_id = p_task and a.action = 'updated'
$$;

-- Refused lists on create_task: every refused vector (padded as the file says)
-- and the list shapes that no single element covers. Counts the calls that
-- raised tasks.invalid_links, and the tasks written.
create function pg_temp.refused_create_count(p_lists text[][])
returns int
language plpgsql as $$
declare
  v_raised int := 0;
  v_list text[];
begin
  foreach v_list slice 1 in array p_lists loop
    begin
      perform pg_temp.create_list_as('00000000-0000-4000-a000-000000000010', v_list);
    exception when others then
      set local role postgres;
      if sqlerrm = 'tasks.invalid_links' then
        v_raised := v_raised + 1;
      end if;
    end;
  end loop;
  return v_raised;
end;
$$;

create temp table tasks_before as select count(*) as n from public.tasks;

select is(
  (select count(*) from link_vectors v where not v.valid),
  (select pg_temp.refused_create_count(coalesce(array_agg(array[
      case when v.pad_to is null then v.url else rpad(v.url, v.pad_to, 'a') end]), '{}'))
   from link_vectors v where not v.valid and v.url is not null)
  + (select count(*) from link_vectors v where not v.valid and v.url is null),
  'create_task raises tasks.invalid_links for every refused non-null vector');
select is((select count(*) from public.tasks), (select n from tasks_before),
  'no refused vector wrote a task');

select throws_ok(
  $$ select pg_temp.create_list_as('00000000-0000-4000-a000-000000000010', array[
       'https://a.example', 'https://b.example', 'https://c.example',
       'https://d.example', 'https://e.example', 'https://f.example']) $$,
  'P0001', 'tasks.invalid_links', 'create_task refuses six links');
select throws_ok(
  $$ select pg_temp.create_list_as('00000000-0000-4000-a000-000000000010', null::text[]) $$,
  'P0001', 'tasks.invalid_links', 'create_task refuses a null list');
select throws_ok(
  $$ select pg_temp.create_list_as('00000000-0000-4000-a000-000000000010',
       array[['https://a.example'], ['https://b.example']]) $$,
  'P0001', 'tasks.invalid_links', 'create_task refuses a nested array');
select throws_ok(
  $$ select pg_temp.create_list_as('00000000-0000-4000-a000-000000000010',
       '[0:0]={https://a.example}'::text[]) $$,
  'P0001', 'tasks.invalid_links', 'create_task refuses an array with lower bound 0');
select throws_ok(
  $$ select pg_temp.create_list_as('00000000-0000-4000-a000-000000000010',
       array['https://a.example', null]) $$,
  'P0001', 'tasks.invalid_links', 'create_task refuses a null element');
select throws_ok(
  $$ select pg_temp.create_list_as('00000000-0000-4000-a000-000000000010', array['']) $$,
  'P0001', 'tasks.invalid_links', 'create_task refuses an empty string');
select throws_ok(
  $$ select pg_temp.create_list_as('00000000-0000-4000-a000-000000000010',
       array['ftp://a.example']) $$,
  'P0001', 'tasks.invalid_links', 'create_task refuses ftp://');

-- Save 0, 1 and 5 links.
create temp table created_links as
select pg_temp.create_list_as('00000000-0000-4000-a000-000000000010', '{}'::text[]) as zero,
       pg_temp.create_list_as('00000000-0000-4000-a000-000000000010',
         array['https://a.example/1']) as one,
       pg_temp.create_list_as('00000000-0000-4000-a000-000000000010', array[
         'https://e.example/5', 'https://b.example/2', 'https://c.example/3',
         'https://d.example/4', 'https://a.example/1']) as five;

select results_eq(
  $$ select * from pg_temp.links_of((select zero from created_links)) $$,
  $$ values ('{}'::text[], null::text) $$,
  'create_task saves no links: the empty list and a null reference_url');
select results_eq(
  $$ select * from pg_temp.links_of((select one from created_links)) $$,
  $$ values (array['https://a.example/1'], 'https://a.example/1') $$,
  'create_task saves one link');
select results_eq(
  $$ select * from pg_temp.links_of((select five from created_links)) $$,
  $$ values (array['https://e.example/5', 'https://b.example/2', 'https://c.example/3',
                   'https://d.example/4', 'https://a.example/1'],
             'https://e.example/5') $$,
  'create_task saves five links in the order given, reference_url being link 1');

-- Old create_task: reference_url only.
create temp table created_old as
select pg_temp.create_old_as('00000000-0000-4000-a000-000000000010',
         'https://old.example/x') as one,
       pg_temp.create_old_as('00000000-0000-4000-a000-000000000010', null) as none;
select results_eq(
  $$ select * from pg_temp.links_of((select one from created_old)) $$,
  $$ values (array['https://old.example/x'], 'https://old.example/x') $$,
  'the single-link create_task stores its link as a one-link list');
select results_eq(
  $$ select * from pg_temp.links_of((select none from created_old)) $$,
  $$ values ('{}'::text[], null::text) $$,
  'the single-link create_task with no link stores the empty list');
select results_eq(
  $$ select * from pg_temp.links_of('00000000-0000-4000-b000-000000000001') $$,
  $$ values (array['https://example.com/fixture'], 'https://example.com/fixture') $$,
  'a fixture inserted with reference_url only has it as its one link');

-- Four callers on the list create_task.
select throws_ok(
  $$ select pg_temp.create_list_as('00000000-0000-4000-a000-000000000001', array['']) $$,
  'P0001', 'auth.not_active', 'list create_task refuses a pending caller, invalid list or not');
select throws_ok(
  $$ select pg_temp.create_list_as('00000000-0000-4000-a000-000000000015', array['']) $$,
  'P0001', 'auth.not_active', 'list create_task refuses a declined caller');
select throws_ok(
  $$ select pg_temp.create_list_as('00000000-0000-4000-a000-000000000013', array['']) $$,
  'P0001', 'auth.not_active', 'list create_task refuses a deactivated former admin');
select throws_ok(
  $$ select pg_temp.create_list_as('00000000-0000-4000-a000-000000000003',
       array['https://a.example']) $$,
  'P0001', 'tasks.not_admin', 'list create_task refuses active staff');
select throws_ok(
  $$ select pg_temp.create_old_as('00000000-0000-4000-a000-000000000001', 'https://a.example') $$,
  'P0001', 'auth.not_active', 'single-link create_task still refuses a pending caller');
select throws_ok(
  $$ select pg_temp.create_old_as('00000000-0000-4000-a000-000000000003', 'https://a.example') $$,
  'P0001', 'tasks.not_admin', 'single-link create_task still refuses active staff');

-- Edits on the list update_task. d1 holds three links; d2 the same, to
-- compare an untouched write; d3 three links for the reorder.
select pg_temp.new_linked_task('00000000-0000-4000-d000-000000000001',
  array['https://l.example/1', 'https://l.example/2', 'https://l.example/3']);
select pg_temp.new_linked_task('00000000-0000-4000-d000-000000000002',
  array['https://l.example/1', 'https://l.example/2', 'https://l.example/3']);
select pg_temp.new_linked_task('00000000-0000-4000-d000-000000000003',
  array['https://l.example/1', 'https://l.example/2', 'https://l.example/3']);
select pg_temp.new_linked_task('00000000-0000-4000-d000-000000000004',
  array['https://l.example/1', 'https://l.example/2']);

-- Link 2 alone changes.
select pg_temp.update_list_as('00000000-0000-4000-a000-000000000004',
  '00000000-0000-4000-d000-000000000001',
  array['https://l.example/1', 'https://l.example/two', 'https://l.example/3']);
select results_eq(
  $$ select * from pg_temp.links_of('00000000-0000-4000-d000-000000000001') $$,
  $$ values (array['https://l.example/1', 'https://l.example/two', 'https://l.example/3'],
             'https://l.example/1') $$,
  'a change to link 2 alone is saved');
select ok(
  (select updated_at > '2026-10-01T00:00:00+08'
          and updated_by = '00000000-0000-4000-a000-000000000004'
   from public.tasks where id = '00000000-0000-4000-d000-000000000001')
  and pg_temp.updated_count('00000000-0000-4000-d000-000000000001') = 1,
  'a change to link 2 alone bumps updated_at, stamps updated_by and logs updated');

-- Order alone changes.
select pg_temp.update_list_as('00000000-0000-4000-a000-000000000004',
  '00000000-0000-4000-d000-000000000003',
  array['https://l.example/3', 'https://l.example/2', 'https://l.example/1']);
select results_eq(
  $$ select * from pg_temp.links_of('00000000-0000-4000-d000-000000000003') $$,
  $$ values (array['https://l.example/3', 'https://l.example/2', 'https://l.example/1'],
             'https://l.example/3') $$,
  'a change of order alone is saved and reference_url follows link 1');
select ok(
  (select updated_at > '2026-10-01T00:00:00+08'
   from public.tasks where id = '00000000-0000-4000-d000-000000000003')
  and pg_temp.updated_count('00000000-0000-4000-d000-000000000003') = 1,
  'a change of order alone bumps updated_at and logs updated');

-- Same list, same fields.
select is(
  pg_temp.update_list_as('00000000-0000-4000-a000-000000000004',
    '00000000-0000-4000-d000-000000000002',
    array['https://l.example/1', 'https://l.example/2', 'https://l.example/3']),
  false, 'the same list and fields returns false');
select ok(
  (select updated_at = '2026-10-01T00:00:00+08'
   from public.tasks where id = '00000000-0000-4000-d000-000000000002')
  and pg_temp.updated_count('00000000-0000-4000-d000-000000000002') = 0,
  'the same list and fields writes nothing and logs nothing');

-- Clearing and invalid lists.
select pg_temp.update_list_as('00000000-0000-4000-a000-000000000004',
  '00000000-0000-4000-d000-000000000004', '{}'::text[]);
select results_eq(
  $$ select * from pg_temp.links_of('00000000-0000-4000-d000-000000000004') $$,
  $$ values ('{}'::text[], null::text) $$,
  'the list update_task saves no links');
select throws_ok(
  $$ select pg_temp.update_list_as('00000000-0000-4000-a000-000000000004',
       '00000000-0000-4000-d000-000000000002', array[
       'https://a.example', 'https://b.example', 'https://c.example',
       'https://d.example', 'https://e.example', 'https://f.example']) $$,
  'P0001', 'tasks.invalid_links', 'the list update_task refuses six links');
select throws_ok(
  $$ select pg_temp.update_list_as('00000000-0000-4000-a000-000000000004',
       '00000000-0000-4000-d000-000000000002', null::text[]) $$,
  'P0001', 'tasks.invalid_links', 'the list update_task refuses a null list');
select throws_ok(
  $$ select pg_temp.update_list_as('00000000-0000-4000-a000-000000000004',
       '00000000-0000-4000-d000-000000000002', array['https://a.example', null]) $$,
  'P0001', 'tasks.invalid_links', 'the list update_task refuses a null element');
select throws_ok(
  $$ select pg_temp.update_list_as('00000000-0000-4000-a000-000000000004',
       '00000000-0000-4000-d000-000000000002',
       array[['https://a.example'], ['https://b.example']]) $$,
  'P0001', 'tasks.invalid_links', 'the list update_task refuses a nested array');
select throws_ok(
  $$ select pg_temp.update_list_as('00000000-0000-4000-a000-000000000004',
       '00000000-0000-4000-d000-000000000002', '[0:0]={https://a.example}'::text[]) $$,
  'P0001', 'tasks.invalid_links', 'the list update_task refuses lower bound 0');
select throws_ok(
  $$ select pg_temp.update_list_as('00000000-0000-4000-a000-000000000004',
       '00000000-0000-4000-d000-000000000002', array['ftp://a.example']) $$,
  'P0001', 'tasks.invalid_links', 'the list update_task refuses ftp://');
select throws_ok(
  $$ select pg_temp.update_list_as('00000000-0000-4000-a000-000000000004',
       '00000000-0000-4000-d000-000000000002', array['https://a.example/ b']) $$,
  'P0001', 'tasks.invalid_links', 'the list update_task refuses a space inside a link');
select results_eq(
  $$ select * from pg_temp.links_of('00000000-0000-4000-d000-000000000002') $$,
  $$ values (array['https://l.example/1', 'https://l.example/2', 'https://l.example/3'],
             'https://l.example/1') $$,
  'no refused list wrote anything');

-- Four callers on the list update_task.
select throws_ok(
  $$ select pg_temp.update_list_as('00000000-0000-4000-a000-000000000001',
       '00000000-0000-4000-d000-000000000002', array['']) $$,
  'P0001', 'auth.not_active', 'list update_task refuses a pending caller');
select throws_ok(
  $$ select pg_temp.update_list_as('00000000-0000-4000-a000-000000000015',
       '00000000-0000-4000-d000-000000000002', array['']) $$,
  'P0001', 'auth.not_active', 'list update_task refuses a declined caller');
select throws_ok(
  $$ select pg_temp.update_list_as('00000000-0000-4000-a000-000000000013',
       '00000000-0000-4000-d000-000000000002', array['']) $$,
  'P0001', 'auth.not_active', 'list update_task refuses a deactivated former admin');
select throws_ok(
  $$ select pg_temp.update_list_as('00000000-0000-4000-a000-000000000003',
       '00000000-0000-4000-d000-000000000002', array['https://a.example']) $$,
  'P0001', 'tasks.not_approver', 'list update_task refuses active staff');

-- The single-link update_task on a three-link task.
select pg_temp.new_linked_task('00000000-0000-4000-d000-000000000011',
  array['https://l.example/1', 'https://l.example/2', 'https://l.example/3']);
select pg_temp.new_linked_task('00000000-0000-4000-d000-000000000012',
  array['https://l.example/1', 'https://l.example/2', 'https://l.example/3']);
select pg_temp.new_linked_task('00000000-0000-4000-d000-000000000013',
  array['https://l.example/1', 'https://l.example/2', 'https://l.example/3']);

select is(
  pg_temp.update_old_as('00000000-0000-4000-a000-000000000004',
    '00000000-0000-4000-d000-000000000011', 'https://l.example/1'),
  false, 'an old edit leaving reference_url unchanged saves nothing');
select results_eq(
  $$ select * from pg_temp.links_of('00000000-0000-4000-d000-000000000011') $$,
  $$ values (array['https://l.example/1', 'https://l.example/2', 'https://l.example/3'],
             'https://l.example/1') $$,
  'an old edit with reference_url unchanged keeps all three links');

select pg_temp.update_old_as('00000000-0000-4000-a000-000000000004',
  '00000000-0000-4000-d000-000000000012', 'https://l.example/new');
select results_eq(
  $$ select * from pg_temp.links_of('00000000-0000-4000-d000-000000000012') $$,
  $$ values (array['https://l.example/new', 'https://l.example/2', 'https://l.example/3'],
             'https://l.example/new') $$,
  'an old edit with a new reference_url replaces link 1 and keeps links 2 and 3');
select ok(pg_temp.updated_count('00000000-0000-4000-d000-000000000012') = 1,
  'an old edit with a new reference_url logs updated');

select pg_temp.update_old_as('00000000-0000-4000-a000-000000000004',
  '00000000-0000-4000-d000-000000000013', null);
select results_eq(
  $$ select * from pg_temp.links_of('00000000-0000-4000-d000-000000000013') $$,
  $$ values (array['https://l.example/2', 'https://l.example/3'],
             'https://l.example/2') $$,
  'an old edit with a null reference_url removes link 1 and keeps links 2 and 3');

-- The list update_task and the single-link one both stay callable.
select is(
  (select count(*) from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('create_task', 'update_task')),
  4::bigint,
  'create_task and update_task each have the single-link and list overloads');

select * from finish();

rollback;
