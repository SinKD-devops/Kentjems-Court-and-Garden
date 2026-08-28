import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { sendSms, smsBalance } from "@/lib/sms";

/**
 * Warns the operator before SMS credit runs out.
 *
 * OTP is the only way anyone signs in, so an empty balance is a total outage:
 * no new customers, and existing ones locked out of their own bookings. It
 * would be discovered from a complaint rather than from the system, which is
 * the worst way to find out.
 *
 * The warning costs one message, and only when it is needed.
 */

export const dynamic = "force-dynamic";

const LOW_BALANCE_PESOS = 50;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set." }, { status: 500 });
  }

  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const raw = await smsBalance();
  if (raw === null) {
    return NextResponse.json({ error: "Could not read the balance." }, { status: 502 });
  }

  // PhilSMS returns it as a display string like "₱286".
  const pesos = Number(raw.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(pesos)) {
    return NextResponse.json({ error: `Unrecognised balance: ${raw}` }, { status: 502 });
  }

  if (pesos > LOW_BALANCE_PESOS) {
    return NextResponse.json({ balance: pesos, warned: false });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 500 });
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Warn once a day, not once an hour. A daily nudge is a reminder; an hourly
  // one is noise that gets ignored precisely when it matters.
  const since = new Date(Date.now() - 20 * 3_600_000).toISOString();
  const { count } = await supabase
    .from("sms_log")
    .select("*", { count: "exact", head: true })
    .eq("kind", "low-balance")
    .eq("ok", true)
    .gte("created_at", since);

  if ((count ?? 0) > 0) {
    return NextResponse.json({ balance: pesos, warned: false, reason: "already warned today" });
  }

  const { data: settings } = await supabase.from("settings").select("support_numbers").single();
  const numbers: string[] = settings?.support_numbers ?? [];

  const message =
    `Kentjems: SMS credit is down to PHP ${pesos}. ` +
    `When it runs out nobody can sign in or book. Top up at philsms.com.`;

  let sent = 0;
  for (const number of numbers) {
    const result = await sendSms(number, message, "low-balance");
    if (result.ok) sent += 1;
  }

  return NextResponse.json({ balance: pesos, warned: sent > 0, sentTo: sent });
}
