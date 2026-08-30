import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";
import { formatPhPhone } from "@/lib/phone";

/**
 * Where "Back" should actually go.
 *
 * Never to `next`: that is the page which just bounced the visitor here for
 * not being signed in, so linking to it sends them straight back to sign-in —
 * a loop with no way out but the browser's own back button.
 *
 * A booking attempt returns to that day's grid, so the hours they were looking
 * at are still in front of them. Anything else returns to the front page.
 */
function backTarget(next: string): string {
  if (!next.startsWith("/book")) return "/";

  const query = new URLSearchParams(next.slice(next.indexOf("?") + 1));
  const space = query.get("space") ?? "court";
  const start = query.get("start");
  if (!start) return `/?space=${space}`;

  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(start));

  return `/?space=${space}&date=${date}`;
}

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const phone = typeof params.phone === "string" ? params.phone : undefined;
  const next = typeof params.next === "string" ? params.next : "/";
  const mode = typeof params.mode === "string" ? params.mode : undefined;
  const password = !phone && mode === "password";

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="glass sticky top-0 z-10 border-b border-[var(--glass-line)] px-4 pb-3 pt-3">
        <Link href={backTarget(next)} className="text-[13px] font-semibold text-green">
          ← Back to slots
        </Link>
        <p className="mt-1 text-[15px] font-bold tracking-tight">
          {phone ? "Enter your code" : "Sign in to book"}
        </p>
        <p className="text-[11px] font-medium text-soft">
          {phone
            ? `Sent to ${formatPhPhone(phone)}`
            : password
              ? "For accounts that have set one."
              : "We text you a code. No password to remember."}
        </p>
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 pt-4">
        <AuthForm phone={phone} next={next} mode={mode} />
      </main>
    </div>
  );
}
