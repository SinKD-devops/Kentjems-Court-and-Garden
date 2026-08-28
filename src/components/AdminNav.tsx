import Link from "next/link";

const TABS = [
  { href: "/admin", label: "Today" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/walk-in", label: "Walk-in" },
] as const;

export function AdminNav({ active, pending }: { active: string; pending?: number }) {
  return (
    <nav aria-label="Counter console">
      <ul className="flex gap-1">
        {TABS.map((tab) => {
          const on = tab.href === active;
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={on ? "page" : undefined}
                className={`flex items-center justify-center gap-1.5 rounded-full py-1.5 text-center text-[13px] font-semibold ${
                  on ? "bg-green text-white" : "text-soft"
                }`}
              >
                {tab.label}
                {tab.label === "Payments" && pending ? (
                  <span
                    className={`rounded-full px-1.5 text-[10px] font-bold tabular-nums ${
                      on ? "bg-white/25 text-white" : "bg-[var(--red-bg)] text-red"
                    }`}
                  >
                    {pending}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
