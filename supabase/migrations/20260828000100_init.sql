-- ═══════════════════════════════════════════════════════════════════════
-- Kentjems Court and Garden — initial schema
--
-- Design notes that matter:
--   * All timestamps are timestamptz, stored UTC, rendered Asia/Manila.
--     Pricing boundaries are evaluated in Manila time, never UTC.
--   * Money is INTEGER CENTAVOS everywhere. Never floats.
--   * Double-booking is prevented by a Postgres EXCLUSION CONSTRAINT, not by
--     application code. Requests are allowed to overlap; only live bookings
--     (confirmed / proof_submitted) are exclusive.
-- ═══════════════════════════════════════════════════════════════════════

create extension if not exists btree_gist;

-- ── enums ──────────────────────────────────────────────────────────────

create type space_mode as enum ('hourly', 'package');

create type booking_status as enum (
  'requested',          -- created in app, NOT held, expires
  'proof_submitted',    -- GCash proof sent — slot IS held pending review
  'confirmed',          -- paid and approved
  'completed',          -- slot has passed
  'expired',            -- request timed out unpaid
  'withdrawn',          -- customer cancelled their own request
  'superseded',         -- someone else paid for this slot first
  'rejected',           -- operator rejected the payment proof
  'cancelled_refunded'  -- force majeure: weather / power, refunded
);

create type booking_source  as enum ('app', 'walk_in');
create type payment_method  as enum ('cash', 'gcash');
create type payment_status  as enum ('pending', 'approved', 'rejected');
create type user_role       as enum ('customer', 'operator');

-- ── spaces ─────────────────────────────────────────────────────────────

create table spaces (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique,
  name               text not null,
  mode               space_mode not null,
  advance_days       integer not null,
  max_open_requests  integer not null default 1,
  is_active          boolean not null default true,
  sort_order         integer not null default 0,
  created_at         timestamptz not null default now(),
  constraint advance_days_positive      check (advance_days > 0),
  constraint max_open_requests_positive check (max_open_requests > 0)
);

comment on column spaces.advance_days is
  'How far ahead this space can be booked. Court 7, Garden 30 — deliberately different.';

-- ── profiles ───────────────────────────────────────────────────────────

create table profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  phone             text not null unique,
  full_name         text,
  role              user_role not null default 'customer',
  is_backup_admin   boolean not null default false,
  accepted_terms_at timestamptz,
  created_at        timestamptz not null default now()
);

comment on column profiles.is_backup_admin is
  'Second operator-capable account. A single-operator business logged in by phone OTP is one lost SIM away from being unable to trade.';

-- ── opening hours, closures, pricing, packages ─────────────────────────

create table opening_hours (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references spaces (id) on delete cascade,
  day_of_week integer,          -- 0=Sunday .. 6=Saturday. NULL = every day.
  opens_at    time not null,
  closes_at   time not null,
  constraint dow_range   check (day_of_week is null or day_of_week between 0 and 6),
  constraint hours_order check (closes_at > opens_at)
);

create table closures (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references spaces (id) on delete cascade,
  during     tstzrange not null,
  reason     text not null,
  created_at timestamptz not null default now(),
  constraint closure_not_empty check (not isempty(during))
);

create index closures_space_during_idx on closures using gist (space_id, during);

create table pricing_rules (
  id             uuid primary key default gen_random_uuid(),
  space_id       uuid not null references spaces (id) on delete cascade,
  day_of_week    integer,       -- NULL = every day
  starts_at_time time not null,
  ends_at_time   time not null,
  price_centavos integer not null,
  label          text,
  constraint pricing_dow_range check (day_of_week is null or day_of_week between 0 and 6),
  constraint pricing_order     check (ends_at_time > starts_at_time),
  constraint pricing_positive  check (price_centavos >= 0)
);

create table packages (
  id               uuid primary key default gen_random_uuid(),
  space_id         uuid not null references spaces (id) on delete cascade,
  name             text not null,
  duration_minutes integer not null,
  price_centavos   integer not null,
  is_active        boolean not null default true,
  sort_order       integer not null default 0,
  constraint package_duration_positive check (duration_minutes > 0),
  constraint package_price_positive    check (price_centavos >= 0)
);

-- ── bookings ───────────────────────────────────────────────────────────

create table bookings (
  id             uuid primary key default gen_random_uuid(),
  space_id       uuid not null references spaces (id) on delete restrict,
  user_id        uuid references profiles (id) on delete set null,
  package_id     uuid references packages (id) on delete set null,

  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  status         booking_status not null default 'requested',
  price_centavos integer not null,
  source         booking_source not null default 'app',

  -- walk-ins have no account; app bookings copy these from the profile
  contact_name   text,
  contact_phone  text,

  -- garden only
  event_type     text,
  needs_tables   boolean not null default false,
  needs_sound    boolean not null default false,

  expires_at     timestamptz,   -- only meaningful while status = 'requested'
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint booking_time_order   check (ends_at > starts_at),
  constraint booking_price_valid  check (price_centavos >= 0),
  constraint booking_has_contact  check (user_id is not null or contact_phone is not null)
);

-- ═══════════════════════════════════════════════════════════════════════
-- THE GUARD.
--
-- Two people may REQUEST the same slot — that is the whole point of the
-- race-to-pay design. But only one booking can ever be live for a given
-- range in a given space. Enforced by Postgres so it holds under
-- concurrency, which application-level checks cannot do.
-- ═══════════════════════════════════════════════════════════════════════
alter table bookings add constraint no_live_overlap
  exclude using gist (
    space_id                        with =,
    tstzrange(starts_at, ends_at)   with &&
  ) where (status in ('confirmed', 'proof_submitted'));

