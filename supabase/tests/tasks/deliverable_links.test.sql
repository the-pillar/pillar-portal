-- Deliverable links (Story 8.16, AD-25): the table and its read, the slot
-- edge, add_deliverable_links, remove_deliverable_link, the three new
-- task_capabilities fields, and the update_task refusal of removing a slot
-- that holds links (both overloads).
--
-- Fixtures are inserted directly as `postgres` and rolled back, so the test
-- doesn't depend on seed.sql and runs on staging (`test db --linked`).

begin;

-- See responses_and_moves.test.sql: run as `postgres` with `extensions` on the
-- path, whichever role `supabase test db --linked` connected as.
set local role postgres;
set local search_path = "$user", public, extensions;

select plan(99);

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

-- A Done task carries done_at (tasks_done_at_matches_column).
create function pg_temp.new_task(p_id uuid, p_column public.task_column)
returns void
language sql as $$
  insert into public.tasks (
    id, title, owning_section_id, owning_desk_id, due_at, "column", done_at
  )
  values (p_id, 'Fixture task ' || p_id, null, 'layout',
          '2026-11-01T00:00:00+08', p_column,
          case when p_column = 'done' then now() end)
$$;

-- Slots are created a minute apart, in call order, so slot order is known.
create function pg_temp.new_slot(
  p_id uuid,
  p_task uuid,
  p_member uuid,
  p_role public.production_role,
  p_state public.slot_state
)
returns void
language sql as $$
  insert into public.task_assignments (id, task_id, member_id, role, state,
                                       created_at)
  values (p_id, p_task, p_member, p_role, p_state,
          '2026-10-01T00:00:00+08'::timestamptz
            + (select count(*) from public.task_assignments) * interval '1 minute')
$$;

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

create function pg_temp.add_as(p_caller uuid, p_slot uuid, p_urls text[])
returns void
language plpgsql as $$
begin
  perform pg_temp.as_caller(p_caller);
  perform public.add_deliverable_links(p_slot, p_urls);
  set local role postgres;
end;
$$;

create function pg_temp.remove_as(p_caller uuid, p_link uuid)
returns boolean
language plpgsql as $$
declare
  v boolean;
begin
  perform pg_temp.as_caller(p_caller);
  select public.remove_deliverable_link(p_link) into v;
  set local role postgres;
  return v;
end;
$$;

-- How many link rows the caller reads (RLS applies).
create function pg_temp.read_count_as(p_caller uuid)
returns bigint
language plpgsql as $$
declare
  v bigint;
begin
  perform pg_temp.as_caller(p_caller);
  select count(*) into v from public.task_deliverable_links;
  set local role postgres;
  return v;
end;
$$;

create function pg_temp.caps_as(p_caller uuid, p_task uuid)
returns table (add_slots uuid[], remove_slots uuid[], can_remove boolean)
language plpgsql as $$
begin
  perform pg_temp.as_caller(p_caller);
  return query
    select k.deliverable_add_slot_ids, k.deliverable_remove_slot_ids,
           k.can_remove_deliverables
    from public.task_capabilities(array[p_task]) k;
  set local role postgres;
end;
$$;

create function pg_temp.urls_of(p_slot uuid)
returns text[]
language sql as $$
  select coalesce(array_agg(l.url order by l.seq), '{}')
  from public.task_deliverable_links l
  where l.slot_id = p_slot
$$;

create function pg_temp.link_id(p_slot uuid, p_url text)
returns uuid
language sql as $$
  select l.id from public.task_deliverable_links l
  where l.slot_id = p_slot and l.url = p_url
  order by l.seq limit 1
$$;

create function pg_temp.activity_n(p_task uuid, p_action text)
returns bigint
language sql as $$
  select count(*) from public.activity a
  where a.entity_type = 'task' and a.entity_id = p_task and a.action = p_action
$$;

-- A fingerprint of every slot row, to show the commands never write one.
create function pg_temp.slots_digest()
returns text
language sql as $$
  select coalesce(md5(string_agg(a::text, '|' order by a.id)), '')
  from public.task_assignments a
$$;

create function pg_temp.slot_json(p_id uuid, p_role text, p_member uuid)
returns jsonb
language sql as $$
  select jsonb_build_object(
    'id', p_id, 'role', p_role, 'member_id', p_member,
    'loaded_member_id',
    (select a.member_id from public.task_assignments a where a.id = p_id))
$$;

-- The task's slots as the form loaded them, leaving out up to two.
create function pg_temp.slots_without(p_task uuid, p_left_out uuid, p_left_out_2 uuid default null)
returns jsonb
language sql as $$
  select coalesce(
    jsonb_agg(pg_temp.slot_json(a.id, a.role::text, a.member_id)
              order by a.created_at, a.id),
    '[]'::jsonb
  )
  from public.task_assignments a
  where a.task_id = p_task
    and a.id <> p_left_out
    and a.id is distinct from p_left_out_2
$$;

create function pg_temp.update_old_as(p_caller uuid, p_task uuid, p_slots jsonb)
returns boolean
language plpgsql as $$
declare
  t public.tasks%rowtype;
  v boolean;
