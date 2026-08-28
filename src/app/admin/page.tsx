import { LiveAvailability } from "@/components/LiveAvailability";
import Link from "next/link";
import { redirect } from "next/navigation";
import { confirmCashPayment } from "@/app/admin/payments/actions";
import { AdminNav } from "@/components/AdminNav";
import { createSupabaseServer } from "@/lib/supabase/server";
import {
  endOfDay,
  formatLongDate,
  formatPeso,
  formatTime,
  shiftDateKey,
  startOfDay,
  todayKey,
} from "@/lib/time";

export const dynamic = "force-dynamic";

interface ScheduleRow {
  id: string;
  space_name: string;
  starts_at: string;
  ends_at: string;
  status: string;
  price_centavos: number;
  source: string;
  contact_name: string | null;
  contact_phone: string | null;
  expires_at: string | null;
  paid: boolean;
}

export default async function TodayPage({ searchParams }: PageProps<"/admin">) {
  const params = await searchParams;
  const supabase = await createSupabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in?next=%2Fadmin");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "operator") {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-[16px] font-bold">Operators only</p>
        <p className="text-[13px] text-soft">This is the counter console.</p>
        <Link href="/" className="mt-2 text-[13px] font-semibold text-green">
          Back to slots
        </Link>
      </div>
    );
  }

  const date = typeof params.date === "string" ? params.date : todayKey();
  const search = typeof params.q === "string" ? params.q.trim() : "";

  const [{ data: schedule }, { count: pendingReview }] = await Promise.all([
    supabase
      .from("operator_schedule")
      .select("*")
      .gte("starts_at", startOfDay(date).toISOString())
      .lt("starts_at", endOfDay(date).toISOString())
      .order("starts_at"),
    supabase
      .from("payment_review_queue")
      .select("*", { count: "exact", head: true }),
  ]);

  const rows = (schedule ?? []) as ScheduleRow[];

  // Awaiting payment is what the counter actually works from: someone is
  // standing there and needs finding fast.
  const awaiting = rows.filter(
    (r) => r.status === "requested" && (!r.expires_at || new Date(r.expires_at) > new Date()),
  );

  const matches = search
    ? awaiting.filter((r) =>
        `${r.contact_name ?? ""} ${r.contact_phone ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      )
    : awaiting;

  const confirmed = rows.filter((r) => r.status === "confirmed" || r.status === "completed");
  const takings = confirmed.reduce((sum, r) => sum + r.price_centavos, 0);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <LiveAvailability />
      <header className="glass sticky top-0 z-10 border-b border-[var(--glass-line)] px-4 pb-3 pt-3">
        <div className="flex items-baseline justify-between">
          <p className="text-[15px] font-bold tracking-tight">Counter</p>
          <Link href="/" className="text-[12px] font-semibold text-green">
            Customer view
          </Link>
        </div>
        <p className="text-[11px] font-medium text-soft">{formatLongDate(date)}</p>
        <div className="mt-2">
          <ScheduleDates date={date} />
        </div>
        <div className="mt-2.5">
          <AdminNav active="/admin" pending={pendingReview ?? 0} />
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-5 px-4 pb-8 pt-4">
        <section className="flex gap-2">
          <Stat label="Booked" value={String(confirmed.length)} />
          <Stat label="Awaiting payment" value={String(awaiting.length)} />
          <Stat label="Taken" value={formatPeso(takings)} />
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.13em] text-faint">
            Awaiting payment
          </h2>

          <form className="flex gap-2">
            <input
              name="q"
              defaultValue={search}
              placeholder="Search name or number"
              className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[15px] outline-none focus:border-green focus:ring-3 focus:ring-green/15"
            />
            <button
              type="submit"
              className="flex-none rounded-xl border border-line bg-surface px-4 text-[13px] font-bold"
            >
              Find
            </button>
          </form>

          {matches.length === 0 ? (
            <p className="rounded-2xl border border-line bg-surface px-4 py-5 text-center text-[13px] text-soft">
              {search ? `Nobody matching "${search}".` : "Nobody waiting to pay."}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {matches.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-2 rounded-2xl border border-line border-l-[3px] border-l-amber bg-surface px-4 py-3.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-bold">
                        {row.contact_name || "No name"}
                      </p>
                      <p className="text-[12px] font-medium tabular-nums text-soft">
                        {row.contact_phone}
                      </p>
                    </div>
                    <p className="flex-none text-[15px] font-bold tabular-nums text-green-deep">
                      {formatPeso(row.price_centavos)}
                    </p>
                  </div>
                  <p className="text-[13px] font-semibold tabular-nums">
                    {row.space_name} · {formatTime(row.starts_at)} – {formatTime(row.ends_at)}
                  </p>
                  <form action={confirmCashPayment}>
                    <input type="hidden" name="bookingId" value={row.id} />
                    <button
                      type="submit"
                      className="w-full rounded-xl bg-green py-3 text-[14px] font-bold text-white shadow-[0_4px_12px_rgba(18,114,77,0.3)]"
                    >
                      Mark paid — {formatPeso(row.price_centavos)}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.13em] text-faint">
            Today&rsquo;s schedule
          </h2>

          {confirmed.length === 0 ? (
            <p className="rounded-2xl border border-line bg-surface px-4 py-5 text-center text-[13px] text-soft">
              Nothing booked yet today.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {confirmed.map((row) => (
                <li key={row.id}>
                  {/* Tapping a booking is how you reach move and refund. */}
                  <Link
                    href={`/admin/booking/${row.id}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-bold tabular-nums">
                        {formatTime(row.starts_at)} – {formatTime(row.ends_at)}
                      </p>
                      <p className="truncate text-[11.5px] font-medium text-soft">
                        {row.space_name} · {row.contact_name || row.contact_phone || "—"}
                        {row.source === "walk_in" && " · walk-in"}
                      </p>
                    </div>
                    <span className="flex-none rounded-full bg-tint px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.04em] text-green-deep">
                      Paid
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 rounded-2xl border border-line bg-surface px-3 py-2.5">
      <p className="text-[17px] font-bold tabular-nums">{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">{label}</p>
    </div>
  );
}

/**
 * Date navigation for the schedule.
 *
 * The page always read a `date` parameter but nothing could change it, so the
 * operator could only ever see today — no checking tomorrow's bookings, no
 * looking back at last Saturday's takings.
 *
 * Plain links rather than a picker: yesterday, today and tomorrow cover nearly
 * every reason to look, and the date input handles the rest.
 */
function ScheduleDates({ date }: { date: string }) {
  const today = todayKey();
  const steps = [
    { label: "Yesterday", value: shiftDateKey(today, -1) },
    { label: "Today", value: today },
    { label: "Tomorrow", value: shiftDateKey(today, 1) },
  ];

  return (
    <div className="flex items-center gap-1.5">
      {steps.map((step) => (
        <Link
          key={step.value}
          href={`/admin?date=${step.value}`}
          aria-current={step.value === date ? "date" : undefined}
          className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${
            step.value === date ? "bg-green text-white" : "border border-line bg-surface text-soft"
          }`}
        >
          {step.label}
        </Link>
      ))}
      <form className="ml-auto">
        <input
          type="date"
          name="date"
          defaultValue={date}
          className="rounded-lg border border-line bg-surface px-2 py-1 text-[12px] font-semibold tabular-nums"
        />
        <button type="submit" className="ml-1 text-[12px] font-semibold text-green">
          Go
        </button>
      </form>
    </div>
  );
}
