import "server-only";

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

export async function sendSms(to: string, message: string): Promise<SmsResult> {
  const token = process.env.PHILSMS_API_TOKEN;
  const senderId = process.env.PHILSMS_SENDER_ID;

  if (!token) return { ok: false, error: "PHILSMS_API_TOKEN is not set." };

  try {
    const response = await fetch(`${API_URL}/sms/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        recipient: to,
        sender_id: senderId,
        type: "plain",
        message,
      }),
    });

    const body = (await response.json().catch(() => null)) as
      | { status?: string; message?: string }
      | null;

    if (!response.ok || body?.status === "error") {
      return { ok: false, error: body?.message ?? `PhilSMS returned ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "SMS request failed" };
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
