import Link from "next/link";
import { redirect } from "next/navigation";
import { PayForm } from "@/components/PayForm";
import { createSupabaseServer } from "@/lib/supabase/server";
import { formatLongDate, formatPeso, formatTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function PayPage({ params }: PageProps<"/pay/[id]">) {
  const { id } = await params;
  const supabase = await createSupabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/pay/${id}`)}`);

  const [{ data: booking }, { data: settings }] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, starts_at, ends_at, status, price_centavos, expires_at, spaces(name)")
      .eq("id", id)
      .single(),
    supabase
      .from("settings")
      .select("payee_name, payee_number, payment_qr_path, support_numbers, gcash_window_opens_at, last_submission_time")
      .single(),
  ]);

  if (!booking) redirect("/my");
  if (booking.status !== "requested") redirect("/my");

  const spaceName = Array.isArray(booking.spaces)
    ? booking.spaces[0]?.name
    : (booking.spaces as { name: string } | null)?.name;

  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(booking.starts_at));

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="glass sticky top-0 z-10 border-b border-[var(--glass-line)] px-4 pb-3 pt-3">
        <Link href="/my" className="text-[13px] font-semibold text-green">
          ← My bookings
        </Link>
        <p className="mt-1 text-[15px] font-bold tracking-tight">Pay online</p>
      </header>

      <main className="flex flex-1 flex-col gap-3 px-4 pb-8 pt-4">
        <section className="rounded-2xl border border-line bg-surface px-4 py-3.5 shadow-[0_1px_2px_rgba(16,35,26,0.05)]">
          <p className="text-[11px] font-semibold text-soft">
            {spaceName} · {formatLongDate(dateKey)}
          </p>
          <div className="mt-1 flex items-baseline justify-between">
            <p className="text-[16px] font-bold tabular-nums">
              {formatTime(booking.starts_at)} – {formatTime(booking.ends_at)}
            </p>
            <p className="text-[20px] font-bold tabular-nums text-green-deep">
              {formatPeso(booking.price_centavos)}
            </p>
          </div>
        </section>

        <section className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-4 shadow-[0_1px_2px_rgba(16,35,26,0.05)]">
          <p className="text-[12px] font-semibold text-soft">
            Scan with GCash, Maya, or your bank app
          </p>
          {settings?.payment_qr_path && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={settings.payment_qr_path}
              alt="InstaPay QR code for Kentjems Court and Garden"
              className="size-52 rounded-xl border border-line bg-white p-2"
            />
          )}
          <p className="text-[14px] font-bold">{settings?.payee_name}</p>
          <p className="text-[13px] font-semibold tabular-nums text-soft">
            {settings?.payee_number}
          </p>
          <p className="mt-1 rounded-lg bg-tint px-3 py-1.5 text-center text-[12px] font-bold text-green-deep">
            Send exactly {formatPeso(booking.price_centavos)}
          </p>
        </section>

        <PayForm
          bookingId={booking.id}
          amountCentavos={booking.price_centavos}
          expiresAt={booking.expires_at}
        />

        <p className="px-1 text-center text-[11px] leading-relaxed text-soft">
          Questions? Call {(settings?.support_numbers ?? []).join(" or ")}
        </p>
      </main>
    </div>
  );
}
