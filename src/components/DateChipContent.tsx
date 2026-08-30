"use client";

import { useLinkStatus } from "next/link";

/**
 * The inside of a date chip, which knows when its own navigation is in flight.
 *
 * Changing date is a server render against a database in Seoul, and the grid
 * is deliberately never cached — so the wait is real and cannot be optimised
 * away without showing someone a slot that may already have sold. What can be
 * fixed is the silence: without this, tapping a date did nothing visible for
 * one to four seconds, which reads as a broken app rather than a loading one.
 *
 * `useLinkStatus` must be rendered inside the `<Link>` it reports on, which is
 * why this is a separate client component rather than a prop on DateStrip.
 */
export function DateChipContent({
  weekday,
  day,
  active,
}: {
  weekday: string;
  day: string;
  active: boolean;
}) {
  const { pending } = useLinkStatus();

  return (
    <span
      className={[
        "flex flex-col items-center transition-opacity",
        // The animation is delayed so a fast navigation never flashes: if the
        // server answers quickly, this element is replaced before the pulse
        // begins and the user sees nothing at all.
        pending ? "animate-pulse opacity-70 [animation-delay:120ms]" : "",
      ].join(" ")}
    >
      <span
        className={[
          "text-[9px] font-semibold uppercase tracking-[0.06em]",
          active ? "text-white/80" : "text-faint",
        ].join(" ")}
      >
        {weekday}
      </span>
      <span className="text-[15px] font-bold tabular-nums">{day}</span>
    </span>
  );
}
