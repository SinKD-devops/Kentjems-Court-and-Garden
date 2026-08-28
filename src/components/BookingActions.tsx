"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import {
  type BookingActionState,
  moveBooking,
  refundBooking,
} from "@/app/admin/booking/[id]/actions";
import type { Slot } from "@/lib/availability";
import { formatDayNumber, formatPeso, formatWeekday } from "@/lib/time";

const initial: BookingActionState = {};

/** Only weather and power, per the posted policy. */
const REFUND_REASONS = ["rain", "power interruption", "other"];

export function BookingActions({
  id,
  hours,
  status,
  priceCentavos,
  moveDate,
  dates,
  slots,
}: {
  id: string;
  hours: number;
  status: string;
  priceCentavos: number;
  moveDate: string;
  dates: string[];
  slots: Slot[];
}) {
  const [tab, setTab] = useState<"move" | "refund">("move");
  const canRefund = status === "confirmed";
  const canMove = ["requested", "proof_submitted", "confirmed"].includes(status);

  if (!canMove && !canRefund) {
    return (
      <p className="rounded-2xl border border-line bg-surface px-4 py-4 text-center text-[13px] text-soft">
        Nothing to do — this booking is {status.replace(/_/g, " ")}.
      </p>
    );
  }

  return (
    <>
      <div className="flex gap-1 rounded-full border border-line bg-surface p-1">
        {canMove && <Tab on={tab === "move"} onClick={() => setTab("move")}>Move</Tab>}
        {canRefund && <Tab on={tab === "refund"} onClick={() => setTab("refund")}>Refund</Tab>}
      </div>

      {tab === "move" && canMove && (
        <MoveForm
          id={id}
          hours={hours}
          moveDate={moveDate}
          dates={dates}
          slots={slots}
        />
      )}
      {tab === "refund" && canRefund && (
        <RefundForm id={id} priceCentavos={priceCentavos} />
      )}
    </>
  );
}

function Tab({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-full py-1.5 text-[13px] font-semibold ${
        on ? "bg-green text-white" : "text-soft"
      }`}
    >
      {children}
    </button>
  );
}

function MoveForm({
  id,
  hours,
  moveDate,
  dates,
  slots,
}: {
  id: string;
  hours: number;
  moveDate: string;
  dates: string[];
  slots: Slot[];
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(moveBooking, initial);

  const free = slots.filter((s) => s.state === "available" || s.state === "contested");
  const [startsAt, setStartsAt] = useState(free[0]?.startsAt ?? "");
  const [length, setLength] = useState(hours);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="startsAt" value={startsAt} />
      <input type="hidden" name="hours" value={length} />

      <p className="rounded-xl bg-tint px-3.5 py-2.5 text-[12.5px] font-semibold text-green-deep">
        The price stays the same. Moving someone at your convenience should not
        change what they paid.
      </p>

      <Field label="Move to day">
        <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {dates.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() =>
                router.push(`/admin/booking/${id}?date=${d}`)
              }
              className={`flex-none rounded-xl border px-3 py-1.5 ${
                d === moveDate ? "border-green bg-green text-white" : "border-line bg-surface"
              }`}
            >
              <span
                className={`block text-[9px] font-semibold uppercase ${
                  d === moveDate ? "text-white/80" : "text-faint"
                }`}
              >
                {formatWeekday(d)}
              </span>
              <span className="block text-[15px] font-bold tabular-nums">
                {formatDayNumber(d)}
              </span>
            </button>
          ))}
        </div>
      </Field>

      <Field label="New start time">
        {free.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface px-3.5 py-3 text-[13px] text-soft">
            Nothing free that day.
          </p>
        ) : (
          <select
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-[16px] font-semibold"
          >
            {free.map((slot) => (
              <option key={slot.startsAt} value={slot.startsAt}>
                {slot.label}
              </option>
            ))}
          </select>
        )}
      </Field>

      <Field label="Hours">
        <div className="flex gap-1.5">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setLength(n)}
              className={`flex-1 rounded-xl border py-2.5 text-[15px] font-bold tabular-nums ${
                n === length ? "border-green bg-green text-white" : "border-line bg-surface"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Reason (optional)">
        <input
          name="reason"
          placeholder="Why it moved"
          className="w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-[15px]"
        />
      </Field>

      {state.error && <ErrorNote>{state.error}</ErrorNote>}

      <button
        type="submit"
        disabled={pending || free.length === 0}
        className="rounded-full bg-green py-3.5 text-[14.5px] font-bold text-white shadow-[0_4px_12px_rgba(18,114,77,0.3)] disabled:opacity-60"
      >
        {pending ? "Moving…" : "Move and notify"}
      </button>
    </form>
  );
}

function RefundForm({ id, priceCentavos }: { id: string; priceCentavos: number }) {
  const [state, action, pending] = useActionState(refundBooking, initial);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />

      <p className="rounded-xl bg-[var(--amber-bg)] px-3.5 py-2.5 text-[12.5px] font-semibold text-amber">
        Refunds are only for weather or power interruptions. The cash goes back at
        the store — this records that you owe it.
      </p>

      <Field label="Reason">
        <select
          name="reason"
          className="w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-[16px] font-semibold"
        >
          {REFUND_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {reason}
            </option>
          ))}
        </select>
      </Field>

      {state.error && <ErrorNote>{state.error}</ErrorNote>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-[#EBCFCC] bg-surface py-3.5 text-[14.5px] font-bold text-red disabled:opacity-60"
      >
        {pending ? "Recording…" : `Refund ${formatPeso(priceCentavos)}`}
      </button>
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

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-xl bg-[var(--red-bg)] px-3.5 py-2.5 text-[13px] font-semibold text-red"
    >
      {children}
    </p>
  );
}
