import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminNav } from "@/components/AdminNav";
import { WalkInForm } from "@/components/WalkInForm";
import { bookableDates, getDayAvailability, listSpaces } from "@/lib/availability";
import { createSupabaseServer } from "@/lib/supabase/server";
import { todayKey } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function WalkInPage({ searchParams }: PageProps<"/admin/walk-in">) {
  const params = await searchParams;
  const supabase = await createSupabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in?next=%2Fadmin%2Fwalk-in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "operator") {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-[16px] font-bold">Operators only</p>
        <Link href="/" className="mt-2 text-[13px] font-semibold text-green">
          Back to slots
        </Link>
      </div>
    );
  }

  const spaces = (await listSpaces()).filter((s) => s.mode === "hourly");
  const spaceSlug = typeof params.space === "string" ? params.space : (spaces[0]?.slug ?? "court");
  const space = spaces.find((s) => s.slug === spaceSlug) ?? spaces[0];

  const today = todayKey();
  const dates = bookableDates(space, today);
  const date = typeof params.date === "string" && dates.includes(params.date) ? params.date : today;

  const availability = await getDayAvailability(spaceSlug, date, new Date(), space);
  const slots = availability.bands.flatMap((b) => b.slots);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="glass sticky top-0 z-10 border-b border-[var(--glass-line)] px-4 pb-3 pt-3">
        <p className="text-[15px] font-bold tracking-tight">Walk-in</p>
        <p className="text-[11px] font-medium text-soft">Book and take cash in one step</p>
        <div className="mt-2.5">
          <AdminNav active="/admin/walk-in" />
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-3 px-4 pb-8 pt-4">
        <WalkInForm
          spaces={spaces.map((s) => ({ slug: s.slug, name: s.name }))}
          spaceSlug={spaceSlug}
          dates={dates.slice(0, 8)}
          date={date}
          slots={slots}
        />
      </main>
    </div>
  );
}
