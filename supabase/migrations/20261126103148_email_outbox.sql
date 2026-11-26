-- email_outbox: the one queue behind every email the portal sends, and the
-- commands the sender drains it with (Story 4.1, PRD 4.5, AD-1, AD-9, AD-12).
--
-- Resend's free plan allows 100 emails a day and 3,000 a month, so nothing
-- sends from a request: a row is queued here by `private.enqueue_email` (the
-- only creator of rows) and a drain claims rows within the day's and the
-- month's room, checks each one again at send time, and sends it.
--
-- - Postgres decides. Priority comes from `(kind, requires_action)`, never
--   from the caller: reminder 1, a decision that needs action 2,
--   confirmation and status_code 3, report_notice 4, any other decision 5.
--   Lower numbers send first.
-- - Admins read the table (RLS). Nobody writes it directly, and
--   `service_role` holds nothing on it (hosted projects grant it every new
--   `public` table; the revoke below undoes that). The four commands are
--   `security definer`, empty `search_path`, lock their row `FOR UPDATE`,
--   and are granted to `service_role` only.
-- - The quota's day and month are UTC (AD-12's exception).
-- - Per-kind hooks are found by name, so a later story adds a function and
--   edits no shared body:
--     private.email_send_check_<kind>(uuid) returns text
--       null: send; text: the reason to drop the row. A missing check fails
--       closed (`failed`, `email.no_send_check`).
--     private.email_claim_check_<kind>(uuid) returns boolean
--       false leaves the row queued. A missing check means claimable.
-- - `error` holds a code only (the same allowlist as error_events.code),
--   never a provider message, an address or free text.

create type public.email_kind as enum (
  'reminder',
  'decision',
  'confirmation',
  'status_code',
  'report_notice'
);

