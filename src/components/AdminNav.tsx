import Link from "next/link";

const TABS = [
  { href: "/admin", label: "Today" },
  { href: "/admin/payments", label: "Pay" },
  { href: "/admin/walk-in", label: "Walk-in" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/refunds", label: "Refunds" },
  { href: "/admin/settings", label: "Settings" },
] as const;

export function AdminNav({ active, pending }: { active: string; pending?: number }) {
  return (
    <nav aria-label="Counter console">
      <ul className="flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((tab) => {
          const on = tab.href === active;
          return (
            <li key={tab.href} className="flex-none">
              <Link
                href={tab.href}
                aria-current={on ? "page" : undefined}
                className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-semibold ${
                  on ? "bg-green text-white" : "text-soft"
                }`}
              >
                {tab.label}
                {tab.href === "/admin/payments" && pending ? (
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
