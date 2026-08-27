import Link from "next/link";
import type { DateKey } from "@/lib/time";
import { formatDayNumber, formatWeekday, todayKey } from "@/lib/time";

/**
 * Horizontal date picker. Plain links, so changing date is a server render
 * with no client JavaScript — the grid always reflects the database rather
 * than a cached client copy, which matters when a slot can sell while
 * someone is looking at it.
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

  return (
    <nav aria-label="Choose a date">
      <ul className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {dates.map((date) => {
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
    </nav>
  );
}
