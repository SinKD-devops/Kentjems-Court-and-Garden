"use client";

import { useActionState } from "react";
import { type PasswordState, setPassword } from "@/app/account/actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";

const initial: PasswordState = {};

export function PasswordForm({
  next,
  needsCurrent,
}: {
  next?: string;
  needsCurrent?: boolean;
}) {
  const [state, action, pending] = useActionState(setPassword, initial);

  if (state.done) {
    return (
      <p className="rounded-xl bg-tint px-3.5 py-3 text-[13px] font-semibold text-green-deep">
        Password saved. You can now sign in with your number and password, without
        waiting for a text.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      {next && <input type="hidden" name="next" value={next} />}

      {needsCurrent && (
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-faint">
            Current password
          </span>
          <input
            name="current"
            type="password"
            autoComplete="current-password"
            required
            className="rounded-xl border border-line bg-surface px-3.5 py-3 text-[16px] font-semibold outline-none focus:border-green focus:ring-3 focus:ring-green/15"
          />
        </label>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-faint">
          New password
        </span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          className="rounded-xl border border-line bg-surface px-3.5 py-3 text-[16px] font-semibold outline-none focus:border-green focus:ring-3 focus:ring-green/15"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-faint">
          Type it again
        </span>
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          className="rounded-xl border border-line bg-surface px-3.5 py-3 text-[16px] font-semibold outline-none focus:border-green focus:ring-3 focus:ring-green/15"
        />
      </label>

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
        className="rounded-full bg-green py-3 text-[14px] font-bold text-white shadow-[0_4px_12px_rgba(18,114,77,0.3)] disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
