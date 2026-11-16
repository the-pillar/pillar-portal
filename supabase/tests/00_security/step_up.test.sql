-- Step-up registry (AD-22): the functions whose body calls
-- private.recent_mfa() are exactly the ones listed in step-up-commands.txt,
-- so a high-impact command can't skip the check unnoticed or ship unlisted.
-- The self-test creates a violation and asserts it is reported; the rollback
-- discards it.
--
-- `supabase test db` runs this file with pg_prove from supabase/tests, so the
-- registry path is relative to that directory.

begin;

set local role postgres;
set local search_path = "$user", public, extensions;

\set registry_txt `cat 00_security/step-up-commands.txt`

select plan(6);

create temp table expected_step_up as
select regexp_replace(btrim(line, E' \t\r'), '\s+', ' ', 'g') as line
from regexp_split_to_table(:'registry_txt', E'\n') as line
where btrim(line, E' \t\r') <> ''
  and btrim(line, E' \t\r') not like '#%';

-- Functions in any non-system schema calling recent_mfa, other than its own
-- definition.
create function pg_temp.step_up_callers()
returns setof text
language sql stable as $$
  select format('%s.%s(%s)', p.pronamespace::regnamespace, p.proname,
                oidvectortypes(p.proargtypes))
  from pg_proc p
  where p.pronamespace::regnamespace::text not in
          ('pg_catalog', 'information_schema')
    and p.pronamespace::regnamespace::text not like 'pg\_temp%'
    and p.oid <> 'private.recent_mfa()'::regprocedure
    and p.prosrc ~* 'private\.recent_mfa\s*\(\)'
$$;

select isnt(
  (select count(*) from expected_step_up), 0::bigint,
  'the registry file was read and lists at least one command');

select is(
  (select coalesce(array_agg(c order by c), '{}') from (
     select c from pg_temp.step_up_callers() c
     except select line from expected_step_up) d),
  '{}'::text[], 'no function calls recent_mfa without being listed');

select is(
  (select coalesce(array_agg(line order by line), '{}') from (
     select line from expected_step_up
     except select c from pg_temp.step_up_callers() c) d),
  '{}'::text[], 'every listed function exists and calls recent_mfa');

-- The listed functions refuse without a fresh code: the check and its raise.
create function pg_temp.step_up_non_refusers()
returns setof text
language sql stable as $$
  select c
  from pg_temp.step_up_callers() c
  where not exists (
    select 1
    from pg_proc p
    where format('%s.%s(%s)', p.pronamespace::regnamespace, p.proname,
                 oidvectortypes(p.proargtypes)) = c
      and p.prosrc ~* $re$if\s+not\s+private\.recent_mfa\s*\(\s*\)\s+then\s+raise\s+exception\s+using\s+errcode\s*=\s*'P0001'\s*,\s*message\s*=\s*'auth\.step_up_required'$re$
  )
$$;

select is(
  (select coalesce(array_agg(c order by c), '{}') from pg_temp.step_up_non_refusers() c),
  '{}'::text[], 'every function calling recent_mfa raises auth.step_up_required without it');

-- Self-test: an unlisted caller is reported.
create function public.zz_unlisted_step_up()
returns boolean language sql as $$ select private.recent_mfa() $$;

select is(
  (select coalesce(array_agg(c order by c), '{}') from (
     select c from pg_temp.step_up_callers() c
     except select line from expected_step_up) d),
  array['public.zz_unlisted_step_up()'],
  'self-test: an unlisted function calling recent_mfa is reported');

create function public.zz_no_raise()
returns boolean language plpgsql as $$
begin
  if private.recent_mfa() then return true; end if;
  return false;
end $$;

select is(
  (select coalesce(array_agg(c order by c), '{}') from pg_temp.step_up_non_refusers() c),
  array['public.zz_no_raise()', 'public.zz_unlisted_step_up()'],
  'self-test: callers that do not raise step_up_required are reported');

select * from finish();
rollback;
