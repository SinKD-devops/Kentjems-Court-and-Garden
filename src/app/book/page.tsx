import Link from "next/link";
import { redirect } from "next/navigation";
import { ConfirmForm } from "@/components/ConfirmForm";
import { getDayAvailability } from "@/lib/availability";
import { createReadClient, getCurrentUser } from "@/lib/supabase/server";
import { formatLongDate, formatPeso, formatTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function BookPage({ searchParams }: PageProps<"/book">) {
  const params = await searchParams;
  const spaceSlug = typeof params.space === "string" ? params.space : "court";
  const start = typeof params.start === "string" ? params.start : "";

  const startsAt = new Date(start);
  if (!start || Number.isNaN(startsAt.getTime())) redirect("/");

  const user = await getCurrentUser();
  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent(`/book?space=${spaceSlug}&start=${start}`)}`);
  }

  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(startsAt);

  const availability = await getDayAvailability(spaceSlug, dateKey);
  const slot = availability.bands
    .flatMap((b) => b.slots)
    .find((s) => new Date(s.startsAt).getTime() === startsAt.getTime());

  if (!slot) redirect(`/?space=${spaceSlug}&date=${dateKey}`);

  const supabase = createReadClient();
  const [{ data: settings }, { data: profile }] = await Promise.all([
    supabase.from("settings").select("support_numbers").single(),
    supabase.from("profiles").select("accepted_terms_at").eq("id", user!.id).single(),
  ]);

  const unavailable = slot.state === "booked" || slot.state === "pending_review";

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="glass sticky top-0 z-10 border-b border-[var(--glass-line)] px-4 pb-3 pt-3">
        <Link
          href={`/?space=${spaceSlug}&date=${dateKey}`}
          className="text-[13px] font-semibold text-green"
        >
          ← Back
        </Link>
        <p className="mt-1 text-[15px] font-bold tracking-tight">Confirm your slot</p>
      </header>

      <main className="flex flex-1 flex-col gap-3 px-4 pb-6 pt-4">
        <section className="rounded-2xl border border-line bg-surface px-4 py-3.5 shadow-[0_1px_2px_rgba(16,35,26,0.05)]">
          <p className="text-[11px] font-semibold text-soft">
            {availability.space.name} · {formatLongDate(dateKey)}
          </p>
          <div className="mt-1 flex items-baseline justify-between">
            <p className="text-[17px] font-bold tabular-nums">
              {formatTime(slot.startsAt)} – {formatTime(slot.endsAt)}
            </p>
            <p className="text-[19px] font-bold tabular-nums text-green-deep">
              {slot.priceCentavos === null ? "—" : formatPeso(slot.priceCentavos)}
            </p>
          </div>
        </section>

        {unavailable ? (
          <div className="rounded-2xl border border-line bg-surface px-4 py-4 text-center">
            <p className="text-[14px] font-bold">That slot has gone</p>
            <p className="mt-1 text-[13px] text-soft">
              Someone paid for it while you were deciding. Pick another time.
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
              startsAt={slot.startsAt}
              needsTerms={!profile?.accepted_terms_at}
              contested={slot.waiting}
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

function WarningPanel() {
  return (
    <section className="rounded-2xl border border-[#F0DDBC] bg-[var(--amber-bg)] px-4 py-3.5">
      <p className="text-[13px] font-bold text-amber">This does not reserve the slot</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-[#7A5410]">
        Whoever pays first gets it. Go to Kentjems Store now, or pay by GCash from your
        bookings page. Your request expires in 30 minutes.
      </p>
    </section>
  );
}
