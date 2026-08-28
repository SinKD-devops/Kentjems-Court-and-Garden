"use client";

import { useRouter } from "next/navigation";
import { useActionState, useMemo, useState } from "react";
import { type WalkInState, createWalkIn } from "@/app/admin/walk-in/actions";
import type { Slot } from "@/lib/availability";
import { formatDayNumber, formatPeso, formatWeekday, todayKey } from "@/lib/time";

const initial: WalkInState = {};

/**
 * Counter entry for someone standing at the till.
 *
 * The spec calls for this to be the fastest path in the app, so it defaults to
 * the next free hour and a single hour's duration: for the common case the
 * operator types a name and a number and presses one button.
 *
 * Past hours stay selectable. Someone can already be on the court at ten past
 * the hour, and refusing to record that would leave the schedule wrong about a
 * court that is visibly in use.
 */
export function WalkInForm({
  spaces,
  spaceSlug,
  dates,
  date,
  slots,
}: {
  spaces: { slug: string; name: string }[];
  spaceSlug: string;
  dates: string[];
  date: string;
  slots: Slot[];
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(createWalkIn, initial);

  const selectable = useMemo(
    () => slots.filter((s) => s.state !== "booked" && s.state !== "pending_review"),
    [slots],
  );

  const defaultStart = useMemo(() => {
    const next = selectable.find((s) => s.state === "available" || s.state === "contested");
    return (next ?? selectable[0])?.startsAt ?? "";
  }, [selectable]);

  const [startsAt, setStartsAt] = useState(defaultStart);
  const [hours, setHours] = useState(1);

  const startIndex = selectable.findIndex((s) => s.startsAt === startsAt);
  const chosen = startIndex === -1 ? [] : selectable.slice(startIndex, startIndex + hours);
  const total = chosen.reduce((sum, s) => sum + (s.priceCentavos ?? 0), 0);
  const today = todayKey();

  function go(next: Record<string, string>) {
    const query = new URLSearchParams({ space: spaceSlug, date, ...next });
    router.push(`/admin/walk-in?${query.toString()}`);
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="space" value={spaceSlug} />
      <input type="hidden" name="startsAt" value={startsAt} />
      <input type="hidden" name="hours" value={hours} />

      {spaces.length > 1 && (
        <div className="flex gap-1 rounded-full border border-line bg-surface p-1">
          {spaces.map((s) => (
            <button
              key={s.slug}
              type="button"
              onClick={() => go({ space: s.slug })}
              className={`flex-1 rounded-full py-1.5 text-[13px] font-semibold ${
                s.slug === spaceSlug ? "bg-green text-white" : "text-soft"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <Field label="Day">
        <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {dates.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => go({ date: d })}
              className={`flex-none rounded-xl border px-3 py-1.5 text-center ${
                d === date ? "border-green bg-green text-white" : "border-line bg-surface"
              }`}
            >
              <span
                className={`block text-[9px] font-semibold uppercase tracking-[0.06em] ${
                  d === date ? "text-white/80" : "text-faint"
                }`}
              >
                {d === today ? "Today" : formatWeekday(d)}
              </span>
              <span className="block text-[15px] font-bold tabular-nums">
                {formatDayNumber(d)}
              </span>
            </button>
          ))}
        </div>
      </Field>

      <Field label="Start time">
        <select
          value={startsAt}
          onChange={(event) => setStartsAt(event.target.value)}
          className="w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-[16px] font-semibold outline-none focus:border-green"
        >
          {selectable.map((slot) => (
            <option key={slot.startsAt} value={slot.startsAt}>
              {slot.label}
              {slot.state === "past" ? " (past)" : ""}
              {slot.priceCentavos !== null ? ` · ${formatPeso(slot.priceCentavos)}` : ""}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Hours">
        <div className="flex gap-1.5">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setHours(n)}
              className={`flex-1 rounded-xl border py-2.5 text-[15px] font-bold tabular-nums ${
                n === hours ? "border-green bg-green text-white" : "border-line bg-surface"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Name">
        <input
          name="name"
          autoComplete="off"
          placeholder="Who is booking"
          className="w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-[16px] font-semibold outline-none focus:border-green focus:ring-3 focus:ring-green/15"
        />
      </Field>

      <Field label="Mobile number">
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          required
          placeholder="0917 123 4567"
          className="w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-[16px] font-semibold tabular-nums outline-none focus:border-green focus:ring-3 focus:ring-green/15"
        />
      </Field>

      {state.error && (
        <p
          role="alert"
          className="rounded-xl bg-[var(--red-bg)] px-3.5 py-2.5 text-[13px] font-semibold text-red"
        >
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || chosen.length === 0}
        className="rounded-full bg-green py-4 text-[15px] font-bold text-white shadow-[0_4px_12px_rgba(18,114,77,0.3)] disabled:opacity-60"
      >
        {pending ? "Saving…" : `Book and take ${formatPeso(total)}`}
      </button>

      <p className="px-1 text-center text-[11.5px] text-soft">
        Records the booking as paid in cash straight away.
      </p>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-faint">{label}</span>
      {children}
    </label>
  );
}