-- One open request per user PER SPACE. A pending garden event must not
-- block a court booking, so space_id is part of the key.
create unique index one_open_request_per_space
  on bookings (user_id, space_id)
  where status in ('requested', 'proof_submitted') and user_id is not null;

create index bookings_space_starts_idx on bookings (space_id, starts_at);
create index bookings_status_idx       on bookings (status);
create index bookings_user_idx         on bookings (user_id);
create index bookings_expiry_idx       on bookings (expires_at) where status = 'requested';

-- ── payments ───────────────────────────────────────────────────────────

create table payments (
  id               uuid primary key default gen_random_uuid(),
  booking_id       uuid not null references bookings (id) on delete cascade,
  method           payment_method not null,
  amount_centavos  integer not null,
  reference_number text,          -- GCash 13-digit reference. NULL for cash.
  sender_name      text,
  proof_path       text,          -- Supabase Storage object path, private bucket
  status           payment_status not null default 'pending',
  submitted_at     timestamptz not null default now(),
  reviewed_at      timestamptz,
  reviewed_by      uuid references profiles (id) on delete set null,
  reject_reason    text,
  constraint payment_amount_positive check (amount_centavos >= 0),
  constraint gcash_needs_reference
    check (method <> 'gcash' or reference_number is not null)
);

-- The anti-fraud measure that does the most work: one GCash payment can
-- never be claimed against two bookings.
create unique index payments_reference_unique
  on payments (reference_number)
  where reference_number is not null;

create index payments_booking_idx on payments (booking_id);
create index payments_pending_idx on payments (status) where status = 'pending';

-- ── refunds, moves ─────────────────────────────────────────────────────

create table refunds (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid not null references bookings (id) on delete cascade,
  amount_centavos integer not null,
  reason          text not null,   -- 'rain', 'power', 'collision', 'other'
  approved_by     uuid references profiles (id) on delete set null,
  settled_at      timestamptz,     -- NULL until cash is actually handed back
  created_at      timestamptz not null default now(),
  constraint refund_amount_positive check (amount_centavos >= 0)
);

create table booking_moves (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid not null references bookings (id) on delete cascade,
  from_starts_at  timestamptz not null,
  from_ends_at    timestamptz not null,
  to_starts_at    timestamptz not null,
  to_ends_at      timestamptz not null,
  moved_by        uuid references profiles (id) on delete set null,
  reason          text,
  moved_at        timestamptz not null default now()
);

-- ── settings (singleton) ───────────────────────────────────────────────

create table settings (
  id                      boolean primary key default true,
  request_expiry_minutes  integer not null default 30,
  gcash_window_opens_at   time not null default '06:00',
  gcash_window_closes_at  time not null default '23:00',
  last_submission_time    time not null default '22:30',
  support_numbers         text[] not null default '{}',
  gcash_qr_path           text,
  updated_at              timestamptz not null default now(),
  constraint settings_singleton     check (id),
  constraint expiry_positive        check (request_expiry_minutes > 0),
  constraint gcash_window_order     check (gcash_window_closes_at > gcash_window_opens_at),
  constraint submission_within_window
    check (last_submission_time <= gcash_window_closes_at)
);

-- ── helpers ────────────────────────────────────────────────────────────

-- Price for an hourly slot. Evaluated in MANILA time — the 18:00 rate
-- boundary is a local-clock fact, and evaluating it in UTC silently prices
-- the entire evening at the day rate.
create or replace function price_centavos_for(p_space_id uuid, p_starts_at timestamptz)
returns integer
language sql
stable
as $$
  select pr.price_centavos
  from pricing_rules pr
  where pr.space_id = p_space_id
    and (pr.day_of_week is null
         or pr.day_of_week = extract(dow from p_starts_at at time zone 'Asia/Manila')::integer)
    and (p_starts_at at time zone 'Asia/Manila')::time >= pr.starts_at_time
    and (p_starts_at at time zone 'Asia/Manila')::time <  pr.ends_at_time
  order by pr.day_of_week nulls last
  limit 1;
$$;

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger bookings_touch_updated_at
  before update on bookings
  for each row execute function touch_updated_at();

-- ── availability views ─────────────────────────────────────────────────
--
-- The slot grid must show WHICH slots are gone without revealing WHO holds
-- them. These views expose ranges and counts only — no names, no phone
-- numbers, no user ids. They intentionally run with definer rights so the
-- underlying bookings table can stay locked down by RLS.

create view public_availability
with (security_invoker = off) as
  select
    space_id,
    starts_at,
    ends_at,
    case when status = 'confirmed' then 'booked' else 'pending_review' end as state
  from bookings
  where status in ('confirmed', 'proof_submitted');

comment on view public_availability is
  'Taken ranges with no identifying columns. Definer rights are deliberate: anonymous visitors must see availability without read access to bookings.';

create view slot_demand
with (security_invoker = off) as
  select
    space_id,
    starts_at,
    ends_at,
    count(*)::integer as waiting
  from bookings
  where status = 'requested'
    and expires_at > now()
  group by space_id, starts_at, ends_at;

comment on view slot_demand is
  'Live unpaid requests per slot — drives the "2 waiting" contested state. Expired requests are excluded by the WHERE clause, so a stale cron sweep never shows a wrong count.';

grant select on public_availability, slot_demand to anon, authenticated;
