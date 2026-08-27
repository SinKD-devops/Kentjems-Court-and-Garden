"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Ticking countdown to a request's expiry.
 *
 * The deadline is computed by the database and passed in as an instant, so a
 * customer whose phone clock is wrong still sees the real remaining time
 * rather than their own drift. When it reaches zero the page refreshes, since
 * the slot is now free for anyone.
 */
export function Countdown({ expiresAt }: { expiresAt: string }) {
  const router = useRouter();
  const [remaining, setRemaining] = useState(() => msLeft(expiresAt));

  useEffect(() => {
    const id = setInterval(() => {
      const next = msLeft(expiresAt);
      setRemaining(next);
      if (next <= 0) {
        clearInterval(id);
        router.refresh();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt, router]);

  if (remaining <= 0) {
    return <Pill tone="dead">Expired</Pill>;
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return (
    <Pill tone={minutes < 10 ? "urgent" : "warn"}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {minutes}:{String(seconds).padStart(2, "0")} left to pay
    </Pill>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: "warn" | "urgent" | "dead";
  children: React.ReactNode;
}) {
  const styles = {
    warn: "bg-[var(--amber-bg)] text-amber",
    urgent: "bg-[var(--red-bg)] text-red",
    dead: "bg-sunken text-soft",
  } as const;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-bold tabular-nums ${styles[tone]}`}
    >
      {children}
    </span>
  );
}

function msLeft(expiresAt: string) {
  return new Date(expiresAt).getTime() - Date.now();
}
