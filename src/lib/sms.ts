import "server-only";

import { normalizePhPhone } from "@/lib/phone";

/**
 * Semaphore SMS client.
 *
 * Replaces PhilSMS, which delivered reliably to Globe and silently not at all
 * to Smart and TNT — while still reporting "Delivered" and charging for every
 * message. Four would-be customers requested a sign-in message and received
 * nothing. Semaphore covers Globe, Smart, Sun and DITO.
 *
 * Anything where money has moved goes by SMS rather than push. Push needs the
 * app installed and notifications granted, and on iOS the home screen too.
 * Someone who has paid must hear the outcome regardless.
 */

const API_URL = process.env.SEMAPHORE_API_URL ?? "https://api.semaphore.co/api/v4";

export interface SmsResult {
  ok: boolean;
  error?: string;
}

/**
 * Semaphore accepts local format, which is also what the operator types at the
 * counter. Numbers arrive in three shapes — Supabase stores them without the
 * leading plus, walk-ins are typed as 0917…, and some callers pass +63 — so
 * they are normalised here rather than at each call site, where a new caller
 * could reintroduce the bug by forgetting.
 */
function toLocal(raw: string): string {
  const e164 = normalizePhPhone(raw);
  if (e164) return `0${e164.slice(3)}`;
  return raw.replace(/[^\d]/g, "");
}

/**
 * Records every attempt, successful or not.
 *
 * Written with the secret key because it runs outside any customer session,
 * and deliberately swallows its own errors: a logging failure must never stop
 * a booking confirmation going out.
 */
async function logSms(recipient: string, kind: string, ok: boolean, error?: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return;

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await supabase.from("sms_log").insert({ recipient, kind, ok, error: error ?? null });
  } catch (caught) {
    console.error("Could not log SMS:", caught);
  }
}

