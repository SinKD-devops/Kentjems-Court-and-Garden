-- ═══════════════════════════════════════════════════════════════════════
-- Reword the sign-in message so carriers stop filtering it.
--
-- The old text was:
--   "216220 is your Kentjems code. It expires in 5 minutes. Do not share it."
--
-- Philippine carriers filter aggressively on the vocabulary of scams, and
-- that sentence is built from it: "code", "expires", "do not share". Those
-- three together are close to a template for the fraud they are blocking.
--
-- The replacement says the same thing in ordinary words, names the business
-- so it is recognisable, and drops the urgency. It also uses no character
-- outside the GSM alphabet — a peso sign or a curly quote would force the
-- message into Unicode encoding, cutting the limit from 160 characters to 70
-- and changing how some carriers route it.
-- ═══════════════════════════════════════════════════════════════════════

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
                 'message',   'Kentjems Court and Garden. Your number is ' || v_otp ||
                              '. It works for the next 5 minutes.'
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
    'http_code', 500, 'message', 'Could not send the message. Please try again.'));
end;
$$;

revoke all on function public.send_sms_hook(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.send_sms_hook(jsonb) to supabase_auth_admin;
