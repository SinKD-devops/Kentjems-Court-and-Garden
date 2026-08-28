-- ═══════════════════════════════════════════════════════════════════════
-- Remove web push.
--
-- SMS is the notification channel. Push was only ever wired to one event —
-- the T-10-minute expiry reminder — while every message where money has
-- moved already went out by SMS alone. The owner chose to drop the reminder
-- rather than convert it to SMS: at roughly a third of total message volume
-- it was the most expensive notification in the system and the least tied to
-- a payment.
--
-- Everything here goes, including `bookings.expiry_reminded_at`. Leaving a
-- column nothing reads is how `is_backup_admin` came to look like a privilege
-- it never granted (see HANDOVER §4) — an unused column is a trap, not a
-- spare part. Booking history is untouched: the column recorded only whether
-- a nudge had been sent.
-- ═══════════════════════════════════════════════════════════════════════

-- ── stop the scheduled call first ──────────────────────────────────────
-- Unschedule before dropping the function it calls, or a job fires every
-- minute against something that no longer exists.

do $$
begin
  perform cron.unschedule('expiry-reminders');
exception when others then
  raise notice 'Could not unschedule expiry reminders (%).', sqlerrm;
end;
$$;

drop function if exists trigger_expiry_reminders();
drop function if exists requests_needing_reminder(integer);
drop function if exists mark_expiry_reminded(uuid[]);

drop table if exists push_subscriptions;

alter table bookings drop column if exists expiry_reminded_at;
