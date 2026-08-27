-- pg_net's functions live in the `net` schema, not in `extensions`, even
-- though the extension itself is registered against `extensions`. Both
-- extensions expose an `http_post`, so `extensions.http_post` resolved to the
-- SYNCHRONOUS one from the `http` extension — which takes different
-- arguments, so the named-parameter call matched nothing and the exception
-- handler turned it into "Could not send the code".

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

  select decrypted_secret into v_token
  from vault.decrypted_secrets where name = 'philsms_api_token';

  select decrypted_secret into v_sender
  from vault.decrypted_secrets where name = 'philsms_sender_id';

  select coalesce(
    (select decrypted_secret from vault.decrypted_secrets where name = 'philsms_api_url'),
    'https://dashboard.philsms.com/api/v3'
  ) into v_url;

  -- The one failure still worth reporting synchronously: with no token
  -- nothing can ever be delivered, and the customer should call the store
  -- rather than wait for a text that will never arrive.
  if v_token is null then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 500,
      'message', 'Text messaging is not set up. Please contact Kentjems Store.'));
  end if;

  perform net.http_post(
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
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 500, 'message', 'Could not send the code. Please try again.'));
end;
$$;

revoke all on function public.send_sms_hook(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.send_sms_hook(jsonb) to supabase_auth_admin;
