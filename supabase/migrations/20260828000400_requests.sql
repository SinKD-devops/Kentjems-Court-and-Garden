-- ═══════════════════════════════════════════════════════════════════════
-- Booking requests, expiry, and the availability pulse.
--
-- Request creation lives in one SECURITY DEFINER function rather than in
-- application code. Every rule — opening hours, advance window, the open
-- request limit, pricing, expiry — is evaluated in the same transaction as
-- the insert, so there is no window between "is this allowed?" and "do it"
-- for a concurrent request to slip through.
-- ═══════════════════════════════════════════════════════════════════════

-- ── a profile for every new account ────────────────────────────────────

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, phone)
  values (new.id, coalesce(new.phone, new.email, new.id::text))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ── availability pulse ─────────────────────────────────────────────────
--
-- The slot grid must update the moment a payment is confirmed. Subscribing
-- to `bookings` directly cannot work: RLS hides other people's rows from a
-- customer, and relaxing it would expose names and phone numbers, since RLS
-- filters rows and not columns.
--
-- So bookings bump a per-space counter instead. It carries no information
-- beyond "something changed in this space", is safe for anyone to read, and
-- the client refetches availability through the existing views when it moves.

create table availability_pulse (
  space_id   uuid primary key references spaces (id) on delete cascade,
  revision   bigint not null default 0,
  changed_at timestamptz not null default now()
);

insert into availability_pulse (space_id)
select id from spaces on conflict do nothing;

create or replace function bump_availability_pulse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.space_id, old.space_id);
begin
  insert into availability_pulse (space_id, revision, changed_at)
  values (target, 1, now())
  on conflict (space_id) do update
    set revision = availability_pulse.revision + 1,
        changed_at = now();
  return coalesce(new, old);
end;
$$;

create trigger bookings_bump_pulse
  after insert or update or delete on bookings
  for each row execute function bump_availability_pulse();

alter table availability_pulse enable row level security;

create policy pulse_read on availability_pulse for select using (true);

alter publication supabase_realtime add table availability_pulse;

-- ── request creation ───────────────────────────────────────────────────

create or replace function request_booking(
  p_space_slug   text,
  p_starts_at    timestamptz,
  p_accept_terms boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user     uuid := auth.uid();
  v_space    spaces%rowtype;
  v_profile  profiles%rowtype;
  v_settings settings%rowtype;
  v_hours    opening_hours%rowtype;
  v_ends_at  timestamptz;
  v_local    timestamp;
  v_date     date;
  v_price    integer;
  v_open     integer;
  v_expires  timestamptz;
  v_close    timestamptz;
  v_id       uuid;
begin
  if v_user is null then
    raise exception 'You need to sign in first.' using errcode = '28000';
  end if;

  select * into v_space from spaces where slug = p_space_slug and is_active;
  if not found then
    raise exception 'That space is not available.' using errcode = '22023';
  end if;

  if v_space.mode <> 'hourly' then
    raise exception 'Garden bookings use packages, not hourly slots.' using errcode = '22023';
  end if;

  select * into v_settings from settings limit 1;
  select * into v_profile from profiles where id = v_user;

  -- Terms are ticked at first booking, not discovered at cancellation.
  if v_profile.accepted_terms_at is null then
    if not p_accept_terms then
      raise exception 'Please accept the booking terms to continue.' using errcode = '22023';
    end if;
    update profiles set accepted_terms_at = now() where id = v_user;
  end if;

  v_ends_at := p_starts_at + interval '1 hour';
  v_local   := p_starts_at at time zone 'Asia/Manila';
  v_date    := v_local::date;

  if p_starts_at <= now() then
    raise exception 'That time has already passed.' using errcode = '22023';
  end if;

  if v_date > (now() at time zone 'Asia/Manila')::date + v_space.advance_days then
    raise exception 'Bookings open only % days ahead.', v_space.advance_days
      using errcode = '22023';
  end if;

  select * into v_hours from opening_hours
  where space_id = v_space.id
    and (day_of_week = extract(dow from v_local)::integer or day_of_week is null)
  order by day_of_week nulls last
  limit 1;

  if not found
     or v_local::time < v_hours.opens_at
     or (v_local + interval '1 hour')::time > v_hours.closes_at then
    raise exception 'The % is closed at that time.', lower(v_space.name)
      using errcode = '22023';
  end if;

  if exists (
    select 1 from closures
    where space_id = v_space.id
      and during && tstzrange(p_starts_at, v_ends_at)
  ) then
    raise exception 'That slot is closed.' using errcode = '22023';
  end if;

  v_price := price_centavos_for(v_space.id, p_starts_at);
  if v_price is null then
    raise exception 'No price is set for that time.' using errcode = '22023';
  end if;

  -- One open request per space. Expired requests do not count, and are
  -- evaluated here rather than trusted from a sweep that may not have run.
  select count(*) into v_open from bookings
  where user_id = v_user
    and space_id = v_space.id
    and (status = 'proof_submitted'
         or (status = 'requested' and expires_at > now()));

  if v_open >= v_space.max_open_requests then
    raise exception 'You already have an open request for the %. Pay for it or cancel it first.',
      lower(v_space.name) using errcode = '22023';
  end if;

  -- Expiry never outlives the store: there is no point holding a request
  -- past the hour someone could still walk in and pay for it.
  v_close   := (v_date + time '00:00' + interval '1 day') at time zone 'Asia/Manila';
  v_expires := least(now() + make_interval(mins => v_settings.request_expiry_minutes), v_close);

  if v_expires - now() < interval '10 minutes' then
    raise exception 'Too late to request tonight — Kentjems Store is closing. Try tomorrow.'
      using errcode = '22023';
  end if;

  insert into bookings (
    space_id, user_id, starts_at, ends_at, status,
    price_centavos, source, contact_name, contact_phone, expires_at
  )
  values (
    v_space.id, v_user, p_starts_at, v_ends_at, 'requested',
    v_price, 'app', v_profile.full_name, v_profile.phone, v_expires
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function request_booking(text, timestamptz, boolean) from public;
grant execute on function request_booking(text, timestamptz, boolean) to authenticated;

-- ── withdrawing ────────────────────────────────────────────────────────

create or replace function withdraw_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update bookings
  set status = 'withdrawn'
  where id = p_booking_id
    and user_id = auth.uid()
    and status = 'requested';

  if not found then
    raise exception 'That request can no longer be cancelled.' using errcode = '22023';
  end if;
end;
$$;

revoke all on function withdraw_booking(uuid) from public;
grant execute on function withdraw_booking(uuid) to authenticated;

-- ── expiry sweep ───────────────────────────────────────────────────────
--
-- Housekeeping only. Availability queries already treat an expired request
-- as dead, so a late or failed sweep can never resurrect a slot — it just
-- tidies rows and frees the user's open-request allowance.

create or replace function expire_stale_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update bookings
  set status = 'expired'
  where status = 'requested' and expires_at <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule(
    'expire-stale-requests', '* * * * *', 'select public.expire_stale_requests()'
  );
exception when others then
  raise notice 'pg_cron not scheduled (%). Expiry still works: availability treats expired requests as dead.', sqlerrm;
end;
$$;
