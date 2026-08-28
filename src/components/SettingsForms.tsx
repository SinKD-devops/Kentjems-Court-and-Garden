"use client";

import { useActionState } from "react";
import {
  type SettingsState,
  addClosure,
  saveHours,
  saveRates,
  saveRules,
} from "@/app/admin/settings/actions";

const initial: SettingsState = {};

function Notice({ state }: { state: SettingsState }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className="rounded-xl bg-[var(--red-bg)] px-3.5 py-2.5 text-[13px] font-semibold text-red"
      >
        {state.error}
      </p>
    );
  }
  if (state.saved) {
    return (
      <p className="rounded-xl bg-tint px-3.5 py-2.5 text-[13px] font-semibold text-green-deep">
        {state.saved}
      </p>
    );
  }
  return null;
}

function Save({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-green py-3 text-[14px] font-bold text-white shadow-[0_4px_12px_rgba(18,114,77,0.3)] disabled:opacity-60"
    >
      {pending ? "Saving…" : children}
    </button>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5">
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-bold">{label}</span>
        {hint && <span className="block text-[11px] font-medium text-soft">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function RatesForm({
  rates,
}: {
  rates: { id: string; spaceName: string; label: string; from: string; to: string; priceCentavos: number }[];
}) {
  const [state, action, pending] = useActionState(saveRates, initial);

  return (
    <form action={action} className="flex flex-col gap-2">
      {rates.map((rate) => (
        <Row
          key={rate.id}
          label={`${rate.spaceName} · ${rate.label}`}
          hint={`${rate.from.slice(0, 5)} – ${rate.to.slice(0, 5)}`}
        >
          <span className="flex flex-none items-center gap-1">
            <span className="text-[15px] font-bold text-soft">₱</span>
            <input
              name={`rate:${rate.id}`}
              inputMode="decimal"
              defaultValue={(rate.priceCentavos / 100).toString()}
              className="w-20 rounded-lg border border-line bg-bg px-2 py-1.5 text-right text-[15px] font-bold tabular-nums outline-none focus:border-green"
            />
          </span>
        </Row>
      ))}
      <Notice state={state} />
      <Save pending={pending}>Save rates</Save>
    </form>
  );
}

export function HoursForm({
  hours,
}: {
  hours: { id: string; spaceName: string; opens: string; closes: string }[];
}) {
  const [state, action, pending] = useActionState(saveHours, initial);

  return (
    <form action={action} className="flex flex-col gap-2">
      {hours.map((h) => (
        <div
          key={h.id}
          className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3.5 py-2.5"
        >
          <span className="text-[13px] font-bold">{h.spaceName}</span>
          <span className="flex flex-none items-center gap-1.5">
            <input
              name={`opens:${h.id}`}
              type="time"
              defaultValue={h.opens}
              className="rounded-lg border border-line bg-bg px-2 py-1.5 text-[14px] font-semibold tabular-nums"
            />
            <span className="text-[13px] text-soft">to</span>
            <input
              name={`closes:${h.id}`}
              type="time"
              defaultValue={h.closes}
              className="rounded-lg border border-line bg-bg px-2 py-1.5 text-[14px] font-semibold tabular-nums"
            />
          </span>
        </div>
      ))}
      <p className="px-1 text-[11.5px] leading-relaxed text-soft">
        Closing at midnight is written 00:00 and saved as the end of the day.
      </p>
      <Notice state={state} />
      <Save pending={pending}>Save hours</Save>
    </form>
  );
}

export function RulesForm({
  expiry,
  windowOpens,
  windowCloses,
  lastSubmission,
  payeeName,
  payeeNumber,
}: {
  expiry: number;
  windowOpens: string;
  windowCloses: string;
  lastSubmission: string;
  payeeName: string;
  payeeNumber: string;
}) {
  const [state, action, pending] = useActionState(saveRules, initial);

  return (
    <form action={action} className="flex flex-col gap-2">
      <Row label="Payment window" hint="Minutes before a request expires">
        <input
          name="expiry"
          inputMode="numeric"
          defaultValue={expiry}
          className="w-20 flex-none rounded-lg border border-line bg-bg px-2 py-1.5 text-right text-[15px] font-bold tabular-nums outline-none focus:border-green"
        />
      </Row>
      <Row label="Online payment opens">
        <input
          name="windowOpens"
          type="time"
          defaultValue={windowOpens}
          className="flex-none rounded-lg border border-line bg-bg px-2 py-1.5 text-[14px] font-semibold tabular-nums"
        />
      </Row>
      <Row label="Online payment closes">
        <input
          name="windowCloses"
          type="time"
          defaultValue={windowCloses}
          className="flex-none rounded-lg border border-line bg-bg px-2 py-1.5 text-[14px] font-semibold tabular-nums"
        />
      </Row>
      <Row label="Last proof accepted" hint="Leaves you time to review before closing">
        <input
          name="lastSubmission"
          type="time"
          defaultValue={lastSubmission}
          className="flex-none rounded-lg border border-line bg-bg px-2 py-1.5 text-[14px] font-semibold tabular-nums"
        />
      </Row>
      <Row label="Payments go to">
        <input
          name="payeeName"
          defaultValue={payeeName}
          className="w-36 flex-none rounded-lg border border-line bg-bg px-2 py-1.5 text-right text-[14px] font-semibold outline-none focus:border-green"
        />
      </Row>
      <Row label="Payee number">
        <input
          name="payeeNumber"
          defaultValue={payeeNumber}
          className="w-36 flex-none rounded-lg border border-line bg-bg px-2 py-1.5 text-right text-[14px] font-semibold tabular-nums outline-none focus:border-green"
        />
      </Row>
      <Notice state={state} />
      <Save pending={pending}>Save rules</Save>
    </form>
  );
}

export function ClosureForm({ spaces }: { spaces: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(addClosure, initial);

  return (
    <form action={action} className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3.5">
      <p className="text-[12.5px] font-bold">Close a space</p>
      <select
        name="spaceId"
        className="rounded-lg border border-line bg-bg px-3 py-2.5 text-[15px] font-semibold"
      >
        {spaces.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-2">
        <input
          name="from"
          type="date"
          required
          className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-2 py-2.5 text-[14px] font-semibold tabular-nums"
        />
        <span className="text-[13px] text-soft">to</span>
        <input
          name="to"
          type="date"
          required
          className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-2 py-2.5 text-[14px] font-semibold tabular-nums"
        />
      </div>
      <input
        name="reason"
        required
        placeholder="Reason — customers see this"
        className="rounded-lg border border-line bg-bg px-3 py-2.5 text-[15px]"
      />
      <p className="text-[11.5px] leading-relaxed text-soft">
        Both dates are included. Existing bookings are not cancelled — move or refund
        those yourself.
      </p>
      <Notice state={state} />
      <Save pending={pending}>Add closure</Save>
    </form>
  );
}