begin
  select * into t from public.tasks where id = p_task;
  perform pg_temp.as_caller(p_caller);
  select public.update_task(p_task, t.title, t.description, t.due_at,
                            t.reference_url, p_slots) into v;
  set local role postgres;
  return v;
end;
$$;

create function pg_temp.update_list_as(p_caller uuid, p_task uuid, p_slots jsonb)
returns boolean
language plpgsql as $$
declare
  t public.tasks%rowtype;
  v boolean;
begin
  select * into t from public.tasks where id = p_task;
  perform pg_temp.as_caller(p_caller);
  select public.update_task(p_task, t.title, t.description, t.due_at,
                            t.reference_urls, p_slots) into v;
  set local role postgres;
  return v;
end;
$$;

-- The message and detail of the error a statement raises, as one string.
create function pg_temp.error_of(p_sql text)
returns text
language plpgsql as $$
declare
  v_detail text;
begin
  begin
    execute p_sql;
    return 'no error';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    set local role postgres;
    return sqlerrm || ' ' || coalesce(v_detail, '');
  end;
end;
$$;

create function pg_temp.add_error(p_slot uuid, p_urls text[])
returns text
language sql as $$
  select pg_temp.error_of(format(
    'select pg_temp.add_as(%L, %L, %L)',
    '00000000-0000-4000-a000-000000000002', p_slot, p_urls))
$$;

delete from public.member_positions where position = 'editor_in_chief';

-- a01 pending, a02 staff layout artist (the holder), a03 staff writer,
-- a04 head layout artist (the approver), a13 a deactivated former managing
-- editor, a15 a declined applicant.
select pg_temp.new_member('00000000-0000-4000-a000-000000000001', 'dl-pending@example.com', null);
select pg_temp.new_member('00000000-0000-4000-a000-000000000002', 'dl-holder@example.com', 'staff_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-000000000003', 'dl-staff@example.com', 'staff_writer');
select pg_temp.new_member('00000000-0000-4000-a000-000000000004', 'dl-head-layout@example.com', 'head_layout_artist');
select pg_temp.new_member('00000000-0000-4000-a000-000000000013', 'dl-former-admin@example.com', 'managing_editor');
update public.members set deactivated_at = now()
where id = '00000000-0000-4000-a000-000000000013';
select pg_temp.new_member('00000000-0000-4000-a000-000000000015', 'dl-declined@example.com', null);
update public.members set declined_at = now()
where id = '00000000-0000-4000-a000-000000000015';

-- T1 Doing: c1, c6 and c7 are a02's on_it slots, c2 waits for a03, c3 was
-- handed back by a03. T2 is Done with a02's on_it slot c4. T3 is To Do with
-- c5, deleted later.
select pg_temp.new_task('00000000-0000-4000-b000-000000000001', 'doing');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000003', 'writer', 'awaiting_response');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000003', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000003', 'cartoonist', 'needs_reassignment');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000006', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002', 'photojournalist', 'on_it');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000007', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002', 'broadcast_journalist', 'on_it');
select pg_temp.new_task('00000000-0000-4000-b000-000000000002', 'done');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000004', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');
select pg_temp.new_task('00000000-0000-4000-b000-000000000003', 'to_do');
select pg_temp.new_slot('00000000-0000-4000-c000-000000000005', '00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000002', 'layout_artist', 'on_it');

-- Pins.

select is(
  (select string_agg(
            concat_ws(',', p.proname, p.prosecdef, p.provolatile,
                      p.proowner = 'postgres'::regrole,
                      p.proconfig = array['search_path=""']),
            ' ' order by p.proname)
   from pg_proc p
   where p.oid in ('private.can_edit_deliverables(uuid)'::regprocedure,
                   'public.add_deliverable_links(uuid, text[])'::regprocedure,
                   'public.remove_deliverable_link(uuid)'::regprocedure)),
  'add_deliverable_links,t,v,t,t can_edit_deliverables,t,s,t,t remove_deliverable_link,t,v,t,t',
  'the three functions are security definer, owned by postgres, search_path empty; the edge is stable'
);

