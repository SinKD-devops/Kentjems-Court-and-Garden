import Link from "next/link";
import { redirect } from "next/navigation";
import { withdrawRequest } from "@/app/book/actions";
import { signOut } from "@/app/sign-in/actions";
import { Countdown } from "@/components/Countdown";
import { InstallPrompt } from "@/components/InstallPrompt";
import { NotifyToggle } from "@/components/NotifyToggle";
import { createSupabaseServer } from "@/lib/supabase/server";
import { formatLongDate, formatPeso, formatTime } from "@/lib/time";

export const dynamic = "force-dynamic";

const STATUS_COPY: Record<string, { label: string; tone: string }> = {
  requested: { label: "Awaiting payment", tone: "bg-[var(--amber-bg)] text-amber" },
  proof_submitted: { label: "Checking your payment", tone: "bg-tint text-green-deep" },
  confirmed: { label: "Paid", tone: "bg-tint text-green-deep" },
  completed: { label: "Done", tone: "bg-sunken text-soft" },
  expired: { label: "Expired", tone: "bg-sunken text-soft" },
  withdrawn: { label: "Cancelled", tone: "bg-sunken text-soft" },
  superseded: { label: "Someone paid first", tone: "bg-[var(--red-bg)] text-red" },
  rejected: { label: "Payment not accepted", tone: "bg-[var(--red-bg)] text-red" },
  cancelled_refunded: { label: "Refunded", tone: "bg-sunken text-soft" },
};

export default async function MyBookingsPage() {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/sign-in?next=%2Fmy");

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, starts_at, ends_at, status, price_centavos, expires_at, spaces(name)")
    .order("starts_at", { ascending: false })
    .limit(40);

  const rows = bookings ?? [];
  const live = rows.filter((b) => ["requested", "proof_submitted", "confirmed"].includes(b.status));
  const done = rows.filter((b) => !live.includes(b));

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="glass sticky top-0 z-10 border-b border-[var(--glass-line)] px-4 pb-3 pt-3">
        <Link href="/" className="text-[13px] font-semibold text-green">
          ← Slots
        </Link>
        <p className="mt-1 text-[15px] font-bold tracking-tight">My bookings</p>
      </header>

      <main className="flex flex-1 flex-col gap-5 px-4 pb-8 pt-4">
        {rows.length === 0 && (
          <div className="rounded-2xl border border-line bg-surface px-4 py-6 text-center">
            <p className="text-[14px] font-bold">Nothing booked yet</p>
            <p className="mt-1 text-[13px] text-soft">
              Pick an hour on the court and it will show up here.
            </p>
            <Link
              href="/"
              className="mt-3 inline-block rounded-full bg-green px-5 py-2.5 text-[13px] font-bold text-white"
            >
              See available slots
            </Link>
          </div>
        )}

        {live.length > 0 && <Section title="Active">{live.map(Row)}</Section>}

        {/* Offered only once they have booked something — asking before that
            is how install prompts get dismissed for good. */}
        {rows.length > 0 && <InstallPrompt />}

        {process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && live.some((b) => b.status === "requested") && (
          <NotifyToggle publicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY} />
        )}
        {done.length > 0 && <Section title="Past">{done.map(Row)}</Section>}

        <form action={signOut} className="pt-2">
          <button type="submit" className="w-full py-2 text-[13px] font-semibold text-soft">
            Sign out
          </button>
        </form>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[10px] font-bold uppercase tracking-[0.13em] text-faint">{title}</h2>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

type BookingRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  price_centavos: number;
  expires_at: string | null;
  spaces: { name: string } | { name: string }[] | null;
};

function Row(booking: BookingRow) {
  const status = STATUS_COPY[booking.status] ?? { label: booking.status, tone: "bg-sunken text-soft" };
  const spaceName = Array.isArray(booking.spaces)
    ? booking.spaces[0]?.name
    : booking.spaces?.name;

  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(booking.starts_at));

  return (
    <li
      key={booking.id}
      className="flex flex-col gap-2 rounded-2xl border border-line bg-surface px-4 py-3.5 shadow-[0_1px_2px_rgba(16,35,26,0.05)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold text-soft">
            {spaceName} · {formatLongDate(dateKey)}
          </p>
          <p className="text-[15px] font-bold tabular-nums">
            {formatTime(booking.starts_at)} – {formatTime(booking.ends_at)}
          </p>
        </div>
        <p className="text-[15px] font-bold tabular-nums text-green-deep">
          {formatPeso(booking.price_centavos)}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.04em] ${status.tone}`}
        >
          {status.label}
        </span>
        {booking.status === "requested" && booking.expires_at && (
          <Countdown expiresAt={booking.expires_at} />
        )}
      </div>

      {booking.status === "requested" && (
        <>
          <p className="text-[12px] leading-relaxed text-soft">
            Pay at Kentjems Store, or pay online below. Paying at the store does not hold
            the slot — whoever pays
            first gets it.
          </p>
          <Link
            href={`/pay/${booking.id}`}
            className="rounded-full bg-green px-4 py-2.5 text-center text-[13px] font-bold text-white shadow-[0_4px_12px_rgba(18,114,77,0.3)]"
          >
            Pay online now
          </Link>
          <form action={withdrawRequest}>
            <input type="hidden" name="id" value={booking.id} />
            <button
              type="submit"
              className="text-[12.5px] font-semibold text-red underline underline-offset-2"
            >
              Cancel this request
            </button>
          </form>
        </>
      )}
    </li>
  );
}
