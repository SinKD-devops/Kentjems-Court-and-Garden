"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { PriceBand, Slot } from "@/lib/availability";
import { formatPeso } from "@/lib/time";
import { RAIN_LIKELY, rainWarning } from "@/lib/rain";

const STATE_CLASS: Record<Slot["state"], string> = {
  available: "slot",
  contested: "slot slot-contested",
  pending_review: "slot slot-booked",
  booked: "slot slot-booked",
  closed: "slot slot-closed",
  past: "slot slot-past",
};

function meta(slot: Slot): string {
  switch (slot.state) {
    case "past":
      return "Past";
    case "booked":
      return "Booked";
    case "pending_review":
      return "Being paid";
    case "closed":
      return "Closed";
    case "contested":
      return slot.waiting === 1 ? "1 waiting" : `${slot.waiting} waiting`;
    default:
      return slot.priceCentavos === null ? "—" : formatPeso(slot.priceCentavos);
  }
}

const isBookable = (slot: Slot) => slot.state === "available" || slot.state === "contested";

/**
 * Hourly slot grid with consecutive multi-hour selection.
 *
 * Selection is a contiguous run, never a scattered set. A court is used by one
 * group for one continuous session, and contiguity is also what lets a booking
 * stay a single row with a single time range — which is what the exclusion
 * constraint already guards.
 *
 * Tapping sets an anchor; tapping a second slot selects everything between,
 * but only if every hour in between is actually bookable. Tapping the anchor
 * again clears it.
 */
export function SlotGrid({
  bands,
  spaceSlug,
  openCount,
}: {
  bands: PriceBand[];
  spaceSlug: string;
  openCount: number;
}) {
  const slots = useMemo(() => bands.flatMap((band) => band.slots), [bands]);

  // Each slot's position in the flattened day, worked out once. Selection
  // spans bands — 5 to 8 PM crosses from daytime into evening — so indices
  // have to be global rather than per band.
  const indexed = useMemo(() => {
    let next = 0;
    return bands.map((band) => ({
      ...band,
      slots: band.slots.map((slot) => ({ slot, index: next++ })),
    }));
  }, [bands]);

  const [anchor, setAnchor] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);

  const range = useMemo(() => {
    if (anchor === null) return null;
    const end = focus ?? anchor;
    const from = Math.min(anchor, end);
    const to = Math.max(anchor, end);
    return { from, to };
  }, [anchor, focus]);

  const selected = useMemo(() => {
    if (!range) return new Set<number>();
    const set = new Set<number>();
    for (let i = range.from; i <= range.to; i += 1) set.add(i);
    return set;
  }, [range]);

  const chosen = range ? slots.slice(range.from, range.to + 1) : [];
  const total = chosen.reduce((sum, slot) => sum + (slot.priceCentavos ?? 0), 0);

  function handleTap(index: number) {
    if (anchor === null) {
      setAnchor(index);
      setFocus(index);
      return;
    }
    if (index === anchor && (focus ?? anchor) === anchor) {
      setAnchor(null);
      setFocus(null);
      return;
    }

    // Every hour between the two taps has to be bookable, or the range would
    // span a slot somebody else has already taken.
    const from = Math.min(anchor, index);
    const to = Math.max(anchor, index);
    const contiguous = slots.slice(from, to + 1).every(isBookable);

    if (contiguous) setFocus(index);
    else {
      setAnchor(index);
      setFocus(index);
    }
  }

  if (bands.length === 0) return null;

  return (
    <>
      <div className="flex flex-col gap-5">
        {indexed.map((band) => (
          <section key={band.label} className="flex flex-col gap-2">
            <h2 className="flex items-baseline justify-between text-[10px] font-bold uppercase tracking-[0.13em] text-faint">
              <span>{band.label}</span>
              <span>{formatPeso(band.priceCentavos)} / hour</span>
            </h2>

            <ul className="grid grid-cols-2 gap-1.5">
              {band.slots.map(({ slot, index }) => {
                const on = selected.has(index);
                const bookable = isBookable(slot);

                return (
                  <li key={slot.startsAt}>
                    {bookable ? (
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => handleTap(index)}
                        className={`${on ? "slot slot-selected" : STATE_CLASS[slot.state]} w-full`}
                      >
                        <span className="slot-time">{slot.label}</span>
                        <span className="slot-meta">{on ? "Selected" : meta(slot)}</span>
                        <RainHint slot={slot} />
                      </button>
                    ) : (
                      <div className={STATE_CLASS[slot.state]} aria-disabled="true">
                        <span className="slot-time">{slot.label}</span>
                        <span className="slot-meta">{meta(slot)}</span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {/*
        One bar, always. Rendering a selection bar over a separate page footer
        stacked two translucent glass panels, so the footer text showed through
        the summary — the bar has to own both states instead.
      */}
      <div className="glass fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-md items-center gap-3 border-t border-[var(--glass-line)] px-4 pb-4 pt-3">
        {chosen.length > 0 ? (
          <>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold tabular-nums">
                {chosen[0].label} – {chosen[chosen.length - 1].endLabel} · {formatPeso(total)}
              </p>
              <p className="text-[11px] font-medium text-soft">
                {chosen.length} hour{chosen.length === 1 ? "" : "s"} · tap another to extend
              </p>
            </div>
            <Link
              href={`/book?space=${spaceSlug}&start=${encodeURIComponent(chosen[0].startsAt)}&hours=${chosen.length}`}
              className="flex-none rounded-full bg-green px-5 py-2.5 text-[13.5px] font-bold text-white shadow-[0_4px_12px_rgba(18,114,77,0.3)]"
            >
              Continue
            </Link>
          </>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold">
                {openCount} of {slots.length} hours open
              </p>
              <p className="text-[11px] font-medium text-soft">
                Tap an hour to request it — pay at the store
              </p>
            </div>
            <Link
              href="/my"
              className="flex-none rounded-full bg-green px-4 py-2.5 text-[13px] font-bold text-white shadow-[0_4px_12px_rgba(18,114,77,0.3)]"
            >
              My bookings
            </Link>
          </>
        )}
      </div>
    </>
  );
}

/**
 * Rain warning on a slot.
 *
 * Shown only above 40%: a hint on every tile becomes wallpaper, and the point
 * is to catch the eye when it might actually change the choice. Advisory only
 * — people play in light rain, and the booking is never blocked.
 */
function RainHint({ slot }: { slot: Slot }) {
  const warning = slot.rainChance === null ? null : rainWarning(slot.rainChance);
  if (!warning) return null;

  return (
    <span
      className={`mt-0.5 text-[10px] font-bold ${
        slot.rainChance! >= RAIN_LIKELY ? "text-amber" : "text-soft"
      }`}
    >
      ☂ {slot.rainChance}%
    </span>
  );
}
