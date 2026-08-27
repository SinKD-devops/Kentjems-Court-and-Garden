-- ═══════════════════════════════════════════════════════════════════════
-- Row level security
--
-- Default posture: deny. Reference data (spaces, hours, prices, packages)
-- is world-readable because the slot grid needs it before login. Booking
-- and payment rows are readable only by the person who made them, plus the
-- operator. Availability reaches anonymous visitors through the two views
-- in the previous migration, never through this table directly.
-- ═══════════════════════════════════════════════════════════════════════

-- SECURITY DEFINER so the role lookup itself is not subject to the RLS
-- policies on profiles — without this, any policy calling it recurses.
create or replace function is_operator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'operator'
  );
$$;

alter table profiles      enable row level security;
alter table spaces        enable row level security;
alter table opening_hours enable row level security;
alter table closures      enable row level security;
alter table pricing_rules enable row level security;
alter table packages      enable row level security;
alter table bookings      enable row level security;
alter table payments      enable row level security;
alter table refunds       enable row level security;
alter table booking_moves enable row level security;
alter table settings      enable row level security;

-- ── reference data: readable by everyone, written by the operator ──────

create policy spaces_read        on spaces        for select using (true);
create policy hours_read         on opening_hours for select using (true);
create policy closures_read      on closures      for select using (true);
create policy pricing_read       on pricing_rules for select using (true);
create policy packages_read      on packages      for select using (true);

create policy spaces_write       on spaces        for all using (is_operator()) with check (is_operator());
create policy hours_write        on opening_hours for all using (is_operator()) with check (is_operator());
create policy closures_write     on closures      for all using (is_operator()) with check (is_operator());
create policy pricing_write      on pricing_rules for all using (is_operator()) with check (is_operator());
create policy packages_write     on packages      for all using (is_operator()) with check (is_operator());

-- Settings carries the GCash QR path and support numbers, both of which the
-- customer app must render, so read is public. Writes are operator-only.
create policy settings_read      on settings      for select using (true);
create policy settings_write     on settings      for all using (is_operator()) with check (is_operator());

-- ── profiles ───────────────────────────────────────────────────────────

create policy profiles_read_own on profiles for select
  using (id = auth.uid() or is_operator());

create policy profiles_insert_own on profiles for insert
  with check (id = auth.uid());

-- A customer may edit their name and accept terms. Role and backup-admin
-- are NOT protected by this policy alone — see the trigger below, which is
-- what actually stops a customer from promoting themselves.
create policy profiles_update_own on profiles for update
  using (id = auth.uid() or is_operator())
  with check (id = auth.uid() or is_operator());

create or replace function guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_operator() then
    if new.role is distinct from old.role
       or new.is_backup_admin is distinct from old.is_backup_admin then
      raise exception 'insufficient privilege: role and is_backup_admin are operator-only';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_guard_privileges
  before update on profiles
  for each row execute function guard_profile_privileges();

-- ── bookings ───────────────────────────────────────────────────────────

create policy bookings_read_own on bookings for select
  using (user_id = auth.uid() or is_operator());

-- A customer may only create a booking for themselves, only in the
-- 'requested' state, and never as a walk-in. Advance-window and
-- opening-hours checks live in the application layer; status and identity
-- are enforced here because they are security-relevant.
create policy bookings_insert_own on bookings for insert
  with check (
    user_id = auth.uid()
    and status = 'requested'
    and source = 'app'
  );

-- The only transitions a customer may make on their own booking are
-- withdrawing it and submitting payment proof. Everything else — confirming,
-- rejecting, superseding, refunding — is the operator's.
create policy bookings_update_own on bookings for update
  using (user_id = auth.uid() and status in ('requested', 'proof_submitted'))
  with check (user_id = auth.uid() and status in ('proof_submitted', 'withdrawn'));

create policy bookings_operator_all on bookings for all
  using (is_operator()) with check (is_operator());

-- ── payments ───────────────────────────────────────────────────────────

create policy payments_read_own on payments for select
  using (
    is_operator()
    or exists (
      select 1 from bookings b
      where b.id = payments.booking_id and b.user_id = auth.uid()
    )
  );

create policy payments_insert_own on payments for insert
  with check (
    method = 'gcash'
    and status = 'pending'
    and exists (
      select 1 from bookings b
      where b.id = payments.booking_id and b.user_id = auth.uid()
    )
  );

create policy payments_operator_all on payments for all
  using (is_operator()) with check (is_operator());

-- ── operator-only tables ───────────────────────────────────────────────

create policy refunds_read on refunds for select
  using (
    is_operator()
    or exists (
      select 1 from bookings b
      where b.id = refunds.booking_id and b.user_id = auth.uid()
    )
  );

create policy refunds_write on refunds for all
  using (is_operator()) with check (is_operator());

create policy moves_read on booking_moves for select
  using (
    is_operator()
    or exists (
      select 1 from bookings b
      where b.id = booking_moves.booking_id and b.user_id = auth.uid()
    )
  );

create policy moves_write on booking_moves for all
  using (is_operator()) with check (is_operator());
