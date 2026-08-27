import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";
import { formatPhPhone } from "@/lib/phone";

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const phone = typeof params.phone === "string" ? params.phone : undefined;
  const next = typeof params.next === "string" ? params.next : "/";

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="glass sticky top-0 z-10 border-b border-[var(--glass-line)] px-4 pb-3 pt-3">
        <Link href={next} className="text-[13px] font-semibold text-green">
          ← Back
        </Link>
        <p className="mt-1 text-[15px] font-bold tracking-tight">
          {phone ? "Enter your code" : "Sign in to book"}
        </p>
        <p className="text-[11px] font-medium text-soft">
          {phone
            ? `Sent to ${formatPhPhone(phone)}`
            : "We text you a code. No password to remember."}
        </p>
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 pt-4">
        <AuthForm phone={phone} next={next} />
      </main>
    </div>
  );
}
