-- ═══════════════════════════════════════════════════════════════════════
-- What the court is being rented for.
--
-- The customer picks a purpose when booking the court. Two of them —
-- cheerdance and practice — are declined, politely, with a support number so
-- the answer is a conversation rather than a dead end. They are still offered
-- rather than hidden: someone who wants the court for cheerdance needs to be
-- told no and why, not left guessing why the option is missing.
--
-- The check lives here, in the same transaction as the insert, with every
-- other booking rule. Putting it in TypeScript would be the one thing
-- HANDOVER §9 says not to do.
--
-- Stored in `bookings.event_type`, which has existed unused since the initial
-- schema. The operator console reads it through `operator_schedule` — a
-- purpose nobody can see would be another `is_backup_admin`.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function request_booking(
  p_space_slug   text,
  p_starts_at    timestamptz,
  p_accept_terms boolean default false,
  p_hours        integer default 1,
  p_purpose      text    default null
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
  v_support  text;
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

  -- ── purpose ─────────────────────────────────────────────────────────
  -- Null is allowed so walk-ins and the garden are unaffected; the court
  -- form requires a choice.

  if p_purpose is not null then
    if p_purpose not in (
      'pickleball', 'badminton', 'volleyball', 'cheerdance', 'practice', 'basketball'
    ) then
      raise exception 'Please choose what the court is for.' using errcode = '22023';
    end if;

    if p_purpose in ('cheerdance', 'practice') then
      v_support := array_to_string(coalesce(v_settings.support_numbers, '{}'), ' or ');

      raise exception
        'Sorry, we are not taking % bookings for the court at the moment. You are welcome to book it for pickleball, badminton, volleyball or basketball. Please call % if you would like to ask about it.',
        p_purpose, v_support
        using errcode = '22023';
    end if;
  end if;

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
    price_centavos, source, contact_name, contact_phone, expires_at, event_type
  )
  values (
    v_space.id, v_user, p_starts_at, v_ends_at, 'requested',
    v_price, 'app', v_profile.full_name, v_profile.phone, v_expires, p_purpose
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- The four-argument version would still resolve for callers that omit the
-- purpose, and would silently store nothing. One signature only.
drop function if exists request_booking(text, timestamptz, boolean, integer);

revoke all on function request_booking(text, timestamptz, boolean, integer, text) from public, anon;
grant execute on function request_booking(text, timestamptz, boolean, integer, text) to authenticated;

comment on function request_booking(text, timestamptz, boolean, integer, text) is
  'Creates a booking request. Every rule — hours, advance window, open-request limit, pricing, expiry, and the declined court purposes — is evaluated in the same transaction as the insert.';

-- ── show it at the counter ─────────────────────────────────────────────

create or replace view operator_schedule
with (security_invoker = on) as
  select
    b.id,
    b.space_id,
    s.name          as space_name,
    b.starts_at,
    b.ends_at,
    b.status,
    b.price_centavos,
    b.source,
    b.contact_name,
    b.contact_phone,
    b.expires_at,
    exists (
      select 1 from payments p
      where p.booking_id = b.id and p.status = 'approved'
    ) as paid,
    -- Appended rather than slotted in beside the other booking columns:
    -- `create or replace view` can only add columns at the end, and renaming
    -- `paid` to `purpose` is what it does if you insert one in the middle.
    b.event_type    as purpose
  from bookings b
  join spaces s on s.id = b.space_id
  where b.status in ('requested', 'proof_submitted', 'confirmed', 'completed');

comment on view operator_schedule is
  'Live bookings for the counter console. security_invoker so RLS keeps this to the operator.';

grant select on operator_schedule to authenticated;
