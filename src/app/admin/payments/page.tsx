import { LiveAvailability } from "@/components/LiveAvailability";
import Link from "next/link";
import { redirect } from "next/navigation";
import { approvePayment, rejectPayment } from "@/app/admin/payments/actions";
import { AdminNav } from "@/components/AdminNav";
import { ProofImage } from "@/components/ProofImage";
import { createSupabaseServer } from "@/lib/supabase/server";
import { formatPeso, formatTime } from "@/lib/time";

export const dynamic = "force-dynamic";

const REJECT_REASONS = [
  "payment not found",
  "wrong amount",
  "duplicate reference",
  "unreadable",
];

export default async function PaymentQueuePage() {
  const supabase = await createSupabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in?next=%2Fadmin%2Fpayments");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "operator") {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-[16px] font-bold">Operators only</p>
        <p className="text-[13px] text-soft">
          This is the counter console. Ask the owner if you need access.
        </p>
        <Link href="/" className="mt-2 text-[13px] font-semibold text-green">
          Back to slots
        </Link>
      </div>
    );
  }

  const { data: queue } = await supabase.from("payment_review_queue").select("*");
  const rows = queue ?? [];

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <LiveAvailability />
      <header className="glass sticky top-0 z-10 border-b border-[var(--glass-line)] px-4 pb-3 pt-3">
        <Link href="/" className="text-[13px] font-semibold text-green">
          ← Customer view
        </Link>
        <p className="mt-1 text-[15px] font-bold tracking-tight">Payments to review</p>
        <p className="text-[11px] font-medium text-soft">
          {rows.length === 0
            ? "Nothing waiting"
            : `${rows.length} waiting · oldest first`}
        </p>
        <div className="mt-2.5">
          <AdminNav active="/admin/payments" pending={rows.length} />
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-3 px-4 pb-24 pt-4">
        {rows.length === 0 && (
          <div className="rounded-2xl border border-line bg-surface px-4 py-8 text-center">
            <p className="text-[14px] font-bold">All clear</p>
            <p className="mt-1 text-[13px] text-soft">
              Payments waiting for your approval appear here.
            </p>
          </div>
        )}

        {rows.map((row) => {
          const flagged = row.amount_mismatch || row.duplicate_reference;
          return (
            <article
              key={row.payment_id}
              className={`flex flex-col gap-2 rounded-2xl border bg-surface px-4 py-3.5 shadow-[0_1px_2px_rgba(16,35,26,0.05)] ${
                flagged ? "border-l-[3px] border-l-red border-line" : "border-l-[3px] border-l-green border-line"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[14px] font-bold tabular-nums">
                    {row.space_name} · {formatTime(row.starts_at)} – {formatTime(row.ends_at)}
                  </p>
                  <p className="text-[12px] font-medium text-soft">
                    {row.sender_name || row.contact_name || "—"} · {row.contact_phone}
                  </p>
                </div>
                <Badge ok={!row.amount_mismatch}>
                  {row.amount_mismatch
                    ? `Expected ${formatPeso(row.expected_centavos)}`
                    : "Amount OK"}
                </Badge>
              </div>

              <dl className="flex flex-col gap-0.5 text-[12.5px]">
                <div className="flex justify-between">
                  <dt className="text-soft">Claimed</dt>
                  <dd className="font-bold tabular-nums">
                    {formatPeso(row.claimed_centavos)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-soft">Reference</dt>
                  <dd className="truncate font-bold tabular-nums">{row.reference_number}</dd>
                </div>
              </dl>

              {row.duplicate_reference && (
                <p className="rounded-lg bg-[var(--red-bg)] px-3 py-2 text-[12px] font-bold text-red">
                  This reference was already used on another booking.
                </p>
              )}

              <ProofImage path={row.proof_path} />

              <p className="rounded-lg bg-[var(--amber-bg)] px-3 py-2 text-[11.5px] font-semibold text-amber">
                Check this reference in your own app, not the screenshot.
              </p>

              <div className="flex gap-2">
                <form action={rejectPayment} className="flex-1">
                  <input type="hidden" name="bookingId" value={row.booking_id} />
                  <select
                    name="reason"
                    defaultValue={
                      row.duplicate_reference
                        ? "duplicate reference"
                        : row.amount_mismatch
                          ? "wrong amount"
                          : "payment not found"
                    }
                    className="mb-2 w-full rounded-lg border border-line bg-surface px-2 py-2 text-[12px] font-semibold"
                  >
                    {REJECT_REASONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {reason}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="w-full rounded-lg border border-[#EBCFCC] bg-surface py-2.5 text-[13px] font-bold text-red"
                  >
                    Reject
                  </button>
                </form>

                <form action={approvePayment} className="flex flex-1 flex-col justify-end">
                  <input type="hidden" name="bookingId" value={row.booking_id} />
                  <input type="hidden" name="reference" value={row.reference_number ?? ""} />
                  <button
                    type="submit"
                    className="w-full rounded-lg bg-green py-2.5 text-[13px] font-bold text-white shadow-[0_4px_12px_rgba(18,114,77,0.3)]"
                  >
                    Approve
                  </button>
                </form>
              </div>
            </article>
          );
        })}
      </main>
    </div>
  );
}

function Badge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`flex-none rounded-md px-2 py-1 text-[9.5px] font-bold uppercase tracking-[0.04em] ${
        ok ? "bg-tint text-green-deep" : "bg-[var(--red-bg)] text-red"
      }`}
    >
      {children}
    </span>
  );
}
