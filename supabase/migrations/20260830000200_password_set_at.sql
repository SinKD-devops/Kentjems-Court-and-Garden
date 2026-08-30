-- ═══════════════════════════════════════════════════════════════════════
-- Records when a customer set a password, so the app knows whether to offer
-- one after a code sign-in.
--
-- Supabase does not expose "does this user have a password" on the session,
-- and the app needs to know it to decide whether the offer is worth showing.
--
-- This column IS read — by the sign-in path, on every code verification. That
-- is the difference between it and `is_backup_admin` (§4): a column nothing
-- consults is a trap, and this one has exactly one consumer and one writer.
--
-- It can drift in one direction only. If the operator resets a password from
-- the Supabase dashboard, the column stays null and the customer is offered
-- the screen again on their next code sign-in. Harmless: the screen sets or
-- replaces a password either way, and it is skippable.
-- ═══════════════════════════════════════════════════════════════════════

alter table profiles
  add column if not exists password_set_at timestamptz;

comment on column profiles.password_set_at is
  'When this customer last saved a password in the app. Null means never, which is what makes the app offer one after a code sign-in. Not authoritative about auth state — the Supabase dashboard can set a password without touching this.';
