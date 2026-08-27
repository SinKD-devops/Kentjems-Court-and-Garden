import Link from "next/link";
import { DateStrip } from "@/components/DateStrip";
import { LiveAvailability } from "@/components/LiveAvailability";
import { SlotGrid } from "@/components/SlotGrid";
import { SpaceTabs } from "@/components/SpaceTabs";
import { bookableDates, getDayAvailability, listSpaces } from "@/lib/availability";
import { formatLongDate, formatPeso, formatTime, todayKey } from "@/lib/time";

// Availability must never be cached. A stale grid sends someone to the store
// for a slot that sold ten minutes ago.
export const dynamic = "force-dynamic";

export default async function BookingPage({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const spaces = await listSpaces();

  const requested = typeof params.space === "string" ? params.space : undefined;
  const spaceSlug = spaces.some((s) => s.slug === requested)
    ? (requested as string)
    : (spaces[0]?.slug ?? "court");

  const today = todayKey();
  // The space list already carries advanceDays, so the date strip needs no
  // extra round trip — only the chosen day is fetched.
  const space = spaces.find((s) => s.slug === spaceSlug)!;
  const dates = bookableDates(space, today);

  const requestedDate = typeof params.date === "string" ? params.date : undefined;
  const date = requestedDate && dates.includes(requestedDate) ? requestedDate : today;

  const availability = await getDayAvailability(spaceSlug, date);
  const openCount = availability.bands
    .flatMap((b) => b.slots)
    .filter((s) => s.state === "available" || s.state === "contested").length;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <LiveAvailability spaceId={availability.space.id} />
      <header className="glass sticky top-0 z-10 border-b border-[var(--glass-line)] px-4 pb-2.5 pt-3">
        <p className="text-[15px] font-bold tracking-tight">Kentjems Court and Garden</p>
        <p className="text-[11px] font-medium text-soft">{formatLongDate(date)}</p>
        <div className="mt-2.5">
          <SpaceTabs spaces={spaces} active={spaceSlug} date={date} />
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 pb-24 pt-3">
        <DateStrip dates={dates} selected={date} spaceSlug={spaceSlug} />

        {availability.closedReason ? (
          <ClosedNotice reason={availability.closedReason} />
        ) : availability.space.mode === "hourly" ? (
          <SlotGrid bands={availability.bands} spaceSlug={spaceSlug} />
        ) : (
          <GardenPackages availability={availability} />
        )}
      </main>

      <footer className="glass fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-md items-center gap-3 border-t border-[var(--glass-line)] px-4 pb-4 pt-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold">
            {availability.space.mode === "hourly"
              ? `${openCount} of ${availability.bands.flatMap((b) => b.slots).length} hours open`
              : `${availability.packages.length} package${availability.packages.length === 1 ? "" : "s"}`}
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
      </footer>
    </div>
  );
}

function ClosedNotice({ reason }: { reason: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 text-center">
      <p className="text-[15px] font-bold">Closed this day</p>
      <p className="mt-1 text-[13px] text-soft">{reason}</p>
    </div>
  );
}

function GardenPackages({
  availability,
}: {
  availability: Awaited<ReturnType<typeof getDayAvailability>>;
}) {
  if (availability.packages.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-5 text-center">
        <p className="text-[15px] font-bold">No packages yet</p>
        <p className="mt-1 text-[13px] text-soft">
          Garden packages are set up in the operator console. Once added, they appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {availability.packages.map((pkg) => (
          <li
            key={pkg.id}
            className="flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3 shadow-[0_1px_2px_rgba(16,35,26,0.05)]"
          >
            <div>
              <p className="text-[14px] font-bold">{pkg.name}</p>
              <p className="text-[11px] font-medium text-soft">
                {pkg.durationMinutes / 60} hours
              </p>
            </div>
            <p className="text-[16px] font-bold tabular-nums text-green-deep">
              {formatPeso(pkg.priceCentavos)}
            </p>
          </li>
        ))}
      </ul>

      {availability.taken.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-faint">
            Already booked this day
          </p>
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {availability.taken.map((t) => (
              <li key={t.startsAt} className="text-[13px] font-semibold tabular-nums">
                {formatTime(t.startsAt)} – {formatTime(t.endsAt)}
                <span className="ml-2 text-[11px] font-medium text-soft">
                  {t.state === "booked" ? "Booked" : "Being paid"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
