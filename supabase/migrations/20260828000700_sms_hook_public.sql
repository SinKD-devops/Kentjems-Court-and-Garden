-- ═══════════════════════════════════════════════════════════════════════
-- Move the SMS hook into `public`.
--
-- The Supabase dashboard's hook picker only enumerates certain schemas, and
-- a custom one like `private` does not appear — the function cannot be
-- selected even though it exists and is granted correctly.
--
-- Living in `public` means PostgREST advertises it, so the grants do the
-- real work: execute is revoked from anon and authenticated, leaving only
-- supabase_auth_admin able to call it. A customer hitting /rpc/send_sms_hook
-- gets permission denied. This is how Supabase's own hook examples are set
-- up.
-- ═══════════════════════════════════════════════════════════════════════

drop function if exists private.send_sms_hook(jsonb);
drop schema if exists private cascade;

create or replace function public.send_sms_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone     text := event -> 'user' ->> 'phone';
  v_otp       text := event -> 'sms'  ->> 'otp';
  v_token     text;
  v_sender    text;
  v_url       text;
  v_response  extensions.http_response;
  v_body      jsonb;
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

  if v_token is null then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 500,
      'message', 'Text messaging is not set up. Please contact Kentjems Store.'));
  end if;

  -- Cap the call so a PhilSMS outage cannot pin a database connection.
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '8000');

  begin
    select * into v_response from extensions.http((
      'POST',
      v_url || '/sms/send',
      array[
        extensions.http_header('Authorization', 'Bearer ' || v_token),
        extensions.http_header('Accept', 'application/json')
      ],
      'application/json',
      jsonb_build_object(
        'recipient', case when v_phone like '+%' then v_phone else '+' || v_phone end,
        'sender_id', v_sender,
        'type',      'plain',
        'message',   v_otp || ' is your Kentjems code. It expires in 5 minutes. Do not share it.'
      )::text
    )::extensions.http_request);
  exception when others then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 502,
      'message', 'Could not reach the text message provider. Please try again.'));
  end;

  v_body := (case
    when v_response.content is null then '{}'::jsonb
    else v_response.content::jsonb
  end);

  if v_response.status <> 200 or v_body ->> 'status' = 'error' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 502,
      'message', coalesce(v_body ->> 'message', 'Could not send the code. Please try again.')));
  end if;

  return '{}'::jsonb;
exception when others then
  -- Never leak internals to a sign-in screen.
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 500, 'message', 'Could not send the code. Please try again.'));
end;
$$;

-- The grants are the security boundary now that this sits in public.
-- service_role is included: it inherits execute from the default privileges on
-- public, and a leaked secret key should not be able to spend SMS credit.
revoke all on function public.send_sms_hook(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.send_sms_hook(jsonb) to supabase_auth_admin;

comment on function public.send_sms_hook(jsonb) is
  'Supabase Send SMS auth hook. Delivers OTP through PhilSMS using credentials held in Vault. Register at Authentication -> Hooks -> Send SMS -> Postgres function.';
