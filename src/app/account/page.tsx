import Link from "next/link";
import { redirect } from "next/navigation";
import { PasswordForm } from "@/components/PasswordForm";
import { formatPhPhone } from "@/lib/phone";
import { createSupabaseServer, getCurrentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=%2Faccount");

  // Read with the caller's own session — RLS keeps profiles to their owner.
  const session = await createSupabaseServer();
  const { data: profile } = await session
    .from("profiles")
    .select("password_set_at")
    .eq("id", user.id)
    .maybeSingle();

  // Shown straight after a first code sign-in, before the customer has gone
  // anywhere else.
  const first = params.first === "1";
  const next = typeof params.next === "string" && params.next.startsWith("/") ? params.next : "/my";

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="glass sticky top-0 z-10 border-b border-[var(--glass-line)] px-4 pb-3 pt-3">
        {!first && (
          <Link href="/my" className="text-[13px] font-semibold text-green">
            ← My bookings
          </Link>
        )}
        <p className="mt-1 text-[15px] font-bold tracking-tight">
          {first ? "You're in. One last thing." : "Password"}
        </p>
        <p className="text-[11px] font-medium text-soft">
          {user.phone ? formatPhPhone(`+${user.phone}`) : "Your account"}
        </p>
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 pt-4">
        <p className="text-[12.5px] leading-relaxed text-soft">
          {first
            ? "Choose a password before you book. Texts do not always arrive, and this is what lets you sign in when one does not — so you are never locked out of a court you have paid for."
            : "Setting a password lets you sign in straight away instead of waiting for a text. Codes keep working — this is an extra way in, not a replacement."}
        </p>

        <PasswordForm next={first ? next : undefined} needsCurrent={!!profile?.password_set_at} />

        <p className="px-1 text-[11.5px] leading-relaxed text-soft">
          {first
            ? "You only do this once. Forget it later and you can sign in with a code and set a new one — or ask at Kentjems Store and the operator will reset it."
            : "Forgotten it later? Sign in with a code and set a new one here. If texts are not arriving at all, ask at Kentjems Store and the operator can reset it for you."}
        </p>
      </main>
    </div>
  );
}
