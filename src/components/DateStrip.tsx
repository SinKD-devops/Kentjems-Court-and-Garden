import Link from "next/link";
import type { DateKey } from "@/lib/time";
import { formatDayNumber, formatWeekday, todayKey } from "@/lib/time";

/**
 * Date picker for the slot grid.
 *
 * Plain links and a plain form, so changing date is a server render with no
 * client JavaScript — the grid always reflects the database rather than a
 * cached client copy, which matters when a slot can sell while someone is
 * looking at it.
 *
 * The chips cover the next several days, which is nearly every booking. The
 * jump-to-date field exists because the garden opens thirty days ahead, and
 * scrolling thirty chips sideways to reach late September is not a way to
 * book a party.
 */
export function DateStrip({
  dates,
  selected,
  spaceSlug,
}: {
  dates: DateKey[];
  selected: DateKey;
  spaceSlug: string;
}) {
  const today = todayKey();
  const last = dates[dates.length - 1];

  // Always include the selected date, so jumping to a distant day does not
  // leave the strip showing a week that no longer contains it.
  const nearby = dates.slice(0, 7);
  const chips = nearby.includes(selected) ? nearby : [...nearby.slice(0, 6), selected];

  return (
    <nav aria-label="Choose a date" className="flex flex-col gap-2">
      <ul className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {chips.map((date) => {
          const active = date === selected;
          return (
            <li key={date} className="flex-none">
              <Link
                href={`/?space=${spaceSlug}&date=${date}`}
                aria-current={active ? "date" : undefined}
                className={[
                  "flex w-13 flex-col items-center rounded-xl border px-3 py-1.5",
                  active
                    ? "border-green bg-green text-white"
                    : "border-line bg-surface text-ink",
                ].join(" ")}
              >
                <span
                  className={[
                    "text-[9px] font-semibold uppercase tracking-[0.06em]",
                    active ? "text-white/80" : "text-faint",
                  ].join(" ")}
                >
                  {date === today ? "Today" : formatWeekday(date)}
                </span>
                <span className="text-[15px] font-bold tabular-nums">
                  {formatDayNumber(date)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {dates.length > nearby.length && (
        <form className="flex items-center gap-2">
          <input type="hidden" name="space" value={spaceSlug} />
          <label className="flex flex-1 items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
            <span className="text-[11px] font-semibold text-faint">Another day</span>
            <input
              type="date"
              name="date"
              defaultValue={selected}
              min={today}
              max={last}
              className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold tabular-nums outline-none"
            />
          </label>
          <button
            type="submit"
            className="flex-none rounded-xl border border-line bg-surface px-4 py-2 text-[13px] font-bold"
          >
            Go
          </button>
        </form>
      )}
    </nav>
  );
}
