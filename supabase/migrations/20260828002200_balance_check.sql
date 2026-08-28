-- Daily SMS credit check.
--
-- OTP is the only route into the app, so an empty balance locks everyone out —
-- new customers and returning ones alike. Finding that out from a complaint is
-- the worst possible way, and the check costs nothing until it fires.

create or replace function trigger_sms_balance_check()
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

  perform net.http_post(
    url     := v_url || '/api/cron/sms-balance',
    body    := '{}'::jsonb,
    params  := '{}'::jsonb,
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || v_secret,
                 'Content-Type', 'application/json'
               ),
    timeout_milliseconds := 15000
  );
end;
$$;

revoke all on function trigger_sms_balance_check() from public, anon, authenticated;

do $$
begin
  -- 08:00 Manila (00:00 UTC), so the warning arrives at the start of a day
  -- when there is still time to top up before the evening rush.
  perform cron.schedule('sms-balance-check', '0 0 * * *', 'select public.trigger_sms_balance_check()');
exception when others then
  raise notice 'Could not schedule the balance check (%).', sqlerrm;
end;
$$;
