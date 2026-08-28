import { createReadClient } from "@/lib/supabase/server";
import { type HourForecast, getForecast } from "@/lib/weather";
import {
  type DateKey,
  addDays,
  dayOfWeek,
  endOfDay,
  formatTime,
  instantAt,
  startOfDay,
  timeToMinutes,
  todayKey,
} from "@/lib/time";

/**
 * Availability engine.
 *
 * Availability is DERIVED, never stored: opening hours for the date, minus
 * closures, minus live bookings. Computing it means a slot can never be stale
 * in the database, and there is no cache to invalidate when the operator
 * confirms a payment.
 *
 * Requests deliberately do not remove a slot from sale — they only mark it
 * contested. That is the race-to-pay design: until someone actually pays,
 * the slot belongs to nobody.
 */

export type SlotState =
  | "available"
  | "contested"
  | "pending_review"
  | "booked"
  | "closed"
  | "past";

export interface Slot {
  startsAt: string;
  endsAt: string;
  label: string;
  endLabel: string;
  priceCentavos: number | null;
  state: SlotState;
  rainChance: number | null;
  waiting: number;
}

export interface PriceBand {
  label: string;
  priceCentavos: number;
  slots: Slot[];
}

export interface Space {
  id: string;
  slug: string;
  name: string;
  mode: "hourly" | "package";
  advanceDays: number;
}

export interface Package {
  id: string;
  name: string;
  durationMinutes: number;
  priceCentavos: number;
}

export interface DayAvailability {
  space: Space;
  date: DateKey;
  bands: PriceBand[];
  packages: Package[];
  /** Ranges already taken that day — what the garden shows instead of a grid. */
  taken: { startsAt: string; endsAt: string; state: SlotState }[];
  closedReason: string | null;
  /** Always present when a forecast loaded, so "no warning" is legible as
      "checked, and it is fine" rather than a broken feature. */
  rainOutlook: { peak: number; atLabel: string } | null;
}

interface PricingRule {
  day_of_week: number | null;
  starts_at_time: string;
  ends_at_time: string;
  price_centavos: number;
  label: string | null;
}

/** Dates a space can be booked on, starting today. */
export function bookableDates(space: Space, from: DateKey = todayKey()): DateKey[] {
  const dates: DateKey[] = [];
  const [y, m, d] = from.split("-").map(Number);
  for (let i = 0; i < space.advanceDays; i += 1) {
    const at = new Date(Date.UTC(y, m - 1, d + i, 12));
    dates.push(at.toISOString().slice(0, 10));
  }
  return dates;
}

