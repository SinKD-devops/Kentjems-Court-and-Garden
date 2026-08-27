-- ═══════════════════════════════════════════════════════════════════════
-- Online payment: proof submission and operator review.
--
-- Payment is by InstaPay / QR Ph, which is scannable from GCash, Maya and
-- most bank apps — so the flow is not tied to one wallet.
--
-- A screenshot is a CLAIM, not proof. It can be faked in a minute, and the
-- app cannot tell. Only the operator can, against their own transaction
-- history. The system's job is to make that check fast and to make fraud
-- detectable, which is what the typed reference number is for: it carries a
-- unique index, so one payment can never be claimed against two bookings.
--
-- Unlike the cash path, submitting proof HOLDS the slot. Money has actually
-- left the customer's account by then, and there is no refund API here — an
-- unwanted refund means the owner sending it back by hand.
-- ═══════════════════════════════════════════════════════════════════════

alter table settings
  add column if not exists payee_name      text,
  add column if not exists payee_number    text,
  add column if not exists payment_qr_path text;

update settings set
  payee_name      = 'Lordes Cubillas',
  payee_number    = '0950 236 1590',
  payment_qr_path = '/payment-qr.jpg'
where id;

-- ── proof storage ──────────────────────────────────────────────────────
-- Private bucket. Screenshots carry financial details and must never be
-- world-readable.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Customers write only into a folder named after their own user id, so one
-- customer can never overwrite or read another's screenshot.
create policy "own proof upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "own proof read" on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and ((storage.foldername(name))[1] = auth.uid()::text or is_operator())
  );

-- ── submit proof ───────────────────────────────────────────────────────

create or replace function submit_payment_proof(
  p_booking_id  uuid,
  p_reference   text,
  p_amount      integer,
  p_sender_name text,
  p_proof_path  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user     uuid := auth.uid();
  v_booking  bookings%rowtype;
  v_settings settings%rowtype;
  v_now      time;
begin
  if v_user is null then
    raise exception 'You need to sign in first.' using errcode = '28000';
  end if;

  select * into v_settings from settings limit 1;
  v_now := (now() at time zone 'Asia/Manila')::time;

  -- Outside the review window there is nobody to approve it, and a slot held
  -- overnight on an unchecked payment is exactly what this design avoids.
  if v_now < v_settings.gcash_window_opens_at or v_now > v_settings.last_submission_time then
    raise exception 'Online payment is open % to %. Pay at Kentjems Store instead.',
      to_char(v_settings.gcash_window_opens_at, 'HH12:MI AM'),
      to_char(v_settings.last_submission_time, 'HH12:MI AM')
      using errcode = '22023';
  end if;

  select * into v_booking from bookings
  where id = p_booking_id and user_id = v_user
  for update;

  if not found then
    raise exception 'Booking not found.' using errcode = '22023';
  end if;

  if v_booking.status <> 'requested' or v_booking.expires_at <= now() then
    raise exception 'That request has already expired. Please book again.'
      using errcode = '22023';
  end if;

  if p_reference is null or length(trim(p_reference)) < 6 then
    raise exception 'Enter the reference number from your payment receipt.'
      using errcode = '22023';
  end if;

  if p_amount is distinct from v_booking.price_centavos then
    raise exception 'The amount must be exactly %.',
      to_char(v_booking.price_centavos / 100.0, 'FM999999.00')
      using errcode = '22023';
  end if;

  insert into payments (
    booking_id, method, amount_centavos, reference_number,
    sender_name, proof_path, status
  )
  values (
    p_booking_id, 'gcash', p_amount, regexp_replace(trim(p_reference), '\s', '', 'g'),
    nullif(trim(p_sender_name), ''), p_proof_path, 'pending'
  );

  -- Submitting proof holds the slot. The exclusion constraint decides
  -- whether that is still possible.
  update bookings
  set status = 'proof_submitted', expires_at = null
  where id = p_booking_id;

exception
  when unique_violation then
    raise exception 'That reference number has already been used for another booking.'
      using errcode = '22023';
  when exclusion_violation then
    raise exception 'Someone paid for that time first. Contact Kentjems Store for a refund.'
      using errcode = '22023';
end;
$$;

revoke all on function submit_payment_proof(uuid, text, integer, text, text) from public, anon;
grant execute on function submit_payment_proof(uuid, text, integer, text, text) to authenticated;

-- ── operator review ────────────────────────────────────────────────────

create or replace function approve_payment(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
begin
  if not is_operator() then
    raise exception 'Only the operator can approve payments.' using errcode = '42501';
  end if;

  select * into v_booking from bookings where id = p_booking_id for update;
  if not found or v_booking.status <> 'proof_submitted' then
    raise exception 'That booking is not awaiting review.' using errcode = '22023';
  end if;

  update bookings set status = 'confirmed' where id = p_booking_id;

  update payments
  set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
  where booking_id = p_booking_id and status = 'pending';

  -- Everyone else still chasing this time has lost it. Telling them now is
  -- the difference between picking another hour and walking to the store for
  -- nothing.
  update bookings
  set status = 'superseded'
  where space_id = v_booking.space_id
    and id <> p_booking_id
    and status = 'requested'
    and tstzrange(starts_at, ends_at) && tstzrange(v_booking.starts_at, v_booking.ends_at);
end;
$$;

create or replace function reject_payment(p_booking_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_operator() then
    raise exception 'Only the operator can reject payments.' using errcode = '42501';
  end if;

  update payments
  set status = 'rejected', reviewed_at = now(),
      reviewed_by = auth.uid(), reject_reason = p_reason
  where booking_id = p_booking_id and status = 'pending';

  update bookings set status = 'rejected'
  where id = p_booking_id and status = 'proof_submitted';

  if not found then
    raise exception 'That booking is not awaiting review.' using errcode = '22023';
  end if;
end;
$$;

revoke all on function approve_payment(uuid) from public, anon;
revoke all on function reject_payment(uuid, text) from public, anon;
grant execute on function approve_payment(uuid) to authenticated;
grant execute on function reject_payment(uuid, text) to authenticated;

-- ── review queue ───────────────────────────────────────────────────────
--
-- Surfaces the two checks worth making before opening the screenshot: is the
-- amount right, and has this reference been claimed before. Most fraud is
-- caught here without squinting at an image.

create or replace view payment_review_queue
with (security_invoker = on) as
  select
    b.id            as booking_id,
    p.id            as payment_id,
    s.name          as space_name,
    b.starts_at,
    b.ends_at,
    b.price_centavos          as expected_centavos,
    p.amount_centavos         as claimed_centavos,
    p.reference_number,
    p.sender_name,
    p.proof_path,
    p.submitted_at,
    b.contact_name,
    b.contact_phone,
    (p.amount_centavos <> b.price_centavos) as amount_mismatch,
    exists (
      select 1 from payments other
      where other.reference_number = p.reference_number
        and other.id <> p.id
    ) as duplicate_reference
  from bookings b
  join payments p on p.booking_id = b.id and p.status = 'pending'
  join spaces  s on s.id = b.space_id
  where b.status = 'proof_submitted'
  order by p.submitted_at;

comment on view payment_review_queue is
  'Payments awaiting operator review, with amount mismatches and reused reference numbers flagged. security_invoker so RLS still limits this to the operator.';

grant select on payment_review_queue to authenticated;
