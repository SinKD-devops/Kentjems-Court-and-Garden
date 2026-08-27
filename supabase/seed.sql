-- ═══════════════════════════════════════════════════════════════════════
-- Seed data — Kentjems Court and Garden
-- Idempotent: safe to run repeatedly.
-- ═══════════════════════════════════════════════════════════════════════

insert into spaces (slug, name, mode, advance_days, max_open_requests, sort_order)
values
  ('court',  'Court',  'hourly',   7, 1, 0),
  ('garden', 'Garden', 'package', 30, 1, 1)
on conflict (slug) do update
  set name              = excluded.name,
      mode              = excluded.mode,
      advance_days      = excluded.advance_days,
      max_open_requests = excluded.max_open_requests;

-- ── opening hours: 6am to midnight, every day, both spaces ─────────────
-- '24:00' is a valid time literal in Postgres and is what "midnight at the
-- END of the day" must be written as. '00:00' would mean the start.

delete from opening_hours
where space_id in (select id from spaces where slug in ('court', 'garden'));

insert into opening_hours (space_id, day_of_week, opens_at, closes_at)
select id, null, '06:00', '24:00' from spaces where slug in ('court', 'garden');

-- ── court pricing ──────────────────────────────────────────────────────
--   Daytime  06:00–18:00  →  PHP 60   (12 slots: 6am through the 5pm start)
--   Evening  18:00–24:00  →  PHP 100  ( 6 slots: 6pm through the 11pm start)
-- Boundaries are half-open [start, end) so 17:59 is day and 18:00 is evening.

delete from pricing_rules where space_id = (select id from spaces where slug = 'court');

insert into pricing_rules (space_id, day_of_week, starts_at_time, ends_at_time, price_centavos, label)
select id, null, '06:00', '18:00',  6000, 'Daytime' from spaces where slug = 'court'
union all
select id, null, '18:00', '24:00', 10000, 'Evening' from spaces where slug = 'court';

-- ── garden packages ────────────────────────────────────────────────────
-- The operator adds more of these in admin. This is the first real one.

insert into packages (space_id, name, duration_minutes, price_centavos, sort_order)
select id, 'Birthday', 240, 75000, 0 from spaces where slug = 'garden'
on conflict do nothing;

-- ── settings ───────────────────────────────────────────────────────────

insert into settings (
  id, request_expiry_minutes,
  gcash_window_opens_at, gcash_window_closes_at, last_submission_time,
  support_numbers
)
values (
  true, 30,
  '06:00', '23:00', '22:30',
  array['0950 236 1590', '0995 819 2317']
)
on conflict (id) do update
  set request_expiry_minutes = excluded.request_expiry_minutes,
      gcash_window_opens_at  = excluded.gcash_window_opens_at,
      gcash_window_closes_at = excluded.gcash_window_closes_at,
      last_submission_time   = excluded.last_submission_time,
      support_numbers        = excluded.support_numbers;
