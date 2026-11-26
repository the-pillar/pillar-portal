-- Quota status and bounce tracking (Story 4.2, PRD 4.5, AD-9).
--
-- - `email_quota_status` is the one source for every quota meter: it runs
--   with the caller's rights, so RLS on `email_outbox` shows an admin the
--   real counts and anyone else none. Its room math is `claim_email_batch`'s:
--   `limit_today = max(0, min(daily, monthly - attempts this month before
--   today))`. The quota's day and month are UTC (AD-12's exception).
-- - `record_email_event` is the Resend webhook's one command (service_role).
--   Each Svix id is stored once in `email_webhook_events`, so a replay changes
--   nothing, even after a later retry re-queues and re-sends the row.
-- - A bounced row keeps its `sent_at`, so the table's CHECK is replaced.

create index email_outbox_provider_message_id_idx
  on public.email_outbox (provider_message_id)
  where provider_message_id is not null;

alter table public.email_outbox
  drop constraint email_outbox_sent_at_when_sent;

alter table public.email_outbox
  add constraint email_outbox_sent_at_when_sent
    check (
      (status <> 'sent' or sent_at is not null)
      and (sent_at is null or status in ('sent', 'bounced'))
    );

create table public.email_webhook_events (
  svix_id text primary key
    constraint email_webhook_events_svix_id_format
      check (svix_id ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  event_type text not null
    constraint email_webhook_events_event_type
      check (event_type in (
        'email.bounced', 'email.complained',
        'email.suppressed', 'email.failed'
      )),
  outbox_id uuid references public.email_outbox (id) on delete cascade,
  received_at timestamptz not null default now()
);

create index email_webhook_events_outbox_idx
  on public.email_webhook_events (outbox_id);

alter table public.email_webhook_events enable row level security;

-- No policies: the table is reached only through record_email_event.
revoke all on table public.email_webhook_events
  from anon, authenticated, service_role;

-- The quota as the meter shows it, for the given limits.
--
--   provider_day  the UTC day
--   sent_today    rows attempted today
--   limit_today   max(0, min(daily, monthly - this month's attempts before
--                 today)), the day's whole allowance
--   queued        rows with status `queued`
--   finishes_on   the provider day the queue empties, simulated day by day
--                 in claim order: rows of priority 1-2 first, then
--                 confirmation-class rows (priority 3, up to the day's cap
--                 room and the room left), then priority 4-5 rows; the
--                 month resets on the 1st. Null when nothing is queued or it
--                 doesn't empty in 400 days.
--
-- Negative limits raise `email.invalid_limits`.
create function public.email_quota_status(
  daily_limit integer,
  monthly_limit integer,
  confirmation_cap integer
)
returns table (
  provider_day date,
  sent_today integer,
  limit_today integer,
  queued integer,
  finishes_on date
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_now timestamp := now() at time zone 'utc';
  v_day_start timestamptz := date_trunc('day', v_now) at time zone 'utc';
  v_month_start timestamptz := date_trunc('month', v_now) at time zone 'utc';
  v_day date := v_now::date;
  v_sent_today integer;
  v_month_total integer;
  v_conf_today integer;
  v_first integer;
  v_conf integer;
  v_last integer;
  v_month_used integer;
  v_room integer;
  v_cap_room integer;
  v_taken_first integer;
  v_taken_conf integer;
  v_taken_last integer;
  v_sim_day date;
  v_finish date := null;
  v_i integer;
begin
  if daily_limit is null or monthly_limit is null or confirmation_cap is null
    or daily_limit < 0 or monthly_limit < 0 or confirmation_cap < 0
  then
    raise exception using errcode = 'P0001', message = 'email.invalid_limits';
  end if;

  select count(*) filter (where o.provider_attempted_at >= v_day_start),
         count(*) filter (where o.provider_attempted_at >= v_month_start),
         count(*) filter (
           where o.provider_attempted_at >= v_day_start
             and o.kind in ('confirmation', 'status_code')),
         count(*) filter (
           where o.status = 'queued' and o.priority < 3
             and o.kind not in ('confirmation', 'status_code')),
         count(*) filter (
           where o.status = 'queued'
             and o.kind in ('confirmation', 'status_code')),
         count(*) filter (
           where o.status = 'queued' and o.priority > 3
             and o.kind not in ('confirmation', 'status_code'))
  into v_sent_today, v_month_total, v_conf_today, v_first, v_conf, v_last
  from public.email_outbox o;

  provider_day := v_day;
  sent_today := v_sent_today;
  limit_today := greatest(
    0, least(daily_limit, monthly_limit - (v_month_total - v_sent_today)));
  queued := v_first + v_conf + v_last;

  if queued > 0 then
    v_month_used := v_month_total;
    for v_i in 0..399 loop
      v_sim_day := v_day + v_i;
      if v_i = 0 then
        v_room := greatest(
          0, least(daily_limit - v_sent_today, monthly_limit - v_month_total));
        v_cap_room := greatest(confirmation_cap - v_conf_today, 0);
      else
        if extract(day from v_sim_day) = 1 then
          v_month_used := 0;
        end if;
        v_room := greatest(0, least(daily_limit, monthly_limit - v_month_used));
        v_cap_room := confirmation_cap;
      end if;

      v_taken_first := least(v_first, v_room);
      v_taken_conf := least(v_conf, v_cap_room, v_room - v_taken_first);
      v_taken_last := least(v_last, v_room - v_taken_first - v_taken_conf);
      v_first := v_first - v_taken_first;
      v_conf := v_conf - v_taken_conf;
      v_last := v_last - v_taken_last;
      v_month_used := v_month_used + v_taken_first + v_taken_conf
        + v_taken_last;

      if v_first + v_conf + v_last = 0 then
        v_finish := v_sim_day;
        exit;
      end if;
    end loop;
  end if;

  finishes_on := v_finish;
  return next;
end;
$$;

-- Records one Resend webhook event, once per Svix id. Returns:
--   `recorded`   a bounce-class event, stored; a matching `sent` row became
--                `bounced` (keeping `sent_at`)
--   `duplicate`  the Svix id was already stored: nothing changed
--   `unmatched`  no row has that provider message id; the id is stored
--   `ignored`    any other event type; nothing is stored
-- Four types count: `email.bounced`, `email.complained`, `email.suppressed`
-- and `email.failed`. The row's `error` is a code built from the type and
-- subtype (lowercased, `[a-z0-9_]` parts, at most 64 characters); the
-- provider's message text never reaches the database.
create function public.record_email_event(
  svix_id text,
  event_type text,
  provider_message_id text,
  bounce_type text,
  bounce_subtype text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox_id uuid;
  v_status public.outbox_status;
  v_inserted text;
  v_code text;
begin
  if record_email_event.event_type is null
    or record_email_event.event_type not in (
      'email.bounced', 'email.complained', 'email.suppressed', 'email.failed')
  then
    return 'ignored';
  end if;

  select o.id, o.status into v_outbox_id, v_status
  from public.email_outbox o
  where o.provider_message_id = record_email_event.provider_message_id
  order by o.created_at, o.id
  limit 1
  for update;

  insert into public.email_webhook_events (svix_id, event_type, outbox_id)
  values (
    record_email_event.svix_id, record_email_event.event_type, v_outbox_id)
  on conflict on constraint email_webhook_events_pkey do nothing
  returning email_webhook_events.svix_id into v_inserted;

  if v_inserted is null then
    return 'duplicate';
  end if;

  if v_outbox_id is null then
    return 'unmatched';
  end if;

  if v_status = 'sent' then
    v_code := array_to_string(array(
      select p
      from unnest(case record_email_event.event_type
        when 'email.bounced' then
          array['email.bounced', record_email_event.bounce_type,
                record_email_event.bounce_subtype]
        when 'email.suppressed' then
          array['email.suppressed', record_email_event.bounce_type]
        else array[record_email_event.event_type]
      end) with ordinality as t(raw, n),
      lateral (
        select case
          when t.n = 1 then t.raw
          else regexp_replace(lower(t.raw), '[^a-z0-9_]+', '_', 'g')
        end as p
      ) s
      where p is not null and p <> ''
      order by t.n
    ), '.');
    v_code := left(v_code, 64);

    update public.email_outbox o
    set status = 'bounced',
        updated_at = now(),
        error = v_code
    where o.id = v_outbox_id;
  end if;

  return 'recorded';
end;
$$;

revoke all on function
  public.email_quota_status(integer, integer, integer)
from public, anon, service_role;

grant execute on function
  public.email_quota_status(integer, integer, integer)
to authenticated;

revoke all on function
  public.record_email_event(text, text, text, text, text)
from public, anon, authenticated;

grant execute on function
  public.record_email_event(text, text, text, text, text)
to service_role;
