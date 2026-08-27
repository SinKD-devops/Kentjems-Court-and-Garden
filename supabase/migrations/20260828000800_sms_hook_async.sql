-- ═══════════════════════════════════════════════════════════════════════
-- Send the OTP asynchronously.
--
-- The previous version used the synchronous `http` extension so a rejected
-- send could be reported to the customer immediately. Measured against the
-- live auth service, that does not fit: PhilSMS answers in roughly 1.3-2
-- seconds, which exceeds the budget Supabase allows a Postgres auth hook.
--
-- The observed failure was badly misleading. The HTTP call COMPLETED and the
-- text arrived, then the statement was cancelled and the whole transaction
-- rolled back — so log rows written inside the function vanished too, and
-- Supabase reported "Error running hook URI". A customer received a code that
-- the auth service had already given up on, so it could not be used.
--
-- pg_net queues the request and returns in microseconds. The hook finishes
-- well inside the budget and the background worker performs delivery.
--
-- The cost is real: a send that PhilSMS rejects can no longer be reported at
-- sign-in. The `sms_deliveries` view below exists so those failures are
-- auditable rather than silent — check it if customers report codes not
-- arriving.
-- ═══════════════════════════════════════════════════════════════════════

create extension if not exists pg_net with schema extensions;

drop table if exists public.hook_log;

create or replace function public.send_sms_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone  text := event -> 'user' ->> 'phone';
  v_otp    text := event -> 'sms'  ->> 'otp';
  v_token  text;
  v_sender text;
  v_url    text;
begin
  if v_phone is null or v_otp is null then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 400, 'message', 'Missing phone number or code.'));
  end if;

  -- Credentials live in Vault, never in this function body: migrations are
  -- committed to git, and a token pasted here would be readable by anyone
  -- with the repository.
  select decrypted_secret into v_token
  from vault.decrypted_secrets where name = 'philsms_api_token';

  select decrypted_secret into v_sender
  from vault.decrypted_secrets where name = 'philsms_sender_id';

  select coalesce(
    (select decrypted_secret from vault.decrypted_secrets where name = 'philsms_api_url'),
    'https://dashboard.philsms.com/api/v3'
  ) into v_url;

  -- The one failure still worth reporting synchronously: with no token
  -- nothing can ever be delivered, and the customer should be told to call
  -- the store rather than wait for a text that will never arrive.
  if v_token is null then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 500,
      'message', 'Text messaging is not set up. Please contact Kentjems Store.'));
  end if;

  perform extensions.http_post(
    url     := v_url || '/sms/send',
    body    := jsonb_build_object(
                 'recipient', case when v_phone like '+%' then v_phone else '+' || v_phone end,
                 'sender_id', v_sender,
                 'type',      'plain',
                 'message',   v_otp || ' is your Kentjems code. It expires in 5 minutes. Do not share it.'
               ),
    params  := '{}'::jsonb,
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || v_token,
                 'Content-Type',  'application/json',
                 'Accept',        'application/json'
               ),
    timeout_milliseconds := 8000
  );

  return '{}'::jsonb;
exception when others then
  -- Never leak internals to a sign-in screen.
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 500, 'message', 'Could not send the code. Please try again.'));
end;
$$;

revoke all on function public.send_sms_hook(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.send_sms_hook(jsonb) to supabase_auth_admin;

comment on function public.send_sms_hook(jsonb) is
  'Supabase Send SMS auth hook. Queues the OTP to PhilSMS through pg_net using credentials held in Vault. Delivery outcomes are visible in public.sms_deliveries.';

-- ── delivery audit ─────────────────────────────────────────────────────
--
-- Async delivery means a rejected send is no longer visible at sign-in.
-- This is where it becomes visible instead.

-- net._http_response.content is text, and a provider outage can return HTML
-- rather than JSON, so parse defensively instead of casting blind.
create or replace function public.safe_jsonb(payload text)
returns jsonb
language plpgsql
immutable
as $$
begin
  return payload::jsonb;
exception when others then
  return null;
end;
$$;

create or replace view public.sms_deliveries
with (security_invoker = off) as
  select
    r.id,
    r.created                                          as attempted_at,
    r.status_code,
    public.safe_jsonb(r.content) ->> 'status'          as provider_status,
    public.safe_jsonb(r.content) ->> 'message'         as provider_message,
    (r.status_code = 200
      and coalesce(public.safe_jsonb(r.content) ->> 'status', '') <> 'error') as delivered
  from net._http_response r
  order by r.created desc;

comment on view public.sms_deliveries is
  'Recent SMS delivery attempts and their outcomes. Check here when customers report that codes are not arriving.';

revoke all on public.sms_deliveries from anon, authenticated;
