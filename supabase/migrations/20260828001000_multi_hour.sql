-- ═══════════════════════════════════════════════════════════════════════
-- Consecutive multi-hour bookings.
--
-- A booking becomes a range of whole hours rather than exactly one. The
-- exclusion constraint already works on ranges, so nothing changes there —
-- a 3-hour booking simply excludes three hours instead of one.
--
-- Two things do change:
--
--   Pricing must be summed PER HOUR. A 5-7 PM booking crosses the evening
--   boundary and costs 60 + 100 + 100, not 3 x 60. Charging from the start
--   hour would sell the whole evening at the day rate.
--
--   Opening hours must be checked against real instants. The old check
--   compared `(local + 1 hour)::time > closes_at`, which happened to work
--   for one-hour slots only by accident: an 11 PM slot ends at 00:00, and
--   00:00 > 24:00 is false. A 2-hour booking from 11 PM ends at 01:00, which
--   is also not > 24:00, so it would have been accepted — an hour past
--   closing, on the following day.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function price_centavos_for_range(
  p_space_id  uuid,
  p_starts_at timestamptz,
  p_hours     integer
)
returns integer
language plpgsql
stable
as $$
declare
  v_total integer := 0;
  v_price integer;
  h       integer;
begin
  for h in 0 .. p_hours - 1 loop
    v_price := price_centavos_for(p_space_id, p_starts_at + make_interval(hours => h));
    if v_price is null then
      return null;   -- an unpriced hour makes the whole range unsellable
    end if;
    v_total := v_total + v_price;
  end loop;
  return v_total;
end;
$$;

comment on function price_centavos_for_range(uuid, timestamptz, integer) is
  'Total price for consecutive hours, summed per hour so a booking crossing the evening rate boundary is charged correctly.';

-- The three-argument version must go, or a three-argument call is ambiguous
-- between it and the new signature with its defaulted p_hours.
drop function if exists request_booking(text, timestamptz, boolean);

-- p_hours is added AFTER p_accept_terms so existing three-argument calls keep
-- working and default to a single hour.
create or replace function request_booking(
  p_space_slug   text,
  p_starts_at    timestamptz,
  p_accept_terms boolean default false,
  p_hours        integer default 1
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
  v_opens    timestamptz;
  v_closes   timestamptz;
  v_price    integer;
  v_open     integer;
  v_expires  timestamptz;
  v_store    timestamptz;
  v_id       uuid;
begin
  if v_user is null then
    raise exception 'You need to sign in first.' using errcode = '28000';
  end if;

  if p_hours is null or p_hours < 1 or p_hours > 12 then
    raise exception 'Choose between 1 and 12 hours.' using errcode = '22023';
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

  if v_profile.accepted_terms_at is null then
    if not p_accept_terms then
      raise exception 'Please accept the booking terms to continue.' using errcode = '22023';
    end if;
    update profiles set accepted_terms_at = now() where id = v_user;
  end if;

  v_ends_at := p_starts_at + make_interval(hours => p_hours);
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

  if not found then
    raise exception 'The % is closed that day.', lower(v_space.name) using errcode = '22023';
  end if;

  -- Real instants, so a range that runs past midnight is caught. `date +
  -- time '24:00'` lands on the following midnight, which is exactly what
  -- closing at the end of the day means.
  v_opens  := (v_date + v_hours.opens_at)  at time zone 'Asia/Manila';
  v_closes := (v_date + v_hours.closes_at) at time zone 'Asia/Manila';

  if p_starts_at < v_opens or v_ends_at > v_closes then
    raise exception 'The % is closed at that time.', lower(v_space.name)
      using errcode = '22023';
  end if;

  if exists (
    select 1 from closures
    where space_id = v_space.id
      and during && tstzrange(p_starts_at, v_ends_at)
  ) then
    raise exception 'Part of that time is closed.' using errcode = '22023';
  end if;

  v_price := price_centavos_for_range(v_space.id, p_starts_at, p_hours);
  if v_price is null then
    raise exception 'No price is set for part of that time.' using errcode = '22023';
  end if;

  -- Retire this caller's own expired requests before counting, so the count
  -- and the unique index enforcing it agree.
  update bookings
  set status = 'expired'
  where user_id = v_user
    and status = 'requested'
    and expires_at <= now();

  select count(*) into v_open from bookings
  where user_id = v_user
    and space_id = v_space.id
    and status in ('requested', 'proof_submitted');

  if v_open >= v_space.max_open_requests then
    raise exception 'You already have an open request for the %. Pay for it or cancel it first.',
      lower(v_space.name) using errcode = '22023';
  end if;

  v_store   := (v_date + time '00:00' + interval '1 day') at time zone 'Asia/Manila';
  v_expires := least(now() + make_interval(mins => v_settings.request_expiry_minutes), v_store);

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

revoke all on function request_booking(text, timestamptz, boolean, integer) from public, anon;
grant execute on function request_booking(text, timestamptz, boolean, integer) to authenticated;
