-- ═══════════════════════════════════════════════════════════════════════
-- Throttle password guessing.
--
-- Usernames here are not secret. Every Philippine mobile number is `09` plus
-- nine digits, so an attacker does not have to discover who has an account —
-- they can work through the space. Supabase's own auth rate limits are a
-- dashboard setting and apply per IP; this is per phone number, which is the
-- thing actually being attacked.
--
-- Written by the sign-in action with the service key, never by a customer
-- session: a table the guesser can clear is not a throttle. No RLS policy is
-- granted to `authenticated` at all, so it is unreadable and unwritable
-- through the API.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists auth_attempts (
  id         uuid primary key default gen_random_uuid(),
  phone      text not null,
  failed_at  timestamptz not null default now()
);

create index if not exists auth_attempts_phone_idx on auth_attempts (phone, failed_at desc);

alter table auth_attempts enable row level security;

comment on table auth_attempts is
  'Failed password sign-ins, one row each. Written only with the service key from the sign-in action. No policies, so RLS denies every customer read and write.';

-- ── the check and the record, in one place ─────────────────────────────

create or replace function password_attempts_recent(p_phone text, p_minutes integer default 15)
returns integer
language sql
security definer
set search_path = public
as $$
  select count(*)::integer from auth_attempts
  where phone = p_phone
    and failed_at > now() - make_interval(mins => p_minutes);
$$;

create or replace function record_password_failure(p_phone text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into auth_attempts (phone) values (p_phone);
$$;

create or replace function clear_password_failures(p_phone text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from auth_attempts where phone = p_phone;
$$;

revoke all on function password_attempts_recent(text, integer) from public, anon, authenticated;
revoke all on function record_password_failure(text)          from public, anon, authenticated;
revoke all on function clear_password_failures(text)          from public, anon, authenticated;

-- Old rows carry no value once they are outside the window, and they are a
-- record of who tried to sign in. Swept with the other housekeeping.
do $$
begin
  perform cron.schedule(
    'purge-auth-attempts', '17 3 * * *',
    $sql$delete from auth_attempts where failed_at < now() - interval '2 days'$sql$
  );
exception when others then
  raise notice 'Could not schedule auth attempt purge (%).', sqlerrm;
end;
$$;
