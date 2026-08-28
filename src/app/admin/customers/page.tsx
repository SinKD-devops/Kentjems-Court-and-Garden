import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminNav } from "@/components/AdminNav";
import { LiveAvailability } from "@/components/LiveAvailability";
import { createSupabaseServer } from "@/lib/supabase/server";
import { formatLongDate, formatPeso, formatTime } from "@/lib/time";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  confirmed: "bg-tint text-green-deep",
  completed: "bg-sunken text-soft",
  requested: "bg-[var(--amber-bg)] text-amber",
  proof_submitted: "bg-tint text-green-deep",
  rejected: "bg-[var(--red-bg)] text-red",
  superseded: "bg-[var(--red-bg)] text-red",
  cancelled_refunded: "bg-sunken text-soft",
  expired: "bg-sunken text-soft",
  withdrawn: "bg-sunken text-soft",
};

/**
 * Look up a customer across every booking they have ever made.
 *
 * The counter's own search only covers today's unpaid list, which is no use
 * when somebody disputes a rejected payment or claims they booked last
 * Saturday. This is the screen for an argument.
 */
export default async function CustomersPage({ searchParams }: PageProps<"/admin/customers">) {
  const params = await searchParams;
  const supabase = await createSupabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in?next=%2Fadmin%2Fcustomers");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "operator") redirect("/");

  const query = typeof params.q === "string" ? params.q.trim() : "";

  const { data: results } = query
    ? await supabase
        .from("bookings")
        .select("id, starts_at, ends_at, status, price_centavos, source, contact_name, contact_phone, spaces(name)")
        // Digits typed as 0917… still find a number stored as 63917…, so the
        // search works from whatever the operator has in front of them.
        .or(`contact_name.ilike.%${query}%,contact_phone.ilike.%${digits(query)}%`)
        .order("starts_at", { ascending: false })
        .limit(50)
    : { data: null };

  const rows = results ?? [];

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <LiveAvailability />
      <header className="glass sticky top-0 z-10 border-b border-[var(--glass-line)] px-4 pb-3 pt-3">
        <p className="text-[15px] font-bold tracking-tight">Find a customer</p>
        <p className="text-[11px] font-medium text-soft">Every booking, any date</p>
        <div className="mt-2.5">
          <AdminNav active="/admin/customers" />
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-3 px-4 pb-8 pt-4">
        <form className="flex gap-2">
          <input
            name="q"
            defaultValue={query}
            autoFocus
            placeholder="Name or mobile number"
            className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[15px] outline-none focus:border-green focus:ring-3 focus:ring-green/15"
          />
          <button
            type="submit"
            className="flex-none rounded-xl bg-green px-4 text-[13px] font-bold text-white"
          >
            Search
          </button>
        </form>

        {!query && (
          <p className="rounded-2xl border border-line bg-surface px-4 py-6 text-center text-[13px] text-soft">
            Search by name or number to see everything that person has booked.
          </p>
        )}

        {query && rows.length === 0 && (
          <p className="rounded-2xl border border-line bg-surface px-4 py-6 text-center text-[13px] text-soft">
            Nothing found for &ldquo;{query}&rdquo;.
          </p>
        )}

        {rows.length > 0 && (
          <>
            <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-faint">
              {rows.length} booking{rows.length === 1 ? "" : "s"}
            </p>
            <ul className="flex flex-col gap-1.5">
              {rows.map((row) => {
                const spaceName = Array.isArray(row.spaces)
                  ? row.spaces[0]?.name
                  : (row.spaces as { name: string } | null)?.name;
                const dateKey = new Intl.DateTimeFormat("en-CA", {
                  timeZone: "Asia/Manila",
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                }).format(new Date(row.starts_at));

                return (
                  <li key={row.id}>
                    <Link
                      href={`/admin/booking/${row.id}`}
                      className="flex items-start justify-between gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-bold">
                          {row.contact_name || "No name"}
                          <span className="ml-2 font-medium tabular-nums text-soft">
                            {row.contact_phone}
                          </span>
                        </p>
                        <p className="text-[11.5px] font-medium tabular-nums text-soft">
                          {spaceName} · {formatLongDate(dateKey)} ·{" "}
                          {formatTime(row.starts_at)}–{formatTime(row.ends_at)}
                          {row.source === "walk_in" && " · walk-in"}
                        </p>
                      </div>
                      <div className="flex flex-none flex-col items-end gap-1">
                        <span className="text-[13px] font-bold tabular-nums text-green-deep">
                          {formatPeso(row.price_centavos)}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.04em] ${
                            STATUS_TONE[row.status] ?? "bg-sunken text-soft"
                          }`}
                        >
                          {row.status.replace(/_/g, " ")}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}

/** 0917 123 4567 → 9171234567, which matches however the number was stored. */
function digits(input: string): string {
  return input.replace(/\D/g, "").replace(/^0/, "").replace(/^63/, "");
}