export async function sendSms(
  to: string,
  message: string,
  kind = "unknown",
): Promise<SmsResult> {
  const apikey = process.env.SEMAPHORE_API_KEY;
  const sendername = process.env.SEMAPHORE_SENDER_NAME;

  if (!apikey) {
    const error = "SEMAPHORE_API_KEY is not set.";
    await logSms(to, kind, false, error);
    return { ok: false, error };
  }

  const recipient = toLocal(to);

  const body = new URLSearchParams({
    apikey,
    number: recipient,
    // Anything outside the GSM alphabet forces Unicode encoding, which cuts
    // the limit from 160 characters to 70. Enforced here so no caller can
    // slip one through.
    message: gsmSafe(message),
  });
  if (sendername) body.set("sendername", sendername);

  try {
    const response = await fetch(`${API_URL}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const payload = (await response.json().catch(() => null)) as unknown;
    const failure = describeFailure(response.status, payload);

    if (failure) {
      console.error(`SMS to ${recipient} rejected: ${failure}`);
      await logSms(recipient, kind, false, failure);
      return { ok: false, error: failure };
    }

    await logSms(recipient, kind, true);
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "SMS request failed";
    await logSms(recipient, kind, false, detail);
    return { ok: false, error: detail };
  }
}

/**
 * Semaphore answers 200 with an array of field errors on rejection — an
 * unregistered sender name comes back that way, not as an HTTP error. Treating
 * a 200 as success would mark undelivered messages as sent, which is exactly
 * the failure mode we just spent a day chasing on the previous provider.
 */
function describeFailure(status: number, payload: unknown): string | null {
  if (status >= 400) return `Semaphore returned ${status}`;
  if (!Array.isArray(payload) || payload.length === 0) return "Semaphore returned no result";

  const first = payload[0] as Record<string, unknown>;
  if (typeof first?.message_id === "number" || typeof first?.message_id === "string") return null;

  const problems = Object.entries(first)
    .map(([field, value]) => `${field}: ${Array.isArray(value) ? value.join(", ") : value}`)
    .join("; ");

  return problems || "Semaphore rejected the message";
}

export async function smsBalance(): Promise<string | null> {
  const apikey = process.env.SEMAPHORE_API_KEY;
  if (!apikey) return null;

  const response = await fetch(`${API_URL}/account?apikey=${apikey}`, { cache: "no-store" });
  if (!response.ok) return null;

  const body = (await response.json()) as { credit_balance?: number };
  return body.credit_balance === undefined ? null : String(body.credit_balance);
}

/**
 * Peso amounts for SMS.
 *
 * "PHP" rather than the peso sign, because that character is not in the GSM
 * alphabet. One of them forces the whole message into Unicode encoding, which
 * cuts the limit from 160 characters to 70 and routes differently on some
 * carriers.
 */
export function smsPesos(centavos: number): string {
  const pesos = centavos / 100;
  return `PHP ${Number.isInteger(pesos) ? pesos : pesos.toFixed(2)}`;
}

/**
 * Strips anything outside the GSM alphabet.
 *
 * Curly quotes, en dashes and the peso sign all creep in from copy written for
 * the screen, and each one silently doubles the cost of a message and halves
 * its length budget.
 */
export function gsmSafe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/₱/g, "PHP ")
    .replace(/…/g, "...");
}

/**
 * Message copy.
 *
 * Written to survive Philippine carrier filtering, which is aggressive about
 * anything resembling a scam or a marketing blast. So: no "code", "OTP",
 * "verify", "PIN" or "password"; no links; no shouting in capitals; no
 * urgency language. Plain sentences that read like a person wrote them.
 *
 * Each one still has to stand on its own — someone reading it on a lock screen
 * should know where they stand without opening the app. Rejections always
 * carry a number to call: the person believes they paid, and being told no
 * with no way to reply is how this becomes a public complaint.
 */
export const smsCopy = {
  approved: (space: string, when: string, reference: string) =>
    `Kentjems Court and Garden. Your booking is confirmed for ${space}, ${when}. Reference ${reference}. See you there.`,

  rejected: (reason: string, support: string) =>
    `Kentjems Court and Garden. We could not match your payment (${reason}), so that time is open again. Please call ${support}.`,

  confirmedAtCounter: (space: string, when: string) =>
    `Kentjems Court and Garden. Your booking is confirmed for ${space}, ${when}. See you there.`,

  superseded: (space: string, when: string) =>
    `Kentjems Court and Garden. Someone paid for ${space} on ${when} ahead of you, so that time is taken. Please pick another time.`,

  moved: (space: string, from: string, to: string) =>
    `Kentjems Court and Garden. Your ${space} booking has moved from ${from} to ${to}. Sorry for the change.`,

  /**
   * To the operator, not the customer. Enough to judge urgency from a lock
   * screen: which slot is now held, for how much, and the reference to check
   * against the real payment history.
   *
   * Kept tight because it goes to every operator number, so each payment
   * costs one credit per person — and a message over 160 characters would
   * quietly double that again.
   */
  proofToReview: (space: string, when: string, price: string, reference: string) =>
    `Kentjems Court and Garden. Payment to check: ${space} ${when}, ${price}, ref ${reference}. Held until you approve.`,

  /**
   * Written inline at the refund action until 30 August 2026, which kept it
   * out of `smsCopy` and therefore out of the test that checks every message
   * fits one part. It never did: the shortest plausible reason, "rain", came
   * to 167 characters, so every refund had been billed twice.
   *
   * The reason is operator-typed free text, so shortening the wording alone
   * would only move the cliff rather than remove it. The reason is given a
   * budget instead and trimmed to fit, which makes a second part impossible
   * rather than unlikely. Trimming is on a word boundary with nothing
   * appended — an ellipsis is not in the GSM alphabet, and `gsmSafe` would
   * expand it to three more characters after the length was decided.
   */
  refundApproved: (when: string, reason: string, amount: string, support: string) => {
    // Wording kept lean so the reason survives rather than the padding: every
    // word here is a word of "a power interruption" that gets truncated away.
    const head = `Kentjems Court and Garden. Your ${when} booking is cancelled`;
    const tail = `. Collect ${amount} refund at Kentjems Store. Call ${support}.`;
    const room = 160 - head.length - tail.length - " ()".length;

    const reasonText = reason.trim();
    let fitted = reasonText.length <= room ? reasonText : reasonText.slice(0, Math.max(0, room));
    if (fitted.length < reasonText.length) {
      fitted = fitted.slice(0, Math.max(0, fitted.lastIndexOf(" "))).trimEnd() || fitted.trimEnd();
    }

    return fitted ? `${head} (${fitted})${tail}` : `${head}${tail}`;
  },
};
