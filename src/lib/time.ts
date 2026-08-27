/**
 * Time helpers, all anchored to Asia/Manila.
 *
 * The Philippines has no daylight saving and has not observed it since 1978,
 * so Manila is permanently UTC+8. That lets slot boundaries be built from a
 * fixed offset instead of a timezone database lookup — a real simplification,
 * and the reason `2026-08-28T18:00:00+08:00` is always exactly 6pm to a
 * customer standing at the court.
 *
 * Instants are stored and passed around as ISO strings; only formatting for
 * display goes through Intl.
 */

export const MANILA_TZ = "Asia/Manila";
export const MANILA_OFFSET = "+08:00";

/** A calendar date in Manila, `YYYY-MM-DD`. */
export type DateKey = string;

const dateKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: MANILA_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timeFormat = new Intl.DateTimeFormat("en-PH", {
  timeZone: MANILA_TZ,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const weekdayFormat = new Intl.DateTimeFormat("en-PH", {
  timeZone: MANILA_TZ,
  weekday: "short",
});

const longDateFormat = new Intl.DateTimeFormat("en-PH", {
  timeZone: MANILA_TZ,
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** Today's calendar date in Manila, regardless of where the server runs. */
export function todayKey(now: Date = new Date()): DateKey {
  return dateKeyFormat.format(now);
}

/** The instant at a given wall-clock hour on a Manila date. */
export function instantAt(date: DateKey, hour: number, minute = 0): Date {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return new Date(`${date}T${hh}:${mm}:00${MANILA_OFFSET}`);
}

/** Midnight opening the given Manila date. */
export function startOfDay(date: DateKey): Date {
  return instantAt(date, 0);
}

/** Midnight closing the given Manila date. */
export function endOfDay(date: DateKey): Date {
  return addDays(startOfDay(date), 1);
}

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000);
}

/** Shift a Manila calendar date by whole days, staying on the calendar. */
export function shiftDateKey(date: DateKey, days: number): DateKey {
  const [y, m, d] = date.split("-").map(Number);
  return dateKeyFormat.format(new Date(Date.UTC(y, m - 1, d + days, 12)));
}

/**
 * Day of week for a Manila calendar date: 0 = Sunday.
 * Built at midday UTC so no offset can tip it into a neighbouring day.
 */
export function dayOfWeek(date: DateKey): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

/** `"HH:MM:SS"` from Postgres, as minutes past midnight. `24:00:00` → 1440. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function formatTime(instant: Date | string): string {
  return timeFormat.format(new Date(instant));
}

export function formatWeekday(date: DateKey): string {
  return weekdayFormat.format(instantAt(date, 12));
}

export function formatDayNumber(date: DateKey): string {
  return String(Number(date.split("-")[2]));
}

export function formatLongDate(date: DateKey): string {
  return longDateFormat.format(instantAt(date, 12));
}

/** Centavos to a display string: 6000 → "₱60". */
export function formatPeso(centavos: number): string {
  const pesos = centavos / 100;
  const body = Number.isInteger(pesos) ? String(pesos) : pesos.toFixed(2);
  return `₱${body}`;
}
