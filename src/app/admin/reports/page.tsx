import { redirect } from "next/navigation";
import { AdminNav } from "@/components/AdminNav";
import { createSupabaseServer } from "@/lib/supabase/server";
import { formatPeso, shiftDateKey, todayKey } from "@/lib/time";

export const dynamic = "force-dynamic";

interface DayRow {
  local_date: string;
  space_slug: string;
  space_name: string;
  hours_sold: number;
  centavos: number;
  daytime_centavos: number | null;
  evening_centavos: number | null;
  walk_in_hours: number;
}

interface HourRow {
  space_slug: string;
  space_name: string;
  local_hour: number;
  hours_sold: number;
  centavos: number;
}

export default async function ReportsPage() {
  const supabase = await createSupabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in?next=%2Fadmin%2Freports");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "operator") redirect("/");

  const today = todayKey();
  // Thirty days: long enough to compare weeks and spot a monthly pattern,
  // short enough that the by-day list stays readable on a phone.
  const from = shiftDateKey(today, -29);

  const [{ data: days }, { data: hours }] = await Promise.all([
    supabase
      .from("revenue_by_day")
      .select("*")
      .gte("local_date", from)
      .lte("local_date", today)
      .order("local_date", { ascending: false }),
    supabase.from("occupancy_by_hour").select("*").order("local_hour"),
  ]);

  const dayRows = (days ?? []) as DayRow[];
  const hourRows = (hours ?? []) as HourRow[];

  const periodTotal = dayRows.reduce((sum, r) => sum + r.centavos, 0);
  const periodHours = dayRows.reduce((sum, r) => sum + r.hours_sold, 0);
  const todayTotal = dayRows
    .filter((r) => r.local_date === today)
    .reduce((sum, r) => sum + r.centavos, 0);

  // Grouped by date so a day with both spaces reads as one line.
  const byDate = new Map<string, DayRow[]>();
  for (const row of dayRows) {
    byDate.set(row.local_date, [...(byDate.get(row.local_date) ?? []), row]);
  }

  const peak = Math.max(1, ...hourRows.map((h) => h.hours_sold));

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="glass sticky top-0 z-10 border-b border-[var(--glass-line)] px-4 pb-3 pt-3">
        <p className="text-[15px] font-bold tracking-tight">Reports</p>
        <p className="text-[11px] font-medium text-soft">Last 30 days</p>
        <div className="mt-2.5">
          <AdminNav active="/admin/reports" />
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-5 px-4 pb-8 pt-4">
        <section className="flex gap-2">
          <Stat label="Today" value={formatPeso(todayTotal)} />
          <Stat label="Last 30 days" value={formatPeso(periodTotal)} />
          <Stat label="Hours sold" value={String(periodHours)} />
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.13em] text-faint">
            By day
          </h2>
          {byDate.size === 0 ? (
            <Empty>No bookings in the last 30 days.</Empty>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {[...byDate.entries()].map(([date, rows]) => {
                const total = rows.reduce((sum, r) => sum + r.centavos, 0);
                const sold = rows.reduce((sum, r) => sum + r.hours_sold, 0);
                const evening = rows.reduce((sum, r) => sum + (r.evening_centavos ?? 0), 0);
                return (
                  <li
                    key={date}
                    className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5"
                  >
                    <div>
                      <p className="text-[13.5px] font-bold tabular-nums">
                        {new Intl.DateTimeFormat("en-PH", {
                          timeZone: "Asia/Manila",
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        }).format(new Date(`${date}T12:00:00+08:00`))}
                      </p>
                      <p className="text-[11px] font-medium text-soft">
                        {sold} hour{sold === 1 ? "" : "s"} · {formatPeso(evening)} evening
                      </p>
                    </div>
                    <p className="text-[15px] font-bold tabular-nums text-green-deep">
                      {formatPeso(total)}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.13em] text-faint">
            Which hours sell
          </h2>
          {hourRows.length === 0 ? (
            <Empty>Not enough data yet.</Empty>
          ) : (
            <div className="flex flex-col gap-1 rounded-2xl border border-line bg-surface px-3.5 py-3">
              {Array.from({ length: 18 }, (_, i) => i + 6).map((hour) => {
                const sold = hourRows
                  .filter((h) => h.local_hour === hour)
                  .reduce((sum, h) => sum + h.hours_sold, 0);
                const label = new Intl.DateTimeFormat("en-PH", {
                  hour: "numeric",
                  hour12: true,
                  timeZone: "UTC",
                }).format(new Date(Date.UTC(2000, 0, 1, hour)));

                return (
                  <div key={hour} className="flex items-center gap-2">
                    <span className="w-14 flex-none text-right text-[11px] font-semibold tabular-nums text-soft">
                      {label}
                    </span>
                    <span className="h-3.5 flex-1 overflow-hidden rounded-full bg-sunken">
                      <span
                        className={`block h-full rounded-full ${
                          hour >= 18 ? "bg-green" : "bg-tint-line"
                        }`}
                        style={{ width: `${Math.round((sold / peak) * 100)}%` }}
                      />
                    </span>
                    <span className="w-6 flex-none text-right text-[11px] font-bold tabular-nums">
                      {sold || ""}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <p className="px-1 text-[11.5px] leading-relaxed text-soft">
            Counts every booked hour, so a three-hour booking fills three bars. Evening
            hours are shown darker — if they saturate while daytime sits empty, the
            evening rate is too low.
          </p>
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 rounded-2xl border border-line bg-surface px-3 py-2.5">
      <p className="text-[16px] font-bold tabular-nums">{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">{label}</p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border border-line bg-surface px-4 py-5 text-center text-[13px] text-soft">
      {children}
    </p>
  );
}
