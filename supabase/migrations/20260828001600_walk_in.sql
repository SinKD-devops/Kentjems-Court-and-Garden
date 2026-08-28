-- ═══════════════════════════════════════════════════════════════════════
-- Walk-in bookings, taken at the counter.
--
-- Most customers early on will never open the app. They arrive, ask for an
-- hour, and pay cash. Without this, the schedule the operator relies on would
-- disagree with reality the moment the first walk-in is turned away — and the
-- app would happily sell a court that is already in use.
--
-- Booked and paid in one step: there is no reason to hold a slot for someone
-- standing at the counter with money in hand.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function create_walk_in(
  p_space_slug text,
  p_starts_at  timestamptz,
  p_hours      integer,
  p_name       text,
  p_phone      text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space   spaces%rowtype;
  v_hours   opening_hours%rowtype;
  v_local   timestamp;
  v_date    date;
  v_opens   timestamptz;
  v_closes  timestamptz;
  v_ends_at timestamptz;
  v_price   integer;
  v_id      uuid;
  v_lost    jsonb;
begin
  if not is_operator() then
    raise exception 'Only the operator can take walk-ins.' using errcode = '42501';
  end if;

  if p_hours is null or p_hours < 1 or p_hours > 12 then
    raise exception 'Choose between 1 and 12 hours.' using errcode = '22023';
  end if;

  if p_phone is null or length(trim(p_phone)) < 7 then
    raise exception 'A contact number is required.' using errcode = '22023';
  end if;

  select * into v_space from spaces where slug = p_space_slug and is_active;
  if not found or v_space.mode <> 'hourly' then
    raise exception 'That space cannot be booked by the hour.' using errcode = '22023';
  end if;

  v_ends_at := p_starts_at + make_interval(hours => p_hours);
  v_local   := p_starts_at at time zone 'Asia/Manila';
  v_date    := v_local::date;

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

  v_price := price_centavos_for_range(v_space.id, p_starts_at, p_hours);
  if v_price is null then
    raise exception 'No price is set for part of that time.' using errcode = '22023';
  end if;

  -- Deliberately NOT blocked on a past start time. Someone can be standing on
  -- the court at ten past the hour, and refusing to record that would leave
  -- the schedule wrong about a court that is visibly in use.
  insert into bookings (
    space_id, starts_at, ends_at, status, price_centavos,
    source, contact_name, contact_phone
  )
  values (
    v_space.id, p_starts_at, v_ends_at, 'confirmed', v_price,
    'walk_in', nullif(trim(p_name), ''), trim(p_phone)
  )
  returning id into v_id;

  insert into payments (booking_id, method, amount_centavos, status, reviewed_at, reviewed_by)
  values (v_id, 'cash', v_price, 'approved', now(), auth.uid());

  with bumped as (
    update bookings
    set status = 'superseded'
    where space_id = v_space.id
      and id <> v_id
      and status = 'requested'
      and tstzrange(starts_at, ends_at) && tstzrange(p_starts_at, v_ends_at)
    returning id, contact_phone, starts_at, ends_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'phone', contact_phone, 'starts_at', starts_at, 'ends_at', ends_at
  )), '[]'::jsonb)
  into v_lost
  from bumped;

  return jsonb_build_object('id', v_id, 'space', v_space.name,
                            'price_centavos', v_price, 'superseded', v_lost);
exception
  when exclusion_violation then
    raise exception 'That time is already booked.' using errcode = '22023';
end;
$$;

revoke all on function create_walk_in(text, timestamptz, integer, text, text) from public, anon;
grant execute on function create_walk_in(text, timestamptz, integer, text, text) to authenticated;

comment on function create_walk_in(text, timestamptz, integer, text, text) is
  'Books and pays in one step for a customer at the counter. Past start times are allowed on purpose: a court already in use must be recordable.';

-- ── today's schedule ───────────────────────────────────────────────────

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
    ) as paid
  from bookings b
  join spaces s on s.id = b.space_id
  where b.status in ('requested', 'proof_submitted', 'confirmed', 'completed');

comment on view operator_schedule is
  'Live bookings for the counter console. security_invoker so RLS keeps this to the operator.';

grant select on operator_schedule to authenticated;
