-- ═══════════════════════════════════════════════════════════════════════
-- Garden becomes hourly, plus moving, refunding, and reporting.
-- ═══════════════════════════════════════════════════════════════════════

-- ── garden: hourly at PHP 250 / PHP 350 ────────────────────────────────
-- Packages are retired rather than deleted: they are referenced by
-- bookings.package_id, and dropping them would break any history.

update spaces set mode = 'hourly' where slug = 'garden';
update packages set is_active = false;

delete from pricing_rules where space_id = (select id from spaces where slug = 'garden');

insert into pricing_rules (space_id, day_of_week, starts_at_time, ends_at_time, price_centavos, label)
select id, null::integer, '06:00'::time, '18:00'::time, 25000, 'Daytime' from spaces where slug = 'garden'
union all
select id, null::integer, '18:00'::time, '24:00'::time, 35000, 'Evening' from spaces where slug = 'garden';

-- ── moving a booking ───────────────────────────────────────────────────
--
-- The pressure valve for a no-cancellation policy. The price does NOT change
-- when a booking moves: someone who paid PHP 60 for a morning hour and is
-- moved to the evening at the operator's convenience should not be billed the
-- difference, and the reverse would mean owing them money.

create or replace function move_booking(
  p_booking_id uuid,
  p_starts_at  timestamptz,
  p_hours      integer,
  p_reason     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
  v_space   spaces%rowtype;
  v_hours   opening_hours%rowtype;
  v_local   timestamp;
  v_date    date;
  v_opens   timestamptz;
  v_closes  timestamptz;
  v_ends_at timestamptz;
begin
  if not is_operator() then
    raise exception 'Only the operator can move a booking.' using errcode = '42501';
  end if;

  if p_hours is null or p_hours < 1 or p_hours > 12 then
    raise exception 'Choose between 1 and 12 hours.' using errcode = '22023';
  end if;

  select * into v_booking from bookings where id = p_booking_id for update;
  if not found or v_booking.status not in ('requested', 'proof_submitted', 'confirmed') then
    raise exception 'That booking cannot be moved.' using errcode = '22023';
  end if;

  select * into v_space from spaces where id = v_booking.space_id;

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
    raise exception 'The % is closed at that time.', lower(v_space.name) using errcode = '22023';
  end if;

  insert into booking_moves (
    booking_id, from_starts_at, from_ends_at, to_starts_at, to_ends_at, moved_by, reason
  )
  values (
    p_booking_id, v_booking.starts_at, v_booking.ends_at, p_starts_at, v_ends_at,
    auth.uid(), nullif(trim(p_reason), '')
  );

  update bookings set starts_at = p_starts_at, ends_at = v_ends_at where id = p_booking_id;

  return jsonb_build_object(
    'space', v_space.name,
    'phone', v_booking.contact_phone,
    'from_starts_at', v_booking.starts_at, 'from_ends_at', v_booking.ends_at,
    'to_starts_at', p_starts_at, 'to_ends_at', v_ends_at
  );
exception
  when exclusion_violation then
    raise exception 'That time is already booked.' using errcode = '22023';
end;
$$;

revoke all on function move_booking(uuid, timestamptz, integer, text) from public, anon;
grant execute on function move_booking(uuid, timestamptz, integer, text) to authenticated;

-- ── refunds ────────────────────────────────────────────────────────────
--
-- Only for weather and power interruptions, approved by the operator. The
-- money goes back in cash at the store, so settled_at stays null until it
-- physically happens — the console can then show what is still owed.

create or replace function approve_refund(
  p_booking_id uuid,
  p_reason     text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
  v_space   text;
begin
  if not is_operator() then
    raise exception 'Only the operator can approve refunds.' using errcode = '42501';
  end if;

  select * into v_booking from bookings where id = p_booking_id for update;
  if not found or v_booking.status <> 'confirmed' then
    raise exception 'Only a paid booking can be refunded.' using errcode = '22023';
  end if;

  select name into v_space from spaces where id = v_booking.space_id;

  update bookings set status = 'cancelled_refunded' where id = p_booking_id;

  insert into refunds (booking_id, amount_centavos, reason, approved_by)
  values (p_booking_id, v_booking.price_centavos, p_reason, auth.uid());

  return jsonb_build_object(
    'space', v_space, 'phone', v_booking.contact_phone,
    'amount_centavos', v_booking.price_centavos,
    'starts_at', v_booking.starts_at, 'ends_at', v_booking.ends_at
  );
end;
$$;

create or replace function settle_refund(p_refund_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_operator() then
    raise exception 'Only the operator can settle refunds.' using errcode = '42501';
  end if;

  update refunds set settled_at = now() where id = p_refund_id and settled_at is null;
  if not found then
    raise exception 'That refund is already settled.' using errcode = '22023';
  end if;
end;
$$;

revoke all on function approve_refund(uuid, text) from public, anon;
revoke all on function settle_refund(uuid) from public, anon;
grant execute on function approve_refund(uuid, text) to authenticated;
grant execute on function settle_refund(uuid) to authenticated;

-- ── reporting ──────────────────────────────────────────────────────────
--
-- One row per booked HOUR rather than per booking. A three-hour booking
-- occupies three hours, and counting it once would understate occupancy and
-- misprice the evening. Revenue per hour comes from the pricing rules rather
-- than dividing the total, so a booking spanning the rate boundary is
-- attributed correctly.

create or replace view booked_hours
with (security_invoker = on) as
  select
    b.id                                  as booking_id,
    b.space_id,
    s.slug                                as space_slug,
    s.name                                as space_name,
    hour_start,
    (hour_start at time zone 'Asia/Manila')::date            as local_date,
    extract(hour from hour_start at time zone 'Asia/Manila')::integer as local_hour,
    coalesce(price_centavos_for(b.space_id, hour_start), 0)  as centavos,
    b.status,
    b.source
  from bookings b
  join spaces s on s.id = b.space_id
  cross join lateral generate_series(
    b.starts_at, b.ends_at - interval '1 hour', interval '1 hour'
  ) as hour_start
  where b.status in ('confirmed', 'completed');

comment on view booked_hours is
  'One row per booked hour. A three-hour booking produces three rows, so occupancy is not understated and revenue is attributed to the hour that earned it.';

create or replace view revenue_by_day
with (security_invoker = on) as
  select
    local_date,
    space_slug,
    space_name,
    count(*)::integer                                        as hours_sold,
    sum(centavos)::integer                                   as centavos,
    sum(centavos) filter (where local_hour < 18)::integer    as daytime_centavos,
    sum(centavos) filter (where local_hour >= 18)::integer   as evening_centavos,
    count(*) filter (where source = 'walk_in')::integer      as walk_in_hours
  from booked_hours
  group by local_date, space_slug, space_name;

create or replace view occupancy_by_hour
with (security_invoker = on) as
  select
    space_slug,
    space_name,
    local_hour,
    count(*)::integer      as hours_sold,
    sum(centavos)::integer as centavos
  from booked_hours
  group by space_slug, space_name, local_hour;

grant select on booked_hours, revenue_by_day, occupancy_by_hour to authenticated;

-- ── outstanding refunds ────────────────────────────────────────────────

create or replace view refunds_owed
with (security_invoker = on) as
  select
    r.id,
    r.booking_id,
    r.amount_centavos,
    r.reason,
    r.created_at,
    s.name          as space_name,
    b.starts_at,
    b.ends_at,
    b.contact_name,
    b.contact_phone
  from refunds r
  join bookings b on b.id = r.booking_id
  join spaces s on s.id = b.space_id
  where r.settled_at is null;

comment on view refunds_owed is
  'Approved refunds where the cash has not yet been handed back. Money owed should not depend on the operator remembering.';

grant select on refunds_owed to authenticated;
