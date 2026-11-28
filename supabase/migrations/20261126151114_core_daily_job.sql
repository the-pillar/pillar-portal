-- core_daily_job: what the daily cron's steps need from `job_runs`, and the
-- two cleanups it runs (Story 4.3, PRD 4.5, AD-13).
--
-- - A step's row is a `job_runs` row of the same job with `step` set and
--   `run_id` pointing at the run's own row, so the admin banner can find the
--   latest run's failed step without guessing from times. A run's own row
--   (and the backup workflow's) keeps both null.
-- - `service_role` holds nothing on the table; the commands below are
--   `security definer`, empty `search_path`, and granted to `service_role`
--   only (AD-1, AD-6).

alter table public.job_runs
  add column run_id bigint references public.job_runs (id),
  add constraint job_runs_run_id_with_step
    check ((step is null) = (run_id is null));

create index job_runs_run_id_idx on public.job_runs (run_id);

-- Records one finished step of an open run. `started_at` is backdated by the
-- duration the server measured. Raises `core.job_run_not_open` for a run
-- that is missing or finished (or is itself a step row), and
-- `core.invalid_step` for a step name that isn't a lowercase slug.
create function public.record_job_step(
  run_id bigint,
  step text,
  status public.job_status,
  duration_ms integer,
  detail jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job text;
begin
  select r.job into v_job
  from public.job_runs r
  where r.id = record_job_step.run_id
    and r.finished_at is null
    and r.run_id is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'core.job_run_not_open';
  end if;

  if not coalesce(record_job_step.step ~ '^[a-z][a-z0-9_]{0,39}$', false) then
    raise exception using errcode = 'P0001', message = 'core.invalid_step';
  end if;

  insert into public.job_runs (
    job, step, run_id, status, started_at, finished_at, detail
  )
  values (
    v_job,
    record_job_step.step,
    record_job_step.run_id,
    record_job_step.status,
    now() - make_interval(secs => greatest(coalesce(record_job_step.duration_ms, 0), 0) / 1000.0),
    now(),
    record_job_step.detail
  );
end;
$$;

-- Retention (AD-13): deletes `error_events` older than 30 days, and has the
-- email slice clear its old final rows (`private.clear_old_email_rows`).
-- Idempotent. Returns the counts.
create function public.run_retention()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_errors integer;
  v_outbox integer;
begin
  delete from public.error_events e
  where e.occurred_at < now() - interval '30 days';
  get diagnostics v_errors = row_count;

  -- The email slice clears its own rows (AD-2).
  v_outbox := private.clear_old_email_rows();

  return jsonb_build_object(
    'error_events_deleted', v_errors,
    'outbox_cleared', v_outbox
  );
end;
$$;

revoke all on function
  public.record_job_step(bigint, text, public.job_status, integer, jsonb),
  public.run_retention()
from public, anon, authenticated;

grant execute on function
  public.record_job_step(bigint, text, public.job_status, integer, jsonb),
  public.run_retention()
to service_role;