select ok(
  has_function_privilege('authenticated', 'private.can_edit_deliverables(uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.add_deliverable_links(uuid, text[])', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.remove_deliverable_link(uuid)', 'EXECUTE'),
  'authenticated may execute the three functions'
);
select ok(
  not has_function_privilege('anon', 'private.can_edit_deliverables(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.add_deliverable_links(uuid, text[])', 'EXECUTE')
    and not has_function_privilege('anon', 'public.remove_deliverable_link(uuid)', 'EXECUTE')
    and not has_function_privilege('service_role', 'private.can_edit_deliverables(uuid)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.add_deliverable_links(uuid, text[])', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.remove_deliverable_link(uuid)', 'EXECUTE'),
  'anon and service_role may execute none of them'
);

select ok(
  pg_get_functiondef('public.add_deliverable_links(uuid, text[])'::regprocedure)
    ~* 'from\s+public\.task_assignments\s+a\s+where\s+a\.id\s*=\s*add_deliverable_links\.slot_id\s+for\s+update\s*;.*and\s+t\.deleted_at\s+is\s+null\s+for\s+update\s+of\s+t\s*;.*private\.can_edit_deliverables\('
    and (select count(*) from regexp_matches(
           pg_get_functiondef('public.add_deliverable_links(uuid, text[])'::regprocedure),
           'can_edit_deliverables\(', 'g')) = 1,
  'add_deliverable_links locks the slot FOR UPDATE, then its live task, before checking can_edit_deliverables'
);
select ok(
  pg_get_functiondef('public.remove_deliverable_link(uuid)'::regprocedure)
    ~* 'for\s+update\s*;.*and\s+t\.deleted_at\s+is\s+null\s+for\s+update\s+of\s+t\s*;.*private\.can_edit_deliverables\(.*private\.is_task_approver\(.*delete\s+from\s+public\.task_deliverable_links'
    and pg_get_functiondef('public.remove_deliverable_link(uuid)'::regprocedure)
      !~* 'task_deliverable_links\s+l\s+where[^;]*for\s+update',
  'remove_deliverable_link locks the slot, then its live task, before the edge and the approver, and never locks a link row'
);
select ok(
  (select position('is_valid_link_list' in d) < position('for update' in d)
   from (select pg_get_functiondef('public.add_deliverable_links(uuid, text[])'::regprocedure) as d) f),
  'add_deliverable_links checks the list before it locks anything'
);

select ok(
  not has_table_privilege('service_role', 'public.task_deliverable_links', 'SELECT')
    and not has_table_privilege('service_role', 'public.task_deliverable_links', 'INSERT')
    and not has_table_privilege('service_role', 'public.task_deliverable_links', 'UPDATE')
    and not has_table_privilege('service_role', 'public.task_deliverable_links', 'DELETE')
    and not has_table_privilege('service_role', 'public.task_deliverable_links', 'TRUNCATE')
    and not has_sequence_privilege('service_role', 'public.task_deliverable_links_seq_seq', 'USAGE')
    and not has_sequence_privilege('service_role', 'public.task_deliverable_links_seq_seq', 'SELECT'),
  'service_role has no privilege on the table or its identity sequence'
);
select ok(
  has_table_privilege('authenticated', 'public.task_deliverable_links', 'SELECT')
    and not has_table_privilege('authenticated', 'public.task_deliverable_links', 'INSERT')
    and not has_table_privilege('authenticated', 'public.task_deliverable_links', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.task_deliverable_links', 'DELETE')
    and not has_table_privilege('anon', 'public.task_deliverable_links', 'SELECT'),
  'authenticated may only read the table, anon not at all'
);
select ok(
  (select c.relrowsecurity from pg_class c where c.oid = 'public.task_deliverable_links'::regclass)
    and (select count(*) from pg_policies
         where schemaname = 'public' and tablename = 'task_deliverable_links') = 1,
  'row level security is on with one policy'
);
select ok(
  exists (
    select 1 from pg_constraint c
    where c.conname = 'task_deliverable_links_url_valid'
      and c.conrelid = 'public.task_deliverable_links'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~ 'is_valid_link'
  ),
  'task_deliverable_links_url_valid is a CHECK on private.is_valid_link'
);
select is(
  (select c.confdeltype::text from pg_constraint c
   where c.conrelid = 'public.task_deliverable_links'::regclass
     and c.confrelid = 'public.task_assignments'::regclass),
  'r',
  'the slot foreign key is on delete restrict'
);
select ok(
  exists (
    select 1 from pg_index i
    where i.indrelid = 'public.task_deliverable_links'::regclass
      and i.indkey[0] = (select a.attnum from pg_attribute a
                         where a.attrelid = 'public.task_deliverable_links'::regclass
                           and a.attname = 'slot_id')
  )
  and (select a.attidentity::text from pg_attribute a
       where a.attrelid = 'public.task_deliverable_links'::regclass
         and a.attname = 'seq') = 'a',
  'slot_id is indexed and seq is generated always as identity'
);
select ok(
  exists (select 1 from pg_publication_tables
          where pubname = 'supabase_realtime'
            and schemaname = 'public' and tablename = 'task_deliverable_links'),
  'the table is in the Realtime publication'
);
select throws_ok(
  $$ insert into public.task_deliverable_links (slot_id, url, added_by)
     values ('00000000-0000-4000-c000-000000000001', 'ftp://a.example',
             '00000000-0000-4000-a000-000000000002') $$,
  '23514', null,
  'the CHECK refuses a link that isn''t http(s) written straight to the table');

-- A holder adds three links to a Doing task, in paste order.

select pg_temp.add_as('00000000-0000-4000-a000-000000000002',
  '00000000-0000-4000-c000-000000000001',
  array['https://l.example/3', 'https://l.example/1', 'https://l.example/2']);
select is(
  pg_temp.urls_of('00000000-0000-4000-c000-000000000001'),
  array['https://l.example/3', 'https://l.example/1', 'https://l.example/2'],
  'a holder''s three links read back in the order pasted');
select is(
  (select count(*) from public.task_deliverable_links l
   where l.slot_id = '00000000-0000-4000-c000-000000000001'
     and l.added_by = '00000000-0000-4000-a000-000000000002'),
  3::bigint,
  'each link is added by the caller');
select is(pg_temp.activity_n('00000000-0000-4000-b000-000000000001', 'deliverable_added'),
  1::bigint, 'one call logs one deliverable_added row on the task');
select ok(
  not exists (select 1 from public.activity a
              where a.action like 'deliverable\_%' and a.entity_type <> 'task'),
  'deliverable activity is logged on the task, never the slot or a link');

-- Done task: the holder still adds.
select pg_temp.add_as('00000000-0000-4000-a000-000000000002',
  '00000000-0000-4000-c000-000000000004', array['https://done.example/1']);
select is(pg_temp.urls_of('00000000-0000-4000-c000-000000000004'),
  array['https://done.example/1'], 'a holder adds a link on a Done task');

-- The slot rows from here on.
create temp table slots_before as select pg_temp.slots_digest() as d;

-- Not the edge, and not the holder.
select throws_ok(
  $$ select pg_temp.add_as('00000000-0000-4000-a000-000000000003',
       '00000000-0000-4000-c000-000000000002', array['https://x.example']) $$,
  'P0001', 'tasks.not_allowed', 'an awaiting_response slot''s holder can''t add');
select throws_ok(
  $$ select pg_temp.add_as('00000000-0000-4000-a000-000000000003',
       '00000000-0000-4000-c000-000000000003', array['https://x.example']) $$,
  'P0001', 'tasks.not_allowed', 'a needs_reassignment slot''s holder can''t add');
select throws_ok(
  $$ select pg_temp.add_as('00000000-0000-4000-a000-000000000003',
       '00000000-0000-4000-c000-000000000001', array['https://x.example']) $$,
  'P0001', 'tasks.not_allowed', 'another slot''s holder can''t add');
select throws_ok(
  $$ select pg_temp.add_as('00000000-0000-4000-a000-000000000004',
       '00000000-0000-4000-c000-000000000001', array['https://x.example']) $$,
  'P0001', 'tasks.not_allowed', 'the approver can''t add');

-- Not found.
select throws_ok(
  $$ select pg_temp.add_as('00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-c000-0000000000ff', array['https://x.example']) $$,
  'P0001', 'tasks.not_found', 'an unknown slot is not found');

-- Callers who aren't active: the list isn't even looked at.
select throws_ok(
  $$ select pg_temp.add_as('00000000-0000-4000-a000-000000000001',
       '00000000-0000-4000-c000-000000000001', null) $$,
  'P0001', 'auth.not_active', 'a pending caller is refused by add');
select throws_ok(
  $$ select pg_temp.add_as('00000000-0000-4000-a000-000000000015',
       '00000000-0000-4000-c000-000000000001', array['https://x.example']) $$,
  'P0001', 'auth.not_active', 'a declined caller is refused by add');
select throws_ok(
  $$ select pg_temp.add_as('00000000-0000-4000-a000-000000000013',
       '00000000-0000-4000-c000-000000000001', array['https://x.example']) $$,
  'P0001', 'auth.not_active', 'a deactivated former admin is refused by add');

-- Bad lists: invalid_links with reason link, before any read (the slot id is
-- unknown, so a read would have said not_found).
select is(pg_temp.add_error('00000000-0000-4000-c000-0000000000ff', null),
  'tasks.invalid_links {"reason": "link"}', 'a null list is refused as link');
select is(pg_temp.add_error('00000000-0000-4000-c000-0000000000ff', '{}'),
  'tasks.invalid_links {"reason": "link"}', 'an empty list is refused as link');
select is(pg_temp.add_error('00000000-0000-4000-c000-0000000000ff',
    array[['https://a.example'], ['https://b.example']]),
  'tasks.invalid_links {"reason": "link"}', 'a nested list is refused as link');
select is(pg_temp.add_error('00000000-0000-4000-c000-0000000000ff',
    '[0:0]={https://a.example}'::text[]),
  'tasks.invalid_links {"reason": "link"}', 'a list with lower bound 0 is refused as link');
select is(pg_temp.add_error('00000000-0000-4000-c000-0000000000ff',
    array['https://a.example', null]),
  'tasks.invalid_links {"reason": "link"}', 'a null element is refused as link');
select is(pg_temp.add_error('00000000-0000-4000-c000-0000000000ff', array['ftp://a.example']),
  'tasks.invalid_links {"reason": "link"}', 'ftp:// is refused as link');
select is(pg_temp.add_error('00000000-0000-4000-c000-0000000000ff', array['https://a.example/ b']),
  'tasks.invalid_links {"reason": "link"}', 'a link with a space is refused as link');
select is(pg_temp.add_error('00000000-0000-4000-c000-0000000000ff',
    array['https://1.example', 'https://2.example', 'https://3.example',
          'https://4.example', 'https://5.example', 'https://6.example']),
  'tasks.invalid_links {"reason": "link"}', 'six links in one call are refused as link');

-- The limit.
select pg_temp.add_as('00000000-0000-4000-a000-000000000002',
  '00000000-0000-4000-c000-000000000006',
  array['https://s6.example/1', 'https://s6.example/2', 'https://s6.example/3', 'https://s6.example/4']);
select is(
  pg_temp.add_error('00000000-0000-4000-c000-000000000006',
    array['https://s6.example/5', 'https://s6.example/6']),
  'tasks.invalid_links {"reason": "limit", "remaining": 1}',
  'four stored plus two is refused with remaining 1');
select is(cardinality(pg_temp.urls_of('00000000-0000-4000-c000-000000000006')), 4,
  'the refused call wrote nothing, not even the first link');
select pg_temp.add_as('00000000-0000-4000-a000-000000000002',
  '00000000-0000-4000-c000-000000000006', array['https://s6.example/5']);
select is(
  pg_temp.add_error('00000000-0000-4000-c000-000000000006', array['https://s6.example/6']),
  'tasks.invalid_links {"reason": "limit", "remaining": 0}',
  'a full slot refuses one more with remaining 0');
select is(pg_temp.activity_n('00000000-0000-4000-b000-000000000001', 'deliverable_added'),
  3::bigint, 'refused calls logged nothing (three successful calls on the task)');

select is(pg_temp.slots_digest(), (select d from slots_before),
  'no task_assignments row changed through any add');

-- Deleted task on add.
update public.tasks set deleted_at = now()
where id = '00000000-0000-4000-b000-000000000003';
select throws_ok(
  $$ select pg_temp.add_as('00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-c000-000000000005', array['https://x.example']) $$,
  'P0001', 'tasks.not_found', 'a deleted task is not found on add');
update public.tasks set deleted_at = null
where id = '00000000-0000-4000-b000-000000000003';

-- Table reads.

select is(pg_temp.read_count_as('00000000-0000-4000-a000-000000000001'), 0::bigint,
  'a pending caller reads no link');
select is(pg_temp.read_count_as('00000000-0000-4000-a000-000000000015'), 0::bigint,
  'a declined caller reads no link');
select is(pg_temp.read_count_as('00000000-0000-4000-a000-000000000013'), 0::bigint,
  'a deactivated former admin reads no link');
select is(pg_temp.read_count_as('00000000-0000-4000-a000-000000000003'),
  (select count(*) from public.task_deliverable_links), 'active staff reads every link');

insert into public.task_deliverable_links (slot_id, url, added_by)
values ('00000000-0000-4000-c000-000000000005', 'https://t3.example/1',
        '00000000-0000-4000-a000-000000000002');
update public.tasks set deleted_at = now()
where id = '00000000-0000-4000-b000-000000000003';
select is(pg_temp.read_count_as('00000000-0000-4000-a000-000000000003'),
  (select count(*) from public.task_deliverable_links) - 1,
  'a deleted task''s link is hidden from active staff');
select is(pg_temp.remove_as('00000000-0000-4000-a000-000000000002',
    pg_temp.link_id('00000000-0000-4000-c000-000000000005', 'https://t3.example/1')),
  false, 'a deleted task''s link removes to false');
select is(pg_temp.activity_n('00000000-0000-4000-b000-000000000003', 'deliverable_removed'),
  0::bigint, 'and logs nothing');
update public.tasks set deleted_at = null
where id = '00000000-0000-4000-b000-000000000003';
delete from public.task_deliverable_links
where slot_id = '00000000-0000-4000-c000-000000000005';

-- Removes.

select throws_ok(
  $$ select pg_temp.remove_as('00000000-0000-4000-a000-000000000003',
       pg_temp.link_id('00000000-0000-4000-c000-000000000001', 'https://l.example/1')) $$,
  'P0001', 'tasks.not_allowed', 'another slot''s holder can''t remove');
select throws_ok(
  $$ select pg_temp.remove_as('00000000-0000-4000-a000-000000000001',
       pg_temp.link_id('00000000-0000-4000-c000-000000000001', 'https://l.example/1')) $$,
  'P0001', 'auth.not_active', 'a pending caller can''t remove');
select throws_ok(
  $$ select pg_temp.remove_as('00000000-0000-4000-a000-000000000015',
       pg_temp.link_id('00000000-0000-4000-c000-000000000001', 'https://l.example/1')) $$,
  'P0001', 'auth.not_active', 'a declined caller can''t remove');
select throws_ok(
  $$ select pg_temp.remove_as('00000000-0000-4000-a000-000000000013',
       pg_temp.link_id('00000000-0000-4000-c000-000000000001', 'https://l.example/1')) $$,
  'P0001', 'auth.not_active', 'a deactivated former admin can''t remove');
select is(cardinality(pg_temp.urls_of('00000000-0000-4000-c000-000000000001')), 3,
  'every refused remove left the links in place');

select is(pg_temp.remove_as('00000000-0000-4000-a000-000000000002',
    pg_temp.link_id('00000000-0000-4000-c000-000000000001', 'https://l.example/1')),
  true, 'the holder removes a link');
select is(pg_temp.urls_of('00000000-0000-4000-c000-000000000001'),
  array['https://l.example/3', 'https://l.example/2'], 'the row is gone and the order stays');
select is(pg_temp.activity_n('00000000-0000-4000-b000-000000000001', 'deliverable_removed'),
  1::bigint, 'a removal logs one deliverable_removed row');
select is(pg_temp.remove_as('00000000-0000-4000-a000-000000000004',
    pg_temp.link_id('00000000-0000-4000-c000-000000000001', 'https://l.example/2')),
  true, 'the approver removes any link');
select is(pg_temp.activity_n('00000000-0000-4000-b000-000000000001', 'deliverable_removed'),
  2::bigint, 'and it logs one more row');

-- Removing twice, and an unknown id: false, no activity.
create temp table gone_link as
  select pg_temp.link_id('00000000-0000-4000-c000-000000000001', 'https://l.example/3') as id;
select is(pg_temp.remove_as('00000000-0000-4000-a000-000000000002', (select id from gone_link)),
  true, 'the holder removes the last link');
select is(pg_temp.remove_as('00000000-0000-4000-a000-000000000002', (select id from gone_link)),
  false, 'a second removal returns false');
select is(pg_temp.remove_as('00000000-0000-4000-a000-000000000002',
    '00000000-0000-4000-d000-0000000000ff'),
  false, 'an unknown link returns false');
select is(pg_temp.activity_n('00000000-0000-4000-b000-000000000001', 'deliverable_removed'),
  3::bigint, 'neither false removal logged anything');

-- A link an earlier holder added, removed by the new holder (a03 takes the
-- slot, as a reassign and an answer would leave it).
select pg_temp.add_as('00000000-0000-4000-a000-000000000002',
  '00000000-0000-4000-c000-000000000007', array['https://s7.example/1']);
update public.task_assignments
set member_id = '00000000-0000-4000-a000-000000000003'
where id = '00000000-0000-4000-c000-000000000007';
select is(pg_temp.remove_as('00000000-0000-4000-a000-000000000003',
    pg_temp.link_id('00000000-0000-4000-c000-000000000007', 'https://s7.example/1')),
  true, 'the new holder removes the earlier holder''s link');

-- A hand back stops the holder, not the approver.
select pg_temp.as_caller('00000000-0000-4000-a000-000000000002');
select public.hand_back_slot('00000000-0000-4000-c000-000000000006', null);
set local role postgres;
select is(cardinality(pg_temp.urls_of('00000000-0000-4000-c000-000000000006')), 5,
  'a hand back keeps the slot''s links');
select throws_ok(
  $$ select pg_temp.add_as('00000000-0000-4000-a000-000000000002',
       '00000000-0000-4000-c000-000000000006', array['https://x.example']) $$,
  'P0001', 'tasks.not_allowed', 'a handed-back slot''s holder can''t add');
select throws_ok(
  $$ select pg_temp.remove_as('00000000-0000-4000-a000-000000000002',
       pg_temp.link_id('00000000-0000-4000-c000-000000000006', 'https://s6.example/1')) $$,
  'P0001', 'tasks.not_allowed', 'a handed-back slot''s holder can''t remove');
select is(pg_temp.remove_as('00000000-0000-4000-a000-000000000004',
    pg_temp.link_id('00000000-0000-4000-c000-000000000006', 'https://s6.example/1')),
  true, 'the approver removes a link on a handed-back slot');

-- A reassign keeps the links and added_by.
select pg_temp.as_caller('00000000-0000-4000-a000-000000000004');
select public.reassign_slot('00000000-0000-4000-c000-000000000006',
  '00000000-0000-4000-a000-000000000003',
  (select a.updated_at from public.task_assignments a
   where a.id = '00000000-0000-4000-c000-000000000006'));
set local role postgres;
select is(pg_temp.urls_of('00000000-0000-4000-c000-000000000006'),
  array['https://s6.example/2', 'https://s6.example/3', 'https://s6.example/4', 'https://s6.example/5'],
  'a reassign keeps the slot''s links');
select is(
  (select count(*) from public.task_deliverable_links l
   where l.slot_id = '00000000-0000-4000-c000-000000000006'
     and l.added_by = '00000000-0000-4000-a000-000000000002'),
  4::bigint, 'and their added_by');
select throws_ok(
  $$ select pg_temp.add_as('00000000-0000-4000-a000-000000000003',
       '00000000-0000-4000-c000-000000000006', array['https://x.example']) $$,
  'P0001', 'tasks.not_allowed', 'the new holder can''t add until the slot is on_it again');
select is(pg_temp.remove_as('00000000-0000-4000-a000-000000000004',
    pg_temp.link_id('00000000-0000-4000-c000-000000000006', 'https://s6.example/5')),
  true, 'the approver removes a link on an awaiting_response slot');

-- An add and a remove change no slot row.
create temp table slots_pair_before as select pg_temp.slots_digest() as d;
select pg_temp.add_as('00000000-0000-4000-a000-000000000002',
  '00000000-0000-4000-c000-000000000004', array['https://done.example/2']);
select pg_temp.remove_as('00000000-0000-4000-a000-000000000004',
  pg_temp.link_id('00000000-0000-4000-c000-000000000004', 'https://done.example/2'));
select is(pg_temp.slots_digest(), (select d from slots_pair_before),
  'an add and a remove change no task_assignments row');

-- update_task, both overloads. c6 holds four links (a03 holds it).

select throws_ok(
  $$ select pg_temp.update_old_as('00000000-0000-4000-a000-000000000004',
       '00000000-0000-4000-b000-000000000001',
       pg_temp.slots_without('00000000-0000-4000-b000-000000000001',
                             '00000000-0000-4000-c000-000000000006')) $$,
  'P0001', 'tasks.slot_has_links', 'the single-link update_task refuses a slot with links left out');
select throws_ok(
  $$ select pg_temp.update_list_as('00000000-0000-4000-a000-000000000004',
       '00000000-0000-4000-b000-000000000001',
       pg_temp.slots_without('00000000-0000-4000-b000-000000000001',
                             '00000000-0000-4000-c000-000000000006')) $$,
  'P0001', 'tasks.slot_has_links', 'the list update_task refuses it too');
select is(
  pg_temp.error_of(format('select pg_temp.update_old_as(%L, %L, %L::jsonb)',
    '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-b000-000000000001',
    pg_temp.slots_without('00000000-0000-4000-b000-000000000001',
                          '00000000-0000-4000-c000-000000000006'))),
  'tasks.slot_has_links {"role": "photojournalist"}',
  'the refusal carries the slot''s role (single-link)');
select is(
  pg_temp.error_of(format('select pg_temp.update_list_as(%L, %L, %L::jsonb)',
    '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-b000-000000000001',
    pg_temp.slots_without('00000000-0000-4000-b000-000000000001',
                          '00000000-0000-4000-c000-000000000006'))),
  'tasks.slot_has_links {"role": "photojournalist"}',
  'the refusal carries the slot''s role (list)');
select is(
  pg_temp.error_of(format('select pg_temp.update_list_as(%L, %L, %L::jsonb)',
    '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-b000-000000000001',
    (select jsonb_agg(case when a.id = '00000000-0000-4000-c000-000000000006'
                           then pg_temp.slot_json(a.id, 'writer', a.member_id)
                           else pg_temp.slot_json(a.id, a.role::text, a.member_id) end
                      order by a.created_at, a.id)
     from public.task_assignments a
     where a.task_id = '00000000-0000-4000-b000-000000000001'))),
  'tasks.stale ',
  'a re-role of a slot with links raises tasks.stale, so it never reaches the removal check');

-- The first such slot in slot order names the role: c6 (photojournalist) was
-- created before c7. Give c7 a link again and leave both out.
select pg_temp.as_caller('00000000-0000-4000-a000-000000000003');
select public.respond_to_slot('00000000-0000-4000-c000-000000000006', 'on_it', null);
set local role postgres;
select pg_temp.add_as('00000000-0000-4000-a000-000000000003',
  '00000000-0000-4000-c000-000000000007', array['https://s7.example/2']);
select is(
  pg_temp.error_of(format('select pg_temp.update_list_as(%L, %L, %L::jsonb)',
    '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-b000-000000000001',
    pg_temp.slots_without('00000000-0000-4000-b000-000000000001',
                          '00000000-0000-4000-c000-000000000007',
                          '00000000-0000-4000-c000-000000000006'))),
  'tasks.slot_has_links {"role": "photojournalist"}',
  'with two such slots the first in slot order names the role');
select is(
  (select count(*) from public.task_assignments
   where task_id = '00000000-0000-4000-b000-000000000001'),
  5::bigint, 'a refused update_task removed no slot');

-- A re-role as the form sends it: c6 left out, a new row giving its member
-- another role.
create temp table rerole as
select pg_temp.slots_without('00000000-0000-4000-b000-000000000001',
                             '00000000-0000-4000-c000-000000000006')
       || jsonb_build_array(jsonb_build_object(
            'role', 'videojournalist',
            'member_id', (select a.member_id from public.task_assignments a
                          where a.id = '00000000-0000-4000-c000-000000000006')))
       as slots;
select is(
  pg_temp.error_of(format('select pg_temp.update_old_as(%L, %L, %L::jsonb)',
    '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-b000-000000000001',
    (select slots from rerole))),
  'tasks.slot_has_links {"role": "photojournalist"}',
  'a re-role sent as the form sends it is refused (single-link)');
select is(
  pg_temp.error_of(format('select pg_temp.update_list_as(%L, %L, %L::jsonb)',
    '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-b000-000000000001',
    (select slots from rerole))),
  'tasks.slot_has_links {"role": "photojournalist"}',
  'a re-role sent as the form sends it is refused (list)');

select is(
  pg_temp.update_list_as('00000000-0000-4000-a000-000000000004',
    '00000000-0000-4000-b000-000000000001',
    pg_temp.slots_without('00000000-0000-4000-b000-000000000001',
                          '00000000-0000-4000-c000-000000000002')),
  false,
  'a slot with no links (c2, awaiting_response) is still removed by update_task');
select is(
  (select count(*) from public.task_assignments
   where id = '00000000-0000-4000-c000-000000000002'),
  0::bigint, 'and it is gone');

-- task_capabilities.

select results_eq(
  $$ select p.prosecdef, p.proowner = 'postgres'::regrole,
            p.proconfig = array['search_path=""']
     from pg_proc p
     where p.oid = 'public.task_capabilities(uuid[])'::regprocedure $$,
  $$ values (false, true, true) $$,
  'task_capabilities is still security invoker, owned by postgres, search_path empty');
select ok(
  (select count(*) from regexp_matches(
     pg_get_functiondef('public.task_capabilities(uuid[])'::regprocedure),
     'is_task_approver', 'g')) = 1
    and pg_get_functiondef('public.task_capabilities(uuid[])'::regprocedure)
      ~* 'with\s+ap\s+as\s+materialized',
  'task_capabilities still names private.is_task_approver once, in the materialized CTE');

-- T1 now: c1 (a02, on_it, no links), c3 (a03, handed back), c6 (a03,
-- on_it, four links), c7 (a03, on_it, one link).
select results_eq(
  $$ select add_slots, remove_slots, can_remove
     from pg_temp.caps_as('00000000-0000-4000-a000-000000000002',
                          '00000000-0000-4000-b000-000000000001') $$,
  $$ values (array['00000000-0000-4000-c000-000000000001']::uuid[],
             array['00000000-0000-4000-c000-000000000001']::uuid[], false) $$,
  'a holder is offered their on_it slot only, and no approver power');
select results_eq(
  $$ select add_slots, remove_slots, can_remove
     from pg_temp.caps_as('00000000-0000-4000-a000-000000000003',
                          '00000000-0000-4000-b000-000000000001') $$,
  $$ values (array['00000000-0000-4000-c000-000000000006',
                   '00000000-0000-4000-c000-000000000007']::uuid[],
             array['00000000-0000-4000-c000-000000000006',
                   '00000000-0000-4000-c000-000000000007']::uuid[], false) $$,
  'another holder gets theirs in slot order, never the handed-back one');
select results_eq(
  $$ select add_slots, remove_slots, can_remove
     from pg_temp.caps_as('00000000-0000-4000-a000-000000000004',
                          '00000000-0000-4000-b000-000000000001') $$,
  $$ values ('{}'::uuid[], '{}'::uuid[], true) $$,
  'the approver removes any link but is offered no slot to add to');
select is(
  (select count(*) from pg_temp.caps_as('00000000-0000-4000-a000-000000000015',
                                        '00000000-0000-4000-b000-000000000001')),
  0::bigint, 'a declined caller gets no row');

-- Each offered slot really accepts, and one not offered refuses.
select lives_ok(
  $$ select pg_temp.add_as('00000000-0000-4000-a000-000000000003',
       '00000000-0000-4000-c000-000000000007', array['https://s7.example/3']) $$,
  'an offered slot accepts an add');
select lives_ok(
  $$ select pg_temp.remove_as('00000000-0000-4000-a000-000000000003',
       pg_temp.link_id('00000000-0000-4000-c000-000000000007', 'https://s7.example/3')) $$,
  'an offered slot accepts a remove');
select throws_ok(
  $$ select pg_temp.add_as('00000000-0000-4000-a000-000000000003',
       '00000000-0000-4000-c000-000000000003', array['https://x.example']) $$,
  'P0001', 'tasks.not_allowed', 'a slot not offered refuses an add');

-- A full slot: five links on c4, a Done task.
select pg_temp.add_as('00000000-0000-4000-a000-000000000002',
  '00000000-0000-4000-c000-000000000004',
  array['https://done.example/4', 'https://done.example/5', 'https://done.example/6',
    'https://done.example/7']);
select is(cardinality(pg_temp.urls_of('00000000-0000-4000-c000-000000000004')), 5,
  'the Done task''s slot holds five links');
select results_eq(
  $$ select add_slots, remove_slots, can_remove
     from pg_temp.caps_as('00000000-0000-4000-a000-000000000002',
                          '00000000-0000-4000-b000-000000000002') $$,
  $$ values ('{}'::uuid[],
             array['00000000-0000-4000-c000-000000000004']::uuid[], false) $$,
  'a full slot on a Done task: remove offered, add not');
select is(pg_temp.add_error('00000000-0000-4000-c000-000000000004', array['https://x.example']),
  'tasks.invalid_links {"reason": "limit", "remaining": 0}',
  'and add refuses it, as the capability said');
select results_eq(
  $$ select add_slots, remove_slots, can_remove
     from pg_temp.caps_as('00000000-0000-4000-a000-000000000004',
                          '00000000-0000-4000-b000-000000000002') $$,
  $$ values ('{}'::uuid[], '{}'::uuid[], true) $$,
  'the approver on the Done task: remove any, add none');

-- An active staff member holding no slot on either task: a05.
select pg_temp.new_member('00000000-0000-4000-a000-000000000005', 'dl-unassigned@example.com', 'staff_writer');
select throws_ok(
  $$ select pg_temp.add_as('00000000-0000-4000-a000-000000000005',
       '00000000-0000-4000-c000-000000000001', array['https://u.example/1']) $$,
  'P0001', 'tasks.not_allowed', 'an unassigned staff member can''t add');
select throws_ok(
  $$ select pg_temp.remove_as('00000000-0000-4000-a000-000000000005',
       (select l.id from public.task_deliverable_links l
        where l.slot_id = '00000000-0000-4000-c000-000000000004'
        order by l.seq limit 1)) $$,
  'P0001', 'tasks.not_allowed', 'an unassigned staff member can''t remove');
select results_eq(
  $$ select add_slots, remove_slots, can_remove
     from pg_temp.caps_as('00000000-0000-4000-a000-000000000005',
                          '00000000-0000-4000-b000-000000000002') $$,
  $$ values ('{}'::uuid[], '{}'::uuid[], false) $$,
  'an unassigned staff member is offered nothing');

select * from finish();

rollback;
