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

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return <SetupNotice />;
  }

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

  const availability = await getDayAvailability(spaceSlug, date, new Date(), space);
  const openCount = availability.bands
    .flatMap((b) => b.slots)
    .filter((s) => s.state === "available" || s.state === "contested").length;

  // The grid owns the bottom bar when it renders, because it has to swap
  // between the day summary and the current selection. The page supplies one
  // only when there is no grid.
  const hasGrid = !availability.closedReason && availability.bands.length > 0;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <LiveAvailability spaceId={availability.space.id} />
      <header className="glass sticky top-0 z-10 border-b border-[var(--glass-line)] px-4 pb-2.5 pt-3">
        <p className="text-[15px] font-bold tracking-tight">Kentjems Court and Garden</p>
        <p className="text-[11px] font-medium text-soft">
          {formatLongDate(date)}
          {availability.rainOutlook && (
            <RainOutlook outlook={availability.rainOutlook} />
          )}
        </p>
        <div className="mt-2.5">
          <SpaceTabs spaces={spaces} active={spaceSlug} date={date} />
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 pb-24 pt-3">
        <DateStrip dates={dates} selected={date} spaceSlug={spaceSlug} />

        {availability.closedReason ? (
          <ClosedNotice reason={availability.closedReason} />
        ) : availability.space.mode === "hourly" ? (
          <SlotGrid
            bands={availability.bands}
            spaceSlug={spaceSlug}
            openCount={openCount}
          />
        ) : (
          <GardenPackages availability={availability} />
        )}
      </main>

      {/*
        The slot grid renders its own bottom bar, because it has to swap between
        the day summary and the current selection. This one only covers the
        cases where there is no grid at all.
      */}
      {!hasGrid && (
        <footer className="glass fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-md items-center gap-3 border-t border-[var(--glass-line)] px-4 pb-4 pt-3">
          <p className="min-w-0 flex-1 text-[13px] font-bold">
            {availability.closedReason ? "Closed this day" : "Nothing bookable"}
          </p>
          <Link
            href="/my"
            className="flex-none rounded-full bg-green px-4 py-2.5 text-[13px] font-bold text-white shadow-[0_4px_12px_rgba(18,114,77,0.3)]"
          >
            My bookings
          </Link>
        </footer>
      )}
    </div>
  );
}

/**
 * Shown when the deployment has no Supabase credentials. This is an operator
 * problem, not a customer one, so it says exactly which variables are missing
 * and where they go rather than apologising vaguely.
 */
function SetupNotice() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-5">
      <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-faint">
        Kentjems Court and Garden
      </p>
      <h1 className="text-[20px] font-bold tracking-tight">Not connected to the database</h1>
      <p className="text-[13.5px] leading-relaxed text-soft">
        This deployment is missing its Supabase credentials, so availability cannot be
        loaded. Add these environment variables and redeploy:
      </p>
      <ul className="flex flex-col gap-1.5 rounded-2xl border border-line bg-surface px-4 py-3.5 font-mono text-[11.5px]">
        <li>NEXT_PUBLIC_SUPABASE_URL</li>
        <li>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</li>
      </ul>
      <p className="text-[12px] leading-relaxed text-faint">
        On Vercel: Settings → Environment Variables → Production, then redeploy. Values
        come from Supabase → Project Settings → API.
      </p>
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

/**
 * The day's rain outlook, always shown when a forecast loaded.
 *
 * Without this the feature is invisible on a dry day, and "no warning" is
 * indistinguishable from "broken". Butuan peaking at 39% — one point under the
 * per-slot threshold — is exactly the case that made this necessary.
 */
function RainOutlook({ outlook }: { outlook: { peak: number; atLabel: string } }) {
  const wet = outlook.peak >= 40;

  return (
    <span className={wet ? "text-amber" : "text-soft"}>
      {" · "}
      {wet
        ? `☂ up to ${outlook.peak}% rain around ${outlook.atLabel}`
        : `☀ dry, ${outlook.peak}% rain at most`}
    </span>
  );
}
