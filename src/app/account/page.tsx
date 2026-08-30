import Link from "next/link";
import { redirect } from "next/navigation";
import { PasswordForm } from "@/components/PasswordForm";
import { formatPhPhone } from "@/lib/phone";
import { getCurrentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=%2Faccount");

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="glass sticky top-0 z-10 border-b border-[var(--glass-line)] px-4 pb-3 pt-3">
        <Link href="/my" className="text-[13px] font-semibold text-green">
          ← My bookings
        </Link>
        <p className="mt-1 text-[15px] font-bold tracking-tight">Password</p>
        <p className="text-[11px] font-medium text-soft">
          {user.phone ? formatPhPhone(`+${user.phone}`) : "Your account"}
        </p>
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 pt-4">
        <p className="text-[12.5px] leading-relaxed text-soft">
          Setting a password lets you sign in straight away instead of waiting for a
          text. Codes keep working — this is an extra way in, not a replacement.
        </p>

        <PasswordForm />

        <p className="px-1 text-[11.5px] leading-relaxed text-soft">
          Forgotten it later? Sign in with a code and set a new one here. If texts are
          not arriving at all, ask at Kentjems Store and the operator can reset it for
          you.
        </p>
      </main>
    </div>
  );
}
