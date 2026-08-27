import { NextResponse } from "next/server";
import { sendSms } from "@/lib/sms";

/**
 * Supabase "Send SMS" auth hook.
 *
 * Supabase's built-in phone auth only speaks to Twilio, MessageBird, Vonage
 * and TextLocal — PhilSMS is not on that list. This hook takes over delivery
 * so OTP goes through the same provider as booking notifications: one bill,
 * one deliverability profile, and swapping vendors later is a change to this
 * file rather than an auth migration.
 *
 * Configure at Supabase → Authentication → Hooks → Send SMS:
 *   URI:    https://<your-domain>/api/auth/sms-hook
 *   Secret: paste into SUPABASE_SMS_HOOK_SECRET
 *
 * Supabase cannot reach localhost, so during development use test phone
 * numbers (Authentication → Sign In / Providers → Phone → Test OTP) instead.
 */

interface HookPayload {
  user: { phone: string };
  sms: { otp: string };
}

export async function POST(request: Request) {
  const secret = process.env.SUPABASE_SMS_HOOK_SECRET;
  const raw = await request.text();

  // Refuse to run unauthenticated: this endpoint spends money per call.
  if (!secret) {
    return NextResponse.json({ error: "Hook secret is not configured." }, { status: 500 });
  }

  const verified = await verifySignature(raw, request.headers, secret);
  if (!verified) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let payload: HookPayload;
  try {
    payload = JSON.parse(raw) as HookPayload;
  } catch {
    return NextResponse.json({ error: "Malformed payload." }, { status: 400 });
  }

  const phone = payload.user?.phone;
  const otp = payload.sms?.otp;
  if (!phone || !otp) {
    return NextResponse.json({ error: "Missing phone or OTP." }, { status: 400 });
  }

  const result = await sendSms(
    phone.startsWith("+") ? phone : `+${phone}`,
    `${otp} is your Kentjems code. It expires in 5 minutes. Do not share it.`,
  );

  if (!result.ok) {
    // Supabase surfaces this to the caller and does not mark the OTP sent.
    return NextResponse.json(
      { error: { http_code: 502, message: result.error ?? "Could not send the code." } },
      { status: 502 },
    );
  }

  return NextResponse.json({});
}

/**
 * Standard Webhooks signature check.
 *
 * Supabase signs with a base64 secret prefixed `v1,whsec_`. The signed
 * content is `id.timestamp.body`, and the header may carry several
 * space-separated signatures during a secret rotation.
 */
async function verifySignature(
  body: string,
  headers: Headers,
  secret: string,
): Promise<boolean> {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatureHeader = headers.get("webhook-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  // Reject anything older than five minutes, so a captured request cannot be
  // replayed later to burn SMS credit.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const rawSecret = secret.replace(/^v1,whsec_/, "").replace(/^whsec_/, "");
  const keyBytes = Uint8Array.from(atob(rawSecret), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signed = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
  const digest = await crypto.subtle.sign("HMAC", key, signed);
  const expected = btoa(String.fromCharCode(...new Uint8Array(digest)));

  return signatureHeader
    .split(" ")
    .map((part) => part.split(",").at(-1) ?? "")
    .some((candidate) => timingSafeEqual(candidate, expected));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
