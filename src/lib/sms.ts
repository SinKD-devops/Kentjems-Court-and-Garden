import "server-only";

import { normalizePhPhone } from "@/lib/phone";

/**
 * PhilSMS client.
 *
 * One provider for both OTP and booking notifications: one bill, one
 * deliverability profile to monitor, and one place to swap if rates change.
 *
 * Anything where money has moved goes by SMS rather than push. Push needs the
 * app installed and notifications granted — and on iOS, added to the home
 * screen first. Someone who has paid must hear the outcome regardless.
 */

const API_URL = process.env.PHILSMS_API_URL ?? "https://dashboard.philsms.com/api/v3";

export interface SmsResult {
  ok: boolean;
  error?: string;
}

/**
 * PhilSMS requires E.164. Numbers reach here in three shapes and none of them
 * are it: Supabase stores a signed-in customer's phone without the leading
 * plus ("639171234567"), walk-ins are typed at the counter in local form
 * ("0917 123 4567"), and only some callers pass "+63...".
 *
 * Normalising here rather than at each call site means a new caller cannot
 * reintroduce the bug by forgetting.
 */
function toE164(raw: string): string {
  const normalized = normalizePhPhone(raw);
  if (normalized) return normalized;

  // Not a Philippine mobile — pass it through, but never without the plus.
  const digits = raw.replace(/[^\d]/g, "");
  return digits.startsWith("+") ? digits : `+${digits}`;
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
  const token = process.env.PHILSMS_API_TOKEN;
  const senderId = process.env.PHILSMS_SENDER_ID;

  if (!token) {
    const error = "PHILSMS_API_TOKEN is not set.";
    await logSms(to, kind, false, error);
    return { ok: false, error };
  }

  const recipient = toE164(to);

  try {
    const response = await fetch(`${API_URL}/sms/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        recipient,
        sender_id: senderId,
        type: "plain",
        // Anything outside the GSM alphabet forces Unicode encoding, which
        // cuts the limit to 70 characters and is routed differently by some
        // carriers. Enforced here so no caller can slip one through.
        message: gsmSafe(message),
      }),
    });

    const body = (await response.json().catch(() => null)) as
      | { status?: string; message?: string }
      | null;

    if (!response.ok || body?.status === "error") {
      const detail = body?.message ?? `PhilSMS returned ${response.status}`;
      console.error(`SMS to ${recipient} rejected: ${detail}`);
      await logSms(recipient, kind, false, detail);
      return { ok: false, error: detail };
    }
    await logSms(recipient, kind, true);
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "SMS request failed";
    await logSms(recipient, kind, false, detail);
    return { ok: false, error: detail };
  }
}

export async function smsBalance(): Promise<string | null> {
  const token = process.env.PHILSMS_API_TOKEN;
  if (!token) return null;

  const response = await fetch(`${API_URL}/balance`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) return null;

  const body = (await response.json()) as { data?: { remaining_balance?: string } };
  return body.data?.remaining_balance ?? null;
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
    `Kentjems Court and Garden. We could not match your payment (${reason}), so that time is open again. Please call ${support} and we will sort it out.`,

  confirmedAtCounter: (space: string, when: string) =>
    `Kentjems Court and Garden. Your booking is confirmed for ${space}, ${when}. See you there.`,

  superseded: (space: string, when: string) =>
    `Kentjems Court and Garden. Someone paid for ${space} on ${when} ahead of you, so that time is taken. Please pick another and we will hold it for you.`,

  moved: (space: string, from: string, to: string) =>
    `Kentjems Court and Garden. Your ${space} booking has moved from ${from} to ${to}. Sorry for the change.`,

  /**
   * To the operator, not the customer. Enough to judge urgency from a lock
   * screen: which slot is now held, for how much, and the reference to check
   * against the real payment history.
   */
  proofToReview: (space: string, when: string, price: string, reference: string) =>
    `Kentjems Court and Garden. A payment is waiting for you to check: ${space} ${when}, ${price}, reference ${reference}. That time is held until you approve it.`,
};
