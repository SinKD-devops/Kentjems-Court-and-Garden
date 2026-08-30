"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  type AuthState,
  sendCode,
  signInWithPassword,
  verifyCode,
} from "@/app/sign-in/actions";

const initial: AuthState = {};

export function AuthForm({
  phone,
  next,
  mode,
}: {
  phone?: string;
  next: string;
  mode?: string;
}) {
  if (phone) return <VerifyForm phone={phone} next={next} />;
  if (mode === "password") return <PasswordSignIn next={next} />;
  return <PhoneForm next={next} />;
}

/**
 * The fallback path, for when a text does not arrive.
 *
 * Offered as a quiet alternative rather than a first-class choice: a code is
 * still the better default — nothing to remember, nothing to leak — and only
 * someone who has already set a password can use this.
 */
function PasswordSignIn({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signInWithPassword, initial);

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />

        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-faint">
            Mobile number
          </span>
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            autoFocus
            required
            placeholder="0917 123 4567"
            className="rounded-xl border border-line bg-surface px-3.5 py-3 text-[16px] font-semibold tabular-nums outline-none focus:border-green focus:ring-3 focus:ring-green/15"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-faint">
            Password
          </span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="rounded-xl border border-line bg-surface px-3.5 py-3 text-[16px] font-semibold outline-none focus:border-green focus:ring-3 focus:ring-green/15"
          />
        </label>

        {state.error && <ErrorNote>{state.error}</ErrorNote>}

        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-green py-3 text-[14px] font-bold text-white shadow-[0_4px_12px_rgba(18,114,77,0.3)] disabled:opacity-60"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <Link
        href={`/sign-in?next=${encodeURIComponent(next)}`}
        className="text-center text-[13px] font-semibold text-soft"
      >
        Text me a code instead
      </Link>
    </div>
  );
}

function PhoneForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(sendCode, initial);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />

      <label className="flex flex-col gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-faint">
          Mobile number
        </span>
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          autoFocus
          required
          placeholder="0917 123 4567"
          className="rounded-xl border border-line bg-surface px-3.5 py-3 text-[16px] font-semibold tabular-nums outline-none focus:border-green focus:ring-3 focus:ring-green/15"
        />
      </label>

      {state.error && <ErrorNote>{state.error}</ErrorNote>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-green py-3 text-[14px] font-bold text-white shadow-[0_4px_12px_rgba(18,114,77,0.3)] disabled:opacity-60"
      >
        {pending ? "Sending…" : "Text me a code"}
      </button>

      <Link
        href={`/sign-in?mode=password&next=${encodeURIComponent(next)}`}
        className="text-center text-[13px] font-semibold text-soft"
      >
        Use a password instead
      </Link>
    </form>
  );
}

function VerifyForm({ phone, next }: { phone: string; next: string }) {
  const [state, action, pending] = useActionState(verifyCode, initial);

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="phone" value={phone} />
        <input type="hidden" name="next" value={next} />

        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-faint">
            6-digit code
          </span>
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            maxLength={8}
            placeholder="······"
            className="rounded-xl border border-line bg-surface px-3.5 py-3 text-center text-[22px] font-bold tracking-[0.35em] tabular-nums outline-none focus:border-green focus:ring-3 focus:ring-green/15"
          />
        </label>

        {state.error && <ErrorNote>{state.error}</ErrorNote>}

        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-green py-3 text-[14px] font-bold text-white shadow-[0_4px_12px_rgba(18,114,77,0.3)] disabled:opacity-60"
        >
          {pending ? "Checking…" : "Continue"}
        </button>
      </form>

      <Link
        href={`/sign-in?next=${encodeURIComponent(next)}`}
        className="text-center text-[13px] font-semibold text-soft"
      >
        Use a different number
      </Link>
    </div>
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
