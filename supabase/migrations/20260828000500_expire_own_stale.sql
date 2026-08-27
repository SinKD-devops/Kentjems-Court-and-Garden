-- ═══════════════════════════════════════════════════════════════════════
-- Fix: the open-request limit disagreed with the index enforcing it.
--
-- `one_open_request_per_space` is a partial unique index on
-- status in ('requested','proof_submitted'). A partial index cannot call
-- now(), so it cannot know that a request has expired — it counts stale rows.
--
-- request_booking's own check does consider expires_at, so the two disagreed:
-- the function decided a customer was allowed a new request, then the insert
-- was rejected by the index. Whenever the cron sweep was late or failed, a
-- customer whose request had expired could not book at all — precisely the
-- failure the lazy expiry evaluation was meant to prevent.
--
-- Fix: clear the caller's own stale requests inside the same transaction,
-- before counting. Correctness no longer depends on the sweep running.
-- ═══════════════════════════════════════════════════════════════════════

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

  -- Retire this caller's own expired requests before counting, so the count
  -- and the unique index enforcing it agree. Scoped to the caller: sweeping
  -- other people's rows here would make one customer's booking depend on
  -- another's timing.
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
