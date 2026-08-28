-- ═══════════════════════════════════════════════════════════════════════
-- Tell the people who lost the slot.
--
-- approve_payment already supersedes every other request for the same time,
-- which is correct — only one booking can be live. But it returned nothing,
-- so the app had no way to know who had just been bumped, and those
-- customers were never told.
--
-- The consequence is concrete: their request is free, so they have no
-- feedback loop except walking to Kentjems Store to pay for a court that is
-- already gone. That message is the whole reason the race-to-pay design is
-- tolerable.
--
-- Confirming now returns the superseded bookings so the caller can send it.
-- ═══════════════════════════════════════════════════════════════════════

drop function if exists approve_payment(uuid);

create or replace function approve_payment(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
  v_space   text;
  v_lost    jsonb;
begin
  if not is_operator() then
    raise exception 'Only the operator can approve payments.' using errcode = '42501';
  end if;

  select * into v_booking from bookings where id = p_booking_id for update;
  if not found or v_booking.status <> 'proof_submitted' then
    raise exception 'That booking is not awaiting review.' using errcode = '22023';
  end if;

  select name into v_space from spaces where id = v_booking.space_id;

  update bookings set status = 'confirmed' where id = p_booking_id;

  update payments
  set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
  where booking_id = p_booking_id and status = 'pending';

  with bumped as (
    update bookings
    set status = 'superseded'
    where space_id = v_booking.space_id
      and id <> p_booking_id
      and status = 'requested'
      and tstzrange(starts_at, ends_at) && tstzrange(v_booking.starts_at, v_booking.ends_at)
    returning id, contact_phone, starts_at, ends_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'phone', contact_phone, 'starts_at', starts_at, 'ends_at', ends_at
  )), '[]'::jsonb)
  into v_lost
  from bumped;

  return jsonb_build_object('space', v_space, 'superseded', v_lost);
end;
$$;

revoke all on function approve_payment(uuid) from public, anon;
grant execute on function approve_payment(uuid) to authenticated;

comment on function approve_payment(uuid) is
  'Confirms a reviewed payment and supersedes competing requests. Returns the superseded bookings so the caller can notify them — being bumped silently means walking to the store for a slot that is gone.';

-- Confirming a cash payment at the counter has exactly the same consequence
-- for everyone else chasing that slot, so it shares the behaviour.
create or replace function confirm_cash_payment(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
  v_space   text;
  v_lost    jsonb;
begin
  if not is_operator() then
    raise exception 'Only the operator can confirm payments.' using errcode = '42501';
  end if;

  select * into v_booking from bookings where id = p_booking_id for update;
  if not found or v_booking.status not in ('requested', 'proof_submitted') then
    raise exception 'That booking cannot be confirmed.' using errcode = '22023';
  end if;

  select name into v_space from spaces where id = v_booking.space_id;

  update bookings set status = 'confirmed', expires_at = null where id = p_booking_id;

  insert into payments (booking_id, method, amount_centavos, status, reviewed_at, reviewed_by)
  values (p_booking_id, 'cash', v_booking.price_centavos, 'approved', now(), auth.uid());

  with bumped as (
    update bookings
    set status = 'superseded'
    where space_id = v_booking.space_id
      and id <> p_booking_id
      and status = 'requested'
      and tstzrange(starts_at, ends_at) && tstzrange(v_booking.starts_at, v_booking.ends_at)
    returning id, contact_phone, starts_at, ends_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'phone', contact_phone, 'starts_at', starts_at, 'ends_at', ends_at
  )), '[]'::jsonb)
  into v_lost
  from bumped;

  return jsonb_build_object('space', v_space, 'superseded', v_lost);
end;
$$;

revoke all on function confirm_cash_payment(uuid) from public, anon;
grant execute on function confirm_cash_payment(uuid) to authenticated;

comment on function confirm_cash_payment(uuid) is
  'Records cash received at the counter and confirms the booking, superseding competing requests the same way an approved online payment does.';
