import Link from "next/link";
import { redirect } from "next/navigation";
import { settleRefund } from "@/app/admin/booking/[id]/actions";
import { AdminNav } from "@/components/AdminNav";
import { createSupabaseServer } from "@/lib/supabase/server";
import { formatPeso, formatTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function RefundsPage() {
  const supabase = await createSupabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in?next=%2Fadmin%2Frefunds");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "operator") redirect("/");

  const { data: owed } = await supabase
    .from("refunds_owed")
    .select("*")
    .order("created_at");

  const rows = owed ?? [];
  const total = rows.reduce((sum, r) => sum + r.amount_centavos, 0);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="glass sticky top-0 z-10 border-b border-[var(--glass-line)] px-4 pb-3 pt-3">
        <p className="text-[15px] font-bold tracking-tight">Refunds owed</p>
        <p className="text-[11px] font-medium text-soft">
          {rows.length === 0
            ? "Nothing outstanding"
            : `${formatPeso(total)} to hand back`}
        </p>
        <div className="mt-2.5">
          <AdminNav active="/admin/refunds" />
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-2 px-4 pb-8 pt-4">
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-line bg-surface px-4 py-8 text-center">
            <p className="text-[14px] font-bold">Nothing owed</p>
            <p className="mt-1 text-[13px] text-soft">
              Approved weather and power refunds appear here until you hand the cash back.
            </p>
          </div>
        ) : (
          rows.map((row) => (
            <article
              key={row.id}
              className="flex flex-col gap-2 rounded-2xl border border-line border-l-[3px] border-l-red bg-surface px-4 py-3.5"
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
                <p className="flex-none text-[16px] font-bold tabular-nums text-red">
                  {formatPeso(row.amount_centavos)}
                </p>
              </div>
              <p className="text-[12.5px] font-semibold tabular-nums">
                {row.space_name} · {formatTime(row.starts_at)} – {formatTime(row.ends_at)}
                <span className="ml-2 font-medium text-soft">{row.reason}</span>
              </p>
              <form action={settleRefund}>
                <input type="hidden" name="refundId" value={row.id} />
                <button
                  type="submit"
                  className="w-full rounded-xl bg-green py-3 text-[14px] font-bold text-white"
                >
                  Cash handed back
                </button>
              </form>
            </article>
          ))
        )}

        <p className="px-1 pt-2 text-center text-[11.5px] leading-relaxed text-soft">
          A refund stays on this list until you mark it settled, so money owed never
          depends on remembering.
        </p>

        <Link href="/admin" className="pt-2 text-center text-[13px] font-semibold text-green">
          Back to today
        </Link>
      </main>
    </div>
  );
}
