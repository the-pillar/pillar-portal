-- One pending-member helper (Story 8.1): `private.is_member_pending(uuid)` is
-- the only definition of "pending" (role `pending`, neither declined_at nor
-- deactivated_at set), pinned like `private.is_member_active` but granted to
-- no role. Checked against the former predicate for every member in the
-- database (seeded or not) plus a fixture per state, an unknown id and null.
-- Everything is rolled back; it runs locally and on staging.

begin;

set local role postgres;
set local search_path = "$user", public, extensions;

select plan(15);

-- b..11 pending, 12 declined, 13 deactivated pending, 14 deactivated Head
-- Layout Artist, 15 active Staff Writer.
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-b000-000000000011',
   'authenticated', 'authenticated', 'pending-fixture@pending-helper.test',
   '{"name": "Pending Fixture"}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-b000-000000000012',
   'authenticated', 'authenticated', 'declined-fixture@pending-helper.test',
   '{"name": "Declined Fixture"}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-b000-000000000013',
   'authenticated', 'authenticated', 'deactivated-pending@pending-helper.test',
   '{"name": "Deactivated Pending Fixture"}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-b000-000000000014',
   'authenticated', 'authenticated', 'deactivated-fixture@pending-helper.test',
   '{"name": "Deactivated Fixture"}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-b000-000000000015',
   'authenticated', 'authenticated', 'active-fixture@pending-helper.test',
   '{"name": "Active Fixture"}');

insert into public.member_positions (member_id, position, is_primary) values
  ('00000000-0000-4000-b000-000000000014', 'head_layout_artist', true),
  ('00000000-0000-4000-b000-000000000015', 'staff_writer', true);

update public.members set declined_at = now()
where id = '00000000-0000-4000-b000-000000000012';
update public.members set deactivated_at = now()
where id in ('00000000-0000-4000-b000-000000000013',
             '00000000-0000-4000-b000-000000000014');

select is(
  (select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""']
     and pg_get_userbyid(p.proowner) = 'postgres'
   from pg_proc p where p.oid = 'private.is_member_pending(uuid)'::regprocedure),
  true,
  'is_member_pending is security definer, stable, owned by postgres, empty search_path'
);

select is(
  (select not has_function_privilege('authenticated', 'private.is_member_pending(uuid)', 'execute')
      and not has_function_privilege('anon', 'private.is_member_pending(uuid)', 'execute')
      and not has_function_privilege('service_role', 'private.is_member_pending(uuid)', 'execute')),
  true,
  'is_member_pending is granted to no API role'
);

select is(
  private.is_member_pending('00000000-0000-4000-b000-000000000011'),
  true,
  'a pending member is pending'
);

select is(
  private.is_member_pending('00000000-0000-4000-b000-000000000012'),
  false,
  'a declined member is not pending'
);

select is(
  private.is_member_pending('00000000-0000-4000-b000-000000000013'),
  false,
  'a deactivated pending member is not pending'
);

select is(
  private.is_member_pending('00000000-0000-4000-b000-000000000014'),
  false,
  'a deactivated member is not pending'
);

select is(
  private.is_member_pending('00000000-0000-4000-b000-000000000015'),
  false,
  'an active member is not pending'
);

select is(private.is_member_pending(gen_random_uuid()), false, 'an unknown id is not pending');
select is(private.is_member_pending(null), false, 'a null id is not pending');

select is(
  (select count(*) from public.members m
   where private.is_member_pending(m.id) is distinct from (
     m.role = 'pending' and m.declined_at is null and m.deactivated_at is null
   )),
  0::bigint,
  'the helper equals the former pending predicate for every member'
);

select is(
  (select count(distinct private.is_member_pending(m.id)) from public.members m),
  2::bigint,
  'the members include both a pending and a not-pending one'
);

select is(
  (select count(*) from public.members m
   where private.is_member_pending(m.id) and private.is_member_active(m.id)),
  0::bigint,
  'no member is both active and pending'
);

select is(
  (select count(*) from public.members m
   where not private.is_member_pending(m.id)
     and not private.is_member_active(m.id)
     and m.declined_at is null and m.deactivated_at is null),
  0::bigint,
  'a member with neither timestamp is active or pending'
);

select is(
  (select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)
   from pg_proc p
   where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
     and p.prosrc ~ 'role\s*(=|<>|!=)\s*''pending'''),
  array['private.is_member_active(uuid)', 'private.is_member_pending(uuid)'],
  'only the two helpers restate the pending role check'
);

select is(
  (select count(*) from pg_proc p
   where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
     and p.proname in ('approve_member', 'decline_member', 'bootstrap_admin')
     and p.prosrc like '%private.is_member_pending(%'),
  3::bigint,
  'approve_member, decline_member and bootstrap_admin call the helper'
);

select * from finish();
rollback;
