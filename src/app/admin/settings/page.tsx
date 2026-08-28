import { redirect } from "next/navigation";
import { removeClosure } from "@/app/admin/settings/actions";
import { AdminNav } from "@/components/AdminNav";
import { ClosureForm, HoursForm, RatesForm, RulesForm } from "@/components/SettingsForms";
import { createSupabaseServer } from "@/lib/supabase/server";
import { formatLongDate } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createSupabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in?next=%2Fadmin%2Fsettings");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "operator") redirect("/");

  const [{ data: spaces }, { data: rates }, { data: hours }, { data: settings }, { data: closures }] =
    await Promise.all([
      supabase.from("spaces").select("id, slug, name").order("sort_order"),
      supabase
        .from("pricing_rules")
        .select("id, space_id, label, starts_at_time, ends_at_time, price_centavos")
        .order("starts_at_time"),
      supabase.from("opening_hours").select("id, space_id, opens_at, closes_at"),
      supabase.from("settings").select("*").single(),
      supabase.from("closure_windows").select("*").order("starts_at"),
    ]);

  const spaceList = spaces ?? [];
  const nameOf = (id: string) => spaceList.find((s) => s.id === id)?.name ?? "";

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="glass sticky top-0 z-10 border-b border-[var(--glass-line)] px-4 pb-3 pt-3">
        <p className="text-[15px] font-bold tracking-tight">Settings</p>
        <p className="text-[11px] font-medium text-soft">
          Changes apply to new bookings straight away
        </p>
        <div className="mt-2.5">
          <AdminNav active="/admin/settings" />
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-6 px-4 pb-10 pt-4">
        <Section title="Rates per hour">
          <RatesForm
            rates={(rates ?? []).map((r) => ({
              id: r.id,
              spaceName: nameOf(r.space_id),
              label: r.label ?? "Rate",
              from: r.starts_at_time,
              to: r.ends_at_time,
              priceCentavos: r.price_centavos,
            }))}
          />
        </Section>

        <Section title="Opening hours">
          <HoursForm
            hours={(hours ?? []).map((h) => ({
              id: h.id,
              spaceName: nameOf(h.space_id),
              opens: h.opens_at.slice(0, 5),
              closes: h.closes_at.slice(0, 5),
            }))}
          />
        </Section>

        <Section title="Payment rules">
          <RulesForm
            expiry={settings?.request_expiry_minutes ?? 30}
            windowOpens={(settings?.gcash_window_opens_at ?? "06:00:00").slice(0, 5)}
            windowCloses={(settings?.gcash_window_closes_at ?? "23:00:00").slice(0, 5)}
            lastSubmission={(settings?.last_submission_time ?? "22:30:00").slice(0, 5)}
            payeeName={settings?.payee_name ?? ""}
            payeeNumber={settings?.payee_number ?? ""}
          />
        </Section>

        <Section title="Closures">
          {(closures ?? []).length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {(closures ?? []).map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-bold">{c.reason}</p>
                    <p className="text-[11px] font-medium text-soft">
                      {nameOf(c.space_id)} · {formatLongDate(localDate(c.starts_at))}
                    </p>
                  </div>
                  <form action={removeClosure}>
                    <input type="hidden" name="id" value={c.id} />
                    <button
                      type="submit"
                      className="flex-none text-[12px] font-semibold text-red underline underline-offset-2"
                    >
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <ClosureForm spaces={spaceList.map((s) => ({ id: s.id, name: s.name }))} />
        </Section>
      </main>
    </div>
  );
}

function localDate(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[10px] font-bold uppercase tracking-[0.13em] text-faint">{title}</h2>
      {children}
    </section>
  );
}
