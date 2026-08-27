-- The unique index on reference_number covered every payment, rejected ones
-- included. A customer rejected for an unreadable screenshot could therefore
-- never resubmit: their own genuine reference was permanently locked, and the
-- only way forward was a second real payment.
--
-- Rejected payments no longer hold the reference. Pending and approved ones
-- still do, so the protection that matters — one payment cannot be claimed
-- against two live bookings — is unchanged.
--
-- A reference reappearing after a rejection is worth a second look rather
-- than a refusal, and the review queue already flags exactly that.

drop index if exists payments_reference_unique;

create unique index payments_reference_unique
  on payments (reference_number)
  where reference_number is not null and status <> 'rejected';

comment on index payments_reference_unique is
  'One live claim per payment reference. Rejected payments are excluded so a customer can resubmit a genuine reference after a mistaken rejection.';
