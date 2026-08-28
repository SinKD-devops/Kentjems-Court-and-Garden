-- ═══════════════════════════════════════════════════════════════════════
-- Send the sign-in message through Semaphore instead of PhilSMS.
--
-- PhilSMS delivered to Globe and silently not at all to Smart and TNT, while
-- still reporting "Delivered" and charging for every message. Four people
-- requested a sign-in message and received nothing. Semaphore covers Globe,
-- Smart, Sun and DITO.
--
-- Uses Semaphore's /otp endpoint with an explicit `code` parameter. The
-- endpoint can generate its own code, but Supabase generates the one it will
-- later verify — sending any other number would produce a message that looks
-- right and never works. /otp also carries no rate limit, unlike /messages.
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
  v_key    text;
  v_sender text;
  v_url    text;
  v_local  text;
begin
  if v_phone is null or v_otp is null then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 400, 'message', 'Missing phone number or code.'));
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'semaphore_api_key';

  select decrypted_secret into v_sender
  from vault.decrypted_secrets where name = 'semaphore_sender_name';

  select coalesce(
    (select decrypted_secret from vault.decrypted_secrets where name = 'semaphore_api_url'),
    'https://api.semaphore.co/api/v4'
  ) into v_url;

  if v_key is null then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 500,
      'message', 'Text messaging is not set up. Please contact Kentjems Store.'));
  end if;

  -- Semaphore takes the local form. Supabase stores the number without a plus.
  v_local := '0' || right(regexp_replace(v_phone, '\D', '', 'g'), 10);

  perform net.http_post(
    url     := v_url || '/otp',
    body    := jsonb_build_object(
                 'apikey',     v_key,
                 'number',     v_local,
                 'sendername', v_sender,
                 'code',       v_otp,
                 'message',    'Kentjems Court and Garden. Your number is {otp}. ' ||
                               'It works for the next 5 minutes.'
               ),
    params  := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json'),
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

comment on function public.send_sms_hook(jsonb) is
  'Supabase Send SMS auth hook. Delivers the sign-in message through Semaphore, passing Supabase''s own code so the number sent is the number verified.';
