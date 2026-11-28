-- members_shared_session_sweep: the daily cron's sweep of the shared-computer
-- session rows (Story 4.3, AD-22). The members slice owns the table, so the
-- command lives here.

-- Deletes the shared-computer session rows idle for over 24 hours (AD-22) and
-- returns how many. An expired session (30 minutes) already reads as expired
-- until then; this only removes the row.
create function public.sweep_shared_sessions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from private.shared_sessions s
  where s.last_activity_at < now() - interval '24 hours';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.sweep_shared_sessions()
from public, anon, authenticated;

grant execute on function public.sweep_shared_sessions() to service_role;
