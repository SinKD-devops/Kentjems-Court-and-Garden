-- ═══════════════════════════════════════════════════════════════════════
-- Schedule the expiry reminder job.
--
-- The reminder has to be sent from the app, not from Postgres: web push needs
-- VAPID signing and payload encryption, which is not something to attempt in
-- SQL. So Postgres does the scheduling and the app does the sending, with
-- pg_net making the call.
--
-- Both values live in Vault rather than in this file: the URL is harmless but
-- the secret is not, and migrations are committed to git.
--
--   select vault.create_secret('https://your-app.vercel.app', 'app_url', 'Public app URL');
--   select vault.create_secret('<CRON_SECRET>', 'cron_secret', 'Shared secret for cron endpoints');
--
-- `npm run db:secrets` does both from .env.local.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function trigger_expiry_reminders()
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

  -- Silently do nothing until deployed. pg_cron runs every minute, and an
  -- error a minute in the Postgres log is its own kind of outage.
  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/api/cron/expiry-reminders',
    body    := '{}'::jsonb,
    params  := '{}'::jsonb,
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || v_secret,
                 'Content-Type', 'application/json'
               ),
    timeout_milliseconds := 10000
  );
end;
$$;

revoke all on function trigger_expiry_reminders() from public, anon, authenticated;

comment on function trigger_expiry_reminders() is
  'Calls the app''s reminder endpoint. Web push needs VAPID signing, so the sending happens in the app and only the scheduling happens here.';

do $$
begin
  perform cron.schedule(
    'expiry-reminders', '* * * * *', 'select public.trigger_expiry_reminders()'
  );
exception when others then
  raise notice 'Could not schedule expiry reminders (%).', sqlerrm;
end;
$$;