export async function listSpaces(): Promise<Space[]> {
  const supabase = createReadClient();
  const { data, error } = await supabase
    .from("spaces")
    .select("id, slug, name, mode, advance_days")
    .eq("is_active", true)
    .order("sort_order");

  if (error) throw new Error(`Could not load spaces: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    mode: row.mode,
    advanceDays: row.advance_days,
  }));
}

export async function getDayAvailability(
  spaceSlug: string,
  date: DateKey,
  now: Date = new Date(),
  /**
   * Pass the space when the caller already has it. Round trips to the
   * database are sequential and dominate page latency, so looking it up
   * again costs a whole extra one for information already in hand.
   */
  known?: Space,
): Promise<DayAvailability> {
  const supabase = createReadClient();

  let space = known;

  if (!space) {
    const { data: spaceRow, error: spaceError } = await supabase
      .from("spaces")
      .select("id, slug, name, mode, advance_days")
      .eq("slug", spaceSlug)
      .single();

    if (spaceError || !spaceRow) {
      throw new Error(`Unknown space "${spaceSlug}".`);
    }

    space = {
      id: spaceRow.id,
      slug: spaceRow.slug,
      name: spaceRow.name,
      mode: spaceRow.mode,
      advanceDays: spaceRow.advance_days,
    };
  }

  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);
  const dow = dayOfWeek(date);

  // Fetched alongside availability rather than after it: the forecast is an
  // outside service and must not add a sequential round trip to page load.
  const forecast = await getForecastFor(supabase, date);

  const [hours, pricing, packages, live, demand, closures] = await Promise.all([
    supabase
      .from("opening_hours")
      .select("day_of_week, opens_at, closes_at")
      .eq("space_id", space.id),
    supabase
      .from("pricing_rules")
      .select("day_of_week, starts_at_time, ends_at_time, price_centavos, label")
      .eq("space_id", space.id),
    supabase
      .from("packages")
      .select("id, name, duration_minutes, price_centavos")
      .eq("space_id", space.id)
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("public_availability")
      .select("starts_at, ends_at, state")
      .eq("space_id", space.id)
      .lt("starts_at", dayEnd.toISOString())
      .gt("ends_at", dayStart.toISOString()),
    supabase
      .from("slot_demand")
      .select("starts_at, ends_at, waiting")
      .eq("space_id", space.id)
      .lt("starts_at", dayEnd.toISOString())
      .gt("ends_at", dayStart.toISOString()),
    supabase
      .from("closure_windows")
      .select("starts_at, ends_at, reason")
      .eq("space_id", space.id)
      .lt("starts_at", dayEnd.toISOString())
      .gt("ends_at", dayStart.toISOString()),
  ]);

  const firstError =
    hours.error ?? pricing.error ?? packages.error ?? live.error ?? demand.error ?? closures.error;
  if (firstError) throw new Error(`Could not load availability: ${firstError.message}`);

  const taken = (live.data ?? []).map((row) => ({
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    state: (row.state === "booked" ? "booked" : "pending_review") as SlotState,
  }));

  const packageList: Package[] = (packages.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    durationMinutes: row.duration_minutes,
    priceCentavos: row.price_centavos,
  }));

  // A closure spanning the whole day closes the space outright — the grid is
  // replaced by the reason, rather than showing eighteen dead tiles.
  const wholeDayClosure = (closures.data ?? []).find(
    (c) =>
      new Date(c.starts_at).getTime() <= dayStart.getTime() &&
      new Date(c.ends_at).getTime() >= dayEnd.getTime(),
  );

  const base = {
    space,
    date,
    packages: packageList,
    taken,
    closedReason: wholeDayClosure?.reason ?? null,
    rainOutlook: null,
  };

  if (space.mode !== "hourly" || wholeDayClosure) {
    return { ...base, bands: [] };
  }

  const todaysHours =
    (hours.data ?? []).find((h) => h.day_of_week === dow) ??
    (hours.data ?? []).find((h) => h.day_of_week === null);

  if (!todaysHours) return { ...base, bands: [] };

  const openMinute = timeToMinutes(todaysHours.opens_at);
  const closeMinute = timeToMinutes(todaysHours.closes_at);

  const bands = new Map<string, PriceBand>();

  for (let minute = openMinute; minute + 60 <= closeMinute; minute += 60) {
    const startsAt = instantAt(date, Math.floor(minute / 60), minute % 60);
    const endsAt = new Date(startsAt.getTime() + 3_600_000);

    const rule = matchRule(pricing.data ?? [], dow, minute);
    const overlapping = taken.find((t) => overlaps(startsAt, endsAt, t.startsAt, t.endsAt));
    const closed = (closures.data ?? []).some((c) =>
      overlaps(startsAt, endsAt, c.starts_at, c.ends_at),
    );
    const waiting =
      (demand.data ?? []).find(
        (d) => new Date(d.starts_at).getTime() === startsAt.getTime(),
      )?.waiting ?? 0;

    let state: SlotState;
    if (startsAt.getTime() <= now.getTime()) state = "past";
    else if (overlapping) state = overlapping.state;
    else if (closed) state = "closed";
    else if (waiting > 0) state = "contested";
    else state = "available";

    const slot: Slot = {
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      label: formatTime(startsAt),
      endLabel: formatTime(endsAt),
      priceCentavos: rule?.price_centavos ?? null,
      state,
      rainChance: forecast.get(startsAt.toISOString())?.rainChance ?? null,
      waiting,
    };

    const bandLabel = rule?.label ?? "Slots";
    const existing = bands.get(bandLabel);
    if (existing) existing.slots.push(slot);
    else
      bands.set(bandLabel, {
        label: bandLabel,
        priceCentavos: rule?.price_centavos ?? 0,
        slots: [slot],
      });
  }

  const allSlots = [...bands.values()].flatMap((band) => band.slots);

  // Peak rain across BOOKABLE hours only. Taking it from the calendar day
  // reported 61% at midnight — an hour the court is shut, and useless to
  // somebody deciding whether to play.
  const outlook = allSlots.reduce<DayAvailability["rainOutlook"]>((worst, slot) => {
    if (slot.rainChance === null) return worst;
    if (!worst || slot.rainChance > worst.peak) {
      return { peak: slot.rainChance, atLabel: slot.label };
    }
    return worst;
  }, null);

  return { ...base, bands: [...bands.values()], rainOutlook: outlook };
}

function matchRule(rules: PricingRule[], dow: number, minute: number): PricingRule | undefined {
  const applicable = rules.filter(
    (r) =>
      (r.day_of_week === null || r.day_of_week === dow) &&
      minute >= timeToMinutes(r.starts_at_time) &&
      minute < timeToMinutes(r.ends_at_time),
  );
  // A day-specific rule beats the every-day fallback.
  return applicable.sort((a, b) => (b.day_of_week ?? -1) - (a.day_of_week ?? -1))[0];
}

function overlaps(
  aStart: Date,
  aEnd: Date,
  bStart: string | Date,
  bEnd: string | Date,
): boolean {
  return (
    aStart.getTime() < new Date(bEnd).getTime() && aEnd.getTime() > new Date(bStart).getTime()
  );
}

export { addDays };

/**
 * Forecast for the venue, or an empty map if it is unavailable or the
 * coordinates are unset. Both spaces are outdoors, so this applies to each.
 */
async function getForecastFor(
  supabase: ReturnType<typeof createReadClient>,
  date: DateKey,
): Promise<Map<string, HourForecast>> {
  const { data } = await supabase.from("settings").select("latitude, longitude").single();
  if (!data?.latitude || !data?.longitude) return new Map();
  return getForecast(Number(data.latitude), Number(data.longitude), date);
}
