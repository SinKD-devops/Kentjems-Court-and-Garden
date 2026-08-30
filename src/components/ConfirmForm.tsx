"use client";

import { useActionState } from "react";
import { type RequestState, createRequest } from "@/app/book/actions";
import { COURT_PURPOSES } from "@/lib/purposes";

const initial: RequestState = {};

export function ConfirmForm({
  space,
  startsAt,
  hours,
  needsName,
  needsTerms,
  needsPurpose,
  contested,
}: {
  space: string;
  startsAt: string;
  hours: number;
  needsName: boolean;
  needsTerms: boolean;
  needsPurpose: boolean;
  contested: number;
}) {
  const [state, action, pending] = useActionState(createRequest, initial);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="space" value={space} />
      <input type="hidden" name="startsAt" value={startsAt} />
      <input type="hidden" name="hours" value={hours} />

      {needsName && (
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-faint">
            Your name
          </span>
          <input
            name="name"
            autoComplete="name"
            required
            placeholder="So we know who has the court"
            className="rounded-xl border border-line bg-surface px-3.5 py-3 text-[16px] font-semibold outline-none focus:border-green focus:ring-3 focus:ring-green/15"
          />
        </label>
      )}

      {needsPurpose && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-faint">
            What is the court for?
          </span>
          <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {COURT_PURPOSES.map((purpose) => (
              <label key={purpose.value} className="flex-none cursor-pointer">
                <input
                  type="radio"
                  name="purpose"
                  value={purpose.value}
                  required
                  className="peer sr-only"
                />
                <span className="block rounded-xl border border-line bg-surface px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap peer-checked:border-green peer-checked:bg-green peer-checked:text-white peer-focus-visible:ring-3 peer-focus-visible:ring-green/25">
                  {purpose.label}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {contested > 0 && (
        <p className="rounded-xl bg-tint px-3.5 py-2.5 text-[12.5px] font-semibold text-green-deep">
          {contested === 1 ? "1 other person is" : `${contested} other people are`} trying to
          pay for this slot right now.
        </p>
      )}

      {needsTerms && (
        <label className="flex items-start gap-2.5 rounded-2xl border border-line bg-surface px-4 py-3.5">
          <input
            type="checkbox"
            name="terms"
            required
            className="mt-0.5 size-4 flex-none accent-[var(--green)]"
          />
          <span className="text-[12.5px] leading-relaxed text-soft">
            I understand there are <b className="text-ink">no cancellations or refunds</b>,
            except for weather or power interruptions approved by the operator.
          </span>
        </label>
      )}

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
        disabled={pending}
        className="rounded-full bg-green py-3.5 text-[14.5px] font-bold text-white shadow-[0_4px_12px_rgba(18,114,77,0.3)] disabled:opacity-60"
      >
        {pending ? "Requesting…" : hours === 1 ? "Request this hour" : `Request these ${hours} hours`}
      </button>
    </form>
  );
}