-- `bounced` (Story 4.2's webhook) and `canceled` (Epic 7's release undo)
-- have no writer yet.
create type public.outbox_status as enum (
  'queued',
  'sending',
  'sent',
  'failed',
  'bounced',
  'canceled',
  'dropped'
);

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  kind public.email_kind not null,
  recipient_member_id uuid not null
    references public.members (id) on delete cascade,
  template text not null
    constraint email_outbox_template_format
      check (template ~ '^[a-z][a-z0-9_.-]{0,59}$'),
  payload jsonb not null default '{}'::jsonb
    constraint email_outbox_payload_object
      check (jsonb_typeof(payload) = 'object')
    constraint email_outbox_payload_size
      check (octet_length(payload::text) <= 4096),
  dedupe_key text not null
    constraint email_outbox_dedupe_key_unique unique
    constraint email_outbox_dedupe_key_length
      check (char_length(dedupe_key) between 1 and 200),
  task_id uuid references public.tasks (id) on delete set null,
  requires_action boolean not null default false,
  priority smallint not null
    constraint email_outbox_priority_range check (priority between 1 and 5),
  status public.outbox_status not null default 'queued',
  attempt_count integer not null default 0
    constraint email_outbox_attempt_count_nonnegative
      check (attempt_count >= 0),
  recipient_address text,
  provider_message_id text
    constraint email_outbox_provider_message_id_format
      check (provider_message_id ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  provider_attempted_at timestamptz,
  error text
    constraint email_outbox_error_format
      check (error ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_outbox_sent_at_when_sent
    check ((status = 'sent') = (sent_at is not null))
);

create index email_outbox_queue_idx
  on public.email_outbox (status, priority, created_at);

create index email_outbox_task_idx on public.email_outbox (task_id);

create index email_outbox_recipient_member_idx
  on public.email_outbox (recipient_member_id);

create index email_outbox_provider_attempted_at_idx
  on public.email_outbox (provider_attempted_at);

alter table public.email_outbox enable row level security;

create policy email_outbox_select_admin
  on public.email_outbox
  for select
  to authenticated
  using ((select private.is_admin()));

grant select on public.email_outbox to authenticated;

-- The secret key reaches rows only through the commands below.
revoke all on table public.email_outbox from anon, service_role;

-- The one creator of rows. Returns the new row's id, or null when the
-- dedupe key is already taken (nothing changes). `refs` takes only
-- `task_id`; any other key raises `email.unknown_ref`. Callers never pass a
-- priority. Granted to nobody: other commands in the same database call it.
create function private.enqueue_email(
  kind public.email_kind,
  recipient_member_id uuid,
  template text,
  payload jsonb,
  dedupe_key text,
  refs jsonb default '{}'::jsonb,
  requires_action boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
  v_priority smallint;
  v_id uuid;
begin
  if exists (
    select 1
    from jsonb_object_keys(coalesce(enqueue_email.refs, '{}'::jsonb)) k
    where k <> 'task_id'
  ) then
    raise exception using errcode = 'P0001', message = 'email.unknown_ref';
  end if;

  v_task_id := (coalesce(enqueue_email.refs, '{}'::jsonb) ->> 'task_id')::uuid;

  v_priority := case
    when enqueue_email.kind = 'reminder' then 1
    when enqueue_email.kind = 'decision'
      and coalesce(enqueue_email.requires_action, false) then 2
    when enqueue_email.kind in ('confirmation', 'status_code') then 3
    when enqueue_email.kind = 'report_notice' then 4
    else 5
  end;

  insert into public.email_outbox (
    kind, recipient_member_id, template, payload, dedupe_key, task_id,
    requires_action, priority
  )
  values (
    enqueue_email.kind,
    enqueue_email.recipient_member_id,
    enqueue_email.template,
    coalesce(enqueue_email.payload, '{}'::jsonb),
    enqueue_email.dedupe_key,
    v_task_id,
    coalesce(enqueue_email.requires_action, false),
    v_priority
  )
  on conflict on constraint email_outbox_dedupe_key_unique do nothing
  returning email_outbox.id into v_id;

  return v_id;
end;
$$;

revoke all on function
  private.enqueue_email(public.email_kind, uuid, text, jsonb, text, jsonb, boolean)
from public, anon, authenticated;

-- Claims up to `max_rows` queued rows for one drain batch and returns them.
-- The room is the least of `max_rows`, the daily limit's remainder and the
-- monthly limit's remainder, counting rows whose `provider_attempted_at`
-- falls in the current UTC day or month. Confirmation-class rows
-- (`confirmation`, `status_code`) are also held to `confirmation_cap` a UTC
-- day; past it they stay queued and other kinds are still claimed. Rows come
-- in priority order, then oldest first.
--
-- A transaction-level advisory lock serializes claims, so two drains can't
-- both see the same room and pass a cap together. `SKIP LOCKED` still skips
-- rows that a mark or a prepare holds. A row `sending` for more than 15
-- minutes is put back to `queued` first, with its attempt number given back
-- (`attempt_count - 1`), so the claim that follows reuses the number and the
-- resend carries the same idempotency key, `<dedupe_key>:<attempt>`. Resend
-- dedupes on that key only within its 24-hour idempotency window. Because the
-- number is reused, the attempt guard in the marks does not stop a sender
-- older than 15 minutes from marking a reclaimed row; that is safe only
-- because a drain stops after 200 s and its function after 300 s.
--
-- Negative limits raise `email.invalid_limits`.
create function public.claim_email_batch(
  max_rows integer,
  daily_limit integer,
  monthly_limit integer,
  confirmation_cap integer
)
returns table (
  id uuid,
  kind public.email_kind,
  template text,
  payload jsonb,
  dedupe_key text,
  attempt integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day_start timestamptz :=
    date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_month_start timestamptz :=
    date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_room integer;
  v_confirmation_room integer;
  v_claimed integer := 0;
  v_confirmation_claimed integer := 0;
  v_is_confirmation boolean;
  v_row record;
  v_fn regprocedure;
  v_claimable boolean;
begin
  if max_rows is null or daily_limit is null or monthly_limit is null
    or confirmation_cap is null
    or max_rows < 0 or daily_limit < 0 or monthly_limit < 0
    or confirmation_cap < 0
  then
    raise exception using errcode = 'P0001', message = 'email.invalid_limits';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('email_outbox:claim', 0));

  update public.email_outbox o
  set status = 'queued',
      updated_at = now(),
      attempt_count = o.attempt_count - 1
  where o.id in (
    select s.id
    from public.email_outbox s
    where s.status = 'sending'
      and s.provider_attempted_at < now() - interval '15 minutes'
      and s.attempt_count > 0
    for update skip locked
  );

  v_room := least(
    claim_email_batch.max_rows,
    greatest(daily_limit - (
      select count(*)::integer from public.email_outbox o
      where o.provider_attempted_at >= v_day_start
    ), 0),
    greatest(monthly_limit - (
      select count(*)::integer from public.email_outbox o
      where o.provider_attempted_at >= v_month_start
    ), 0)
  );

  v_confirmation_room := greatest(confirmation_cap - (
    select count(*)::integer from public.email_outbox o
    where o.provider_attempted_at >= v_day_start
      and o.kind in ('confirmation', 'status_code')
  ), 0);

  if v_room <= 0 then
    return;
  end if;

  for v_row in
    select o.id as row_id, o.kind as row_kind, o.template as row_template,
           o.payload as row_payload, o.dedupe_key as row_dedupe_key,
           o.attempt_count as row_attempts
    from public.email_outbox o
    where o.status = 'queued'
    order by o.priority, o.created_at, o.id
    for update skip locked
  loop
    exit when v_claimed >= v_room;

    v_is_confirmation := v_row.row_kind in ('confirmation', 'status_code');
    if v_is_confirmation and v_confirmation_claimed >= v_confirmation_room then
      continue;
    end if;

    v_fn := to_regprocedure(
      format('private.email_claim_check_%s(uuid)', v_row.row_kind)
    );
    if v_fn is not null then
      execute format('select %s($1)', v_fn::regproc)
        using v_row.row_id into v_claimable;
      if not coalesce(v_claimable, false) then
        continue;
      end if;
    end if;

    update public.email_outbox o
    set status = 'sending',
        updated_at = now(),
        provider_attempted_at = now(),
        attempt_count = o.attempt_count + 1
    where o.id = v_row.row_id;

    v_claimed := v_claimed + 1;
    if v_is_confirmation then
      v_confirmation_claimed := v_confirmation_claimed + 1;
    end if;

    id := v_row.row_id;
    kind := v_row.row_kind;
    template := v_row.row_template;
    payload := v_row.row_payload;
    dedupe_key := v_row.row_dedupe_key;
    attempt := v_row.row_attempts + 1;
    return next;
  end loop;
end;
$$;

-- Runs the row's send-time check and reads its address, all in Postgres, so
-- TypeScript never reads `members` or decides eligibility (AD-1). Outcome:
--   `ready`   the check passed; `address` is the member's email, now also
--             recorded on the row;
--   `dropped` the check returned a reason, kept as the row's `error`;
--   `failed`  no check exists for the kind (`email.no_send_check`), or the
--             member has no address (`email.no_recipient`);
--   `gone`    the row isn't `sending` at this attempt: nothing changed.
create function public.prepare_email_send(outbox_id uuid, attempt integer)
returns table (outcome text, address text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.email_outbox%rowtype;
  v_fn regprocedure;
  v_reason text;
  v_address text;
begin
  select o.* into v_row
  from public.email_outbox o
  where o.id = prepare_email_send.outbox_id
    and o.status = 'sending'
    and o.attempt_count = prepare_email_send.attempt
  for update;

  if not found then
    outcome := 'gone';
    address := null;
    return next;
    return;
  end if;

  v_fn := to_regprocedure(
    format('private.email_send_check_%s(uuid)', v_row.kind)
  );

  if v_fn is null then
    update public.email_outbox o
    set status = 'failed', error = 'email.no_send_check',
        updated_at = now()
    where o.id = v_row.id;
    outcome := 'failed';
    address := null;
    return next;
    return;
  end if;

  execute format('select %s($1)', v_fn::regproc)
    using v_row.id into v_reason;

  if v_reason is not null then
    update public.email_outbox o
    set status = 'dropped',
        updated_at = now(),
        error = case when v_reason ~ '^[A-Za-z0-9_.:-]{1,64}$'
                     then v_reason else 'email.dropped' end
    where o.id = v_row.id;
    outcome := 'dropped';
    address := null;
    return next;
    return;
  end if;

  select m.email into v_address
  from public.members m
  where m.id = v_row.recipient_member_id;

  if v_address is null then
    update public.email_outbox o
    set status = 'failed', error = 'email.no_recipient',
        updated_at = now()
    where o.id = v_row.id;
    outcome := 'failed';
    address := null;
    return next;
    return;
  end if;

  update public.email_outbox o
  set recipient_address = v_address,
      updated_at = now()
  where o.id = v_row.id;

  outcome := 'ready';
  address := v_address;
  return next;
end;
$$;

-- Marks a `sending` row sent. The attempt must match, which stops a sender
-- holding an older attempt from marking a row that a retry has since claimed.
-- It does not stop a sender older than 15 minutes from marking a reclaimed
-- row (the reclaim gives the number back); that is safe only because a drain
-- stops after 200 s and its function after 300 s. Returns false and changes
-- nothing for a row that is final or at another attempt.
create function public.mark_email_sent(
  outbox_id uuid,
  attempt integer,
  provider_message_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select o.id into v_id
  from public.email_outbox o
  where o.id = mark_email_sent.outbox_id
    and o.status = 'sending'
    and o.attempt_count = mark_email_sent.attempt
  for update;

  if not found then
    return false;
  end if;

  update public.email_outbox o
  set status = 'sent',
      updated_at = now(),
      sent_at = now(),
      provider_message_id = mark_email_sent.provider_message_id,
      error = null
  where o.id = v_id;

  return true;
end;
$$;

-- Marks a `sending` row failed, with a code (anything that isn't one is
-- stored as `email.unknown_error`). Same attempt rule as mark_email_sent.
create function public.mark_email_failed(
  outbox_id uuid,
  attempt integer,
  error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select o.id into v_id
  from public.email_outbox o
  where o.id = mark_email_failed.outbox_id
    and o.status = 'sending'
    and o.attempt_count = mark_email_failed.attempt
  for update;

  if not found then
    return false;
  end if;

  update public.email_outbox o
  set status = 'failed',
      updated_at = now(),
      error = case
        when mark_email_failed.error ~ '^[A-Za-z0-9_.:-]{1,64}$'
          then mark_email_failed.error
        else 'email.unknown_error'
      end
  where o.id = v_id;

  return true;
end;
$$;

revoke all on function
  public.claim_email_batch(integer, integer, integer, integer),
  public.prepare_email_send(uuid, integer),
  public.mark_email_sent(uuid, integer, text),
  public.mark_email_failed(uuid, integer, text)
from public, anon, authenticated;

grant execute on function
  public.claim_email_batch(integer, integer, integer, integer),
  public.prepare_email_send(uuid, integer),
  public.mark_email_sent(uuid, integer, text),
  public.mark_email_failed(uuid, integer, text)
to service_role;
