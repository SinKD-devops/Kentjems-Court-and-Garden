import Link from "next/link";
import { redirect } from "next/navigation";
import { BookingActions } from "@/components/BookingActions";
import { getDayAvailability, listSpaces } from "@/lib/availability";
import { createSupabaseServer } from "@/lib/supabase/server";
import { formatLongDate, formatPeso, formatTime, todayKey } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function BookingDetailPage({
  params,
  searchParams,
}: PageProps<"/admin/booking/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createSupabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/admin/booking/${id}`)}`);

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "operator") redirect("/");

  const { data: booking } = await supabase
    .from("bookings")
    .select("*, spaces(slug, name)")
    .eq("id", id)
    .single();

  if (!booking) redirect("/admin");

  const space = Array.isArray(booking.spaces) ? booking.spaces[0] : booking.spaces;
  const spaces = await listSpaces();
  const spaceRecord = spaces.find((s) => s.slug === space?.slug);

  const moveDate =
    typeof query.date === "string"
      ? query.date
      : new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Manila",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(booking.starts_at));

  const availability = spaceRecord
    ? await getDayAvailability(space!.slug, moveDate, new Date(), spaceRecord)
    : null;

  const hours = Math.round(
    (new Date(booking.ends_at).getTime() - new Date(booking.starts_at).getTime()) / 3_600_000,
  );

  const { data: moves } = await supabase
    .from("booking_moves")
    .select("from_starts_at, to_starts_at, reason, moved_at")
    .eq("booking_id", id)
    .order("moved_at", { ascending: false });

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="glass sticky top-0 z-10 border-b border-[var(--glass-line)] px-4 pb-3 pt-3">
        <Link href="/admin" className="text-[13px] font-semibold text-green">
          ← Today
        </Link>
        <p className="mt-1 text-[15px] font-bold tracking-tight">Booking</p>
      </header>

      <main className="flex flex-1 flex-col gap-3 px-4 pb-8 pt-4">
        <section className="rounded-2xl border border-line bg-surface px-4 py-3.5">
          <p className="text-[11px] font-semibold text-soft">
            {space?.name} · {formatLongDate(moveDate)}
          </p>
          <div className="mt-1 flex items-baseline justify-between">
            <p className="text-[17px] font-bold tabular-nums">
              {formatTime(booking.starts_at)} – {formatTime(booking.ends_at)}
            </p>
            <p className="text-[18px] font-bold tabular-nums text-green-deep">
              {formatPeso(booking.price_centavos)}
            </p>
          </div>
          <p className="mt-1 text-[12.5px] font-medium text-soft">
            {booking.contact_name || "No name"} · {booking.contact_phone}
            {booking.source === "walk_in" && " · walk-in"}
          </p>
          <p className="mt-1.5 inline-block rounded-full bg-sunken px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.04em] text-soft">
            {booking.status.replace(/_/g, " ")}
          </p>
        </section>

        {availability && (
          <BookingActions
            id={id}
            hours={hours}
            status={booking.status}
            priceCentavos={booking.price_centavos}
            moveDate={moveDate}
            dates={availabilityDates(spaceRecord!.advanceDays)}
            slots={availability.bands.flatMap((b) => b.slots)}
          />
        )}

        {moves && moves.length > 0 && (
          <section className="rounded-2xl border border-line bg-surface px-4 py-3.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-faint">
              Move history
            </p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {moves.map((m) => (
                <li key={m.moved_at} className="text-[12.5px] tabular-nums text-soft">
                  {formatTime(m.from_starts_at)} → {formatTime(m.to_starts_at)}
                  {m.reason ? ` · ${m.reason}` : ""}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

function availabilityDates(advanceDays: number) {
  const today = todayKey();
  const [y, m, d] = today.split("-").map(Number);
  return Array.from({ length: Math.min(advanceDays, 14) }, (_, i) =>
    new Date(Date.UTC(y, m - 1, d + i, 12)).toISOString().slice(0, 10),
  );
}
