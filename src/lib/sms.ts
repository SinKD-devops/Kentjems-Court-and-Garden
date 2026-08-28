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
        message,
      }),
    });

    const body = (await response.json().catch(() => null)) as
      | { status?: string; message?: string }
      | null;

    if (!response.ok || body?.status === "error") {
      const detail = body?.message ?? `PhilSMS returned ${response.status}`;
      console.error(`SMS to  rejected: `);
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
 * Message copy.
 *
 * Each one has to stand on its own — a customer reading this on the lock
 * screen should not need to open the app to know where they stand. Rejections
 * always carry a number to call: the person believes they paid, and being
 * told no with no way to reply is how this becomes a public complaint.
 */
export const smsCopy = {
  approved: (space: string, when: string, reference: string) =>
    `Kentjems: PAID. ${space}, ${when}. Ref ${reference}. See you there.`,

  rejected: (reason: string, support: string) =>
    `Kentjems: payment not accepted (${reason}). Slot released. Call ${support}.`,

  confirmedAtCounter: (space: string, when: string) =>
    `Kentjems: PAID. ${space}, ${when}. See you there.`,

  superseded: (space: string, when: string) =>
    `Kentjems: someone paid for ${space} ${when} first, so your request is cancelled. Please pick another time.`,

  moved: (space: string, from: string, to: string) =>
    `Kentjems: your ${space} booking moved from ${from} to ${to}. Sorry for the change.`,
};
