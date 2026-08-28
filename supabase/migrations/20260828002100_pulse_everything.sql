-- ═══════════════════════════════════════════════════════════════════════
-- Make the pulse cover payments and refunds, not just bookings.
--
-- availability_pulse existed for the customer slot grid, so only bookings
-- bumped it. Most operator-facing changes do touch a booking as well — an
-- approval sets both rows — but not all of them: settling a refund only
-- writes to `refunds`, so the refunds screen would sit stale.
--
-- Anything the operator or a customer is watching should move on its own.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function bump_pulse_from_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space uuid;
begin
  select space_id into v_space
  from bookings
  where id = coalesce(new.booking_id, old.booking_id);

  if v_space is not null then
    insert into availability_pulse (space_id, revision, changed_at)
    values (v_space, 1, now())
    on conflict (space_id) do update
      set revision = availability_pulse.revision + 1,
          changed_at = now();
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists payments_bump_pulse on payments;
create trigger payments_bump_pulse
  after insert or update or delete on payments
  for each row execute function bump_pulse_from_booking();

drop trigger if exists refunds_bump_pulse on refunds;
create trigger refunds_bump_pulse
  after insert or update or delete on refunds
  for each row execute function bump_pulse_from_booking();

comment on function bump_pulse_from_booking() is
  'Bumps the availability pulse from a row that references a booking, so payment and refund changes reach watching screens the same way booking changes do.';
