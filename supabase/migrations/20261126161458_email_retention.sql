-- email_retention: the email slice's own retention (Story 4.3, AD-2, AD-13).
--
-- Clears the address, the error code and the payload of outbox rows that are
-- final (`sent`, `failed`, `bounced`, `canceled`, `dropped`) and created over
-- 30 days ago, and returns how many. A `queued` or `sending` row is never
-- touched: its send needs its payload. Idempotent. Granted to nobody:
-- `public.run_retention` (core) calls it.
create function private.clear_old_email_rows()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.email_outbox o
  set recipient_address = null,
      error = null,
      payload = '{}'::jsonb,
      updated_at = now()
  where o.status in ('sent', 'failed', 'bounced', 'canceled', 'dropped')
    and o.created_at < now() - interval '30 days'
    and (o.recipient_address is not null
         or o.error is not null
         or o.payload <> '{}'::jsonb);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function private.clear_old_email_rows()
from public, anon, authenticated, service_role;
