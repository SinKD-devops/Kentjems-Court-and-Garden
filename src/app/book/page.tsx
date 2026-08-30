import Link from "next/link";
import { redirect } from "next/navigation";
import { ConfirmForm } from "@/components/ConfirmForm";
import { getDayAvailability } from "@/lib/availability";
import { createReadClient, createSupabaseServer, getCurrentUser } from "@/lib/supabase/server";
import { formatLongDate, formatPeso, formatTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function BookPage({ searchParams }: PageProps<"/book">) {
  const params = await searchParams;
  const spaceSlug = typeof params.space === "string" ? params.space : "court";
  const start = typeof params.start === "string" ? params.start : "";
  const hours = Math.min(12, Math.max(1, Number(params.hours ?? 1) || 1));

  const startsAt = new Date(start);
  if (!start || Number.isNaN(startsAt.getTime())) redirect("/");

  const user = await getCurrentUser();
  if (!user) {
    redirect(
      `/sign-in?next=${encodeURIComponent(`/book?space=${spaceSlug}&start=${start}&hours=${hours}`)}`,
    );
  }

  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(startsAt);

  const availability = await getDayAvailability(spaceSlug, dateKey);
  const all = availability.bands.flatMap((b) => b.slots);
  const first = all.findIndex((s) => new Date(s.startsAt).getTime() === startsAt.getTime());

  if (first === -1) redirect(`/?space=${spaceSlug}&date=${dateKey}`);

  const chosen = all.slice(first, first + hours);
  const endsAt = new Date(startsAt.getTime() + hours * 3_600_000);
  const total = chosen.reduce((sum, s) => sum + (s.priceCentavos ?? 0), 0);
  const contested = Math.max(...chosen.map((s) => s.waiting), 0);

  // The profile must be read with the caller's session. Row level security
  // limits profiles to their owner, so the anonymous client returns nothing —
  // which made the terms checkbox reappear on every booking, however many
  // times it had already been accepted.
  const session = await createSupabaseServer();
  const [{ data: settings }, { data: profile }] = await Promise.all([
    createReadClient().from("settings").select("support_numbers").single(),
    session
      .from("profiles")
      .select("accepted_terms_at, full_name, password_set_at")
      .eq("id", user!.id)
      .single(),
  ]);

  // A password is required before booking. The offer after sign-in is the
  // normal path; this is the backstop, because a screen you can walk away from
  // with the back button is not actually required. Costs nothing — it rides on
  // the profile read above rather than adding a round trip.
  if (!profile?.password_set_at) {
    const back = `/book?space=${spaceSlug}&start=${encodeURIComponent(start)}&hours=${hours}`;
    redirect(`/account?first=1&next=${encodeURIComponent(back)}`);
  }

  // Any hour in the range being gone kills the whole booking — it is one
  // continuous session, not a set of independent hours.
  const unavailable =
    chosen.length !== hours ||
    chosen.some((s) => s.state === "booked" || s.state === "pending_review");

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="glass sticky top-0 z-10 border-b border-[var(--glass-line)] px-4 pb-3 pt-3">
        <Link
          href={`/?space=${spaceSlug}&date=${dateKey}`}
          className="text-[13px] font-semibold text-green"
        >
          ← Back
        </Link>
        <p className="mt-1 text-[15px] font-bold tracking-tight">Confirm your booking</p>
      </header>

      <main className="flex flex-1 flex-col gap-3 px-4 pb-6 pt-4">
        <section className="rounded-2xl border border-line bg-surface px-4 py-3.5 shadow-[0_1px_2px_rgba(16,35,26,0.05)]">
          <p className="text-[11px] font-semibold text-soft">
            {availability.space.name} · {formatLongDate(dateKey)}
          </p>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <p className="text-[17px] font-bold tabular-nums">
              {formatTime(startsAt)} – {formatTime(endsAt)}
            </p>
            <p className="text-[19px] font-bold tabular-nums text-green-deep">
              {formatPeso(total)}
            </p>
          </div>
          <p className="mt-0.5 text-[11.5px] font-medium text-soft">
            {hours} hour{hours === 1 ? "" : "s"}
            {hasMixedRates(chosen) && " · day and evening rates"}
          </p>
        </section>

        {unavailable ? (
          <div className="rounded-2xl border border-line bg-surface px-4 py-4 text-center">
            <p className="text-[14px] font-bold">Those hours have gone</p>
            <p className="mt-1 text-[13px] text-soft">
              Someone paid for part of that time while you were deciding. Pick again.
            </p>
            <Link
              href={`/?space=${spaceSlug}&date=${dateKey}`}
              className="mt-3 inline-block rounded-full bg-green px-5 py-2.5 text-[13px] font-bold text-white"
            >
              Back to slots
            </Link>
          </div>
        ) : (
          <>
            <WarningPanel />
            <ConfirmForm
              space={spaceSlug}
              startsAt={startsAt.toISOString()}
              hours={hours}
              needsTerms={!profile?.accepted_terms_at}
              needsName={!profile?.full_name}
              // Court only. The garden is booked for events, not sports, so
              // the list would be nonsense there.
              needsPurpose={spaceSlug === "court"}
              contested={contested}
            />
          </>
        )}

        <p className="px-1 text-center text-[11px] leading-relaxed text-soft">
          Questions? Call {(settings?.support_numbers ?? []).join(" or ")}
        </p>
      </main>
    </div>
  );
}

function hasMixedRates(slots: { priceCentavos: number | null }[]) {
  return new Set(slots.map((s) => s.priceCentavos)).size > 1;
}

function WarningPanel() {
  return (
    <section className="rounded-2xl border border-[#F0DDBC] bg-[var(--amber-bg)] px-4 py-3.5">
      <p className="text-[13px] font-bold text-amber">This does not reserve the time</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-[#7A5410]">
        Whoever pays first gets it. Go to Kentjems Store now — your request expires in 30
        minutes.
      </p>
    </section>
  );
}
