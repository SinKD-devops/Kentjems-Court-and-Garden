-- ═══════════════════════════════════════════════════════════════════════
-- Housekeeping: completing bookings, logging SMS, and retiring screenshots.
-- ═══════════════════════════════════════════════════════════════════════

-- ── bookings finish ────────────────────────────────────────────────────
--
-- Nothing ever moved a booking past 'confirmed', so this morning's finished
-- game sat on the counter schedule looking identical to tonight's upcoming
-- one. Reports already counted both, but the operator could not tell them
-- apart at a glance.

create or replace function complete_past_bookings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update bookings
  set status = 'completed'
  where status = 'confirmed' and ends_at <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function complete_past_bookings() from public, anon, authenticated;

do $$
begin
  perform cron.schedule(
    'complete-past-bookings', '*/15 * * * *', 'select public.complete_past_bookings()'
  );
exception when others then
  raise notice 'Could not schedule booking completion (%).', sqlerrm;
end;
$$;

-- ── SMS delivery log ───────────────────────────────────────────────────
--
-- sms_deliveries only ever saw the OTP path, because that goes through
-- pg_net. Everything the app sends went through fetch and was invisible —
-- which is how a bug that silently sent nothing at all survived until a
-- customer noticed.

create table if not exists sms_log (
  id         uuid primary key default gen_random_uuid(),
  recipient  text not null,
  kind       text not null,
  ok         boolean not null,
  error      text,
  created_at timestamptz not null default now()
);

create index if not exists sms_log_created_idx on sms_log (created_at desc);
create index if not exists sms_log_failed_idx  on sms_log (created_at desc) where not ok;

alter table sms_log enable row level security;

create policy sms_log_operator_read on sms_log for select using (is_operator());

comment on table sms_log is
  'Every SMS the app attempts, successful or not. Delivery failures should be visible without a customer having to report them.';

-- ── screenshot retention ───────────────────────────────────────────────
--
-- Payment screenshots carry financial details and there is no reason to keep
-- them once the booking is long finished. The payment row and its reference
-- number stay, so the records survive; only the image goes.

create or replace function proofs_to_purge(p_days integer default 90)
returns table (payment_id uuid, proof_path text)
language sql
security definer
set search_path = public
as $$
  select p.id, p.proof_path
  from payments p
  join bookings b on b.id = p.booking_id
  where p.proof_path is not null
    and b.ends_at < now() - make_interval(days => p_days);
$$;

create or replace function mark_proofs_purged(p_payment_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update payments set proof_path = null where id = any(p_payment_ids);
$$;

revoke all on function proofs_to_purge(integer) from public, anon, authenticated;
revoke all on function mark_proofs_purged(uuid[]) from public, anon, authenticated;

create or replace function trigger_proof_purge()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'app_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    return;
  end if;

  -- Deleting the file needs the Storage API, so the app does the work and
  -- Postgres only schedules it.
  perform net.http_post(
    url     := v_url || '/api/cron/purge-proofs',
    body    := '{}'::jsonb,
    params  := '{}'::jsonb,
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || v_secret,
                 'Content-Type', 'application/json'
               ),
    timeout_milliseconds := 20000
  );
end;
$$;

revoke all on function trigger_proof_purge() from public, anon, authenticated;

do $$
begin
  -- Daily at 03:15 Manila (19:15 UTC), when nobody is booking.
  perform cron.schedule('purge-proofs', '15 19 * * *', 'select public.trigger_proof_purge()');
exception when others then
  raise notice 'Could not schedule proof purge (%).', sqlerrm;
end;
$$;
