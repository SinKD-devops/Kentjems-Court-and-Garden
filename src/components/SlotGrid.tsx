import Link from "next/link";
import type { PriceBand, Slot } from "@/lib/availability";
import { formatPeso } from "@/lib/time";

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

export function SlotGrid({ bands, spaceSlug }: { bands: PriceBand[]; spaceSlug: string }) {
  if (bands.length === 0) return null;

  return (
    <div className="flex flex-col gap-5">
      {bands.map((band) => (
        <section key={band.label} className="flex flex-col gap-2">
          <h2 className="flex items-baseline justify-between text-[10px] font-bold uppercase tracking-[0.13em] text-faint">
            <span>{band.label}</span>
            <span>{formatPeso(band.priceCentavos)} / hour</span>
          </h2>

          <ul className="grid grid-cols-2 gap-1.5">
            {band.slots.map((slot) => {
              const bookable = slot.state === "available" || slot.state === "contested";
              const content = (
                <>
                  <span className="slot-time">{slot.label}</span>
                  <span className="slot-meta">{meta(slot)}</span>
                </>
              );

              return (
                <li key={slot.startsAt}>
                  {bookable ? (
                    <Link
                      href={`/book?space=${spaceSlug}&start=${encodeURIComponent(slot.startsAt)}`}
                      className={`${STATE_CLASS[slot.state]} w-full`}
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className={STATE_CLASS[slot.state]} aria-disabled="true">
                      {content}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
