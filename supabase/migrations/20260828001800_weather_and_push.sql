-- ═══════════════════════════════════════════════════════════════════════
-- Weather location and web push subscriptions.
-- ═══════════════════════════════════════════════════════════════════════

-- ── where the venue is ─────────────────────────────────────────────────
-- Defaults to Butuan City. The operator should set the exact coordinates in
-- settings: a forecast for the wrong town is worse than none, because people
-- will act on it.

alter table settings
  add column if not exists latitude  numeric(9, 6),
  add column if not exists longitude numeric(9, 6);

update settings
set latitude  = coalesce(latitude, 8.947500),
    longitude = coalesce(longitude, 125.540600)
where id;

-- ── push subscriptions ─────────────────────────────────────────────────
--
-- One row per browser, not per person: someone may book from a phone and a
-- laptop, and the reminder should reach whichever they are holding.

create table if not exists push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now(),
  failed_at  timestamptz
);

create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;

create policy push_own_read on push_subscriptions for select
  using (user_id = auth.uid() or is_operator());

create policy push_own_write on push_subscriptions for insert
  with check (user_id = auth.uid());

create policy push_own_delete on push_subscriptions for delete
  using (user_id = auth.uid() or is_operator());

-- ── expiry reminders ───────────────────────────────────────────────────
--
-- Which requests are close enough to expiry to warrant a nudge, and have not
-- been nudged already. Marking the booking is what stops a customer being
-- reminded once a minute for the last ten minutes of their window.

alter table bookings
  add column if not exists expiry_reminded_at timestamptz;

create or replace function requests_needing_reminder(p_minutes integer default 10)
returns table (
  booking_id uuid,
  user_id    uuid,
  space_name text,
  starts_at  timestamptz,
  ends_at    timestamptz,
  expires_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select b.id, b.user_id, s.name, b.starts_at, b.ends_at, b.expires_at
  from bookings b
  join spaces s on s.id = b.space_id
  where b.status = 'requested'
    and b.user_id is not null
    and b.expiry_reminded_at is null
    and b.expires_at > now()
    and b.expires_at <= now() + make_interval(mins => p_minutes);
$$;

create or replace function mark_expiry_reminded(p_booking_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update bookings set expiry_reminded_at = now() where id = any(p_booking_ids);
$$;

revoke all on function requests_needing_reminder(integer) from public, anon, authenticated;
revoke all on function mark_expiry_reminded(uuid[]) from public, anon, authenticated;

comment on function requests_needing_reminder(integer) is
  'Requests close to expiry that have not been reminded yet. Called by the reminder job using the secret key; never reachable by a customer.';
