import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { type PushTarget, sendPush } from "@/lib/push";
import { formatTime } from "@/lib/time";

/**
 * Warns customers ten minutes before their request expires.
 *
 * Runs every minute, triggered from Postgres by pg_cron. A request costs
 * nothing to make, so without this the only feedback on losing one is finding
 * out at the counter — and the thirty-minute window is short enough that
 * people genuinely forget.
 *
 * Push rather than SMS on purpose: nobody has paid at this point, and a peso
 * per unpaid request adds up. Everything after money moves still goes by text.
 *
 * Uses the secret key because it acts on behalf of every customer at once,
 * which no customer session could or should be able to do.
 */

export const dynamic = "force-dynamic";

interface DueRow {
  booking_id: string;
  user_id: string;
  space_name: string;
  starts_at: string;
  ends_at: string;
  expires_at: string;
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set." }, { status: 500 });
  }

  // Constant-time-ish check on a shared secret. This endpoint can send a
  // notification to every customer, so it is not left open.
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 500 });
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: due, error } = await supabase.rpc("requests_needing_reminder", {
    p_minutes: 10,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (due ?? []) as DueRow[];
  if (rows.length === 0) return NextResponse.json({ reminded: 0 });

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", userIds);

  const byUser = new Map<string, (PushTarget & { id: string })[]>();
  for (const sub of subs ?? []) {
    byUser.set(sub.user_id, [...(byUser.get(sub.user_id) ?? []), sub]);
  }

  const expired: string[] = [];

  await Promise.all(
    rows.flatMap((row) => {
      const minutes = Math.max(
        1,
        Math.round((new Date(row.expires_at).getTime() - Date.now()) / 60_000),
      );

      return (byUser.get(row.user_id) ?? []).map(async (target) => {
        const result = await sendPush(target, {
          title: `${minutes} minutes left to pay`,
          body:
            `${row.space_name}, ${formatTime(row.starts_at)}–${formatTime(row.ends_at)}. ` +
            `Pay at Kentjems Store or online, or the slot goes back on sale.`,
          url: "/my",
          tag: `expiry-${row.booking_id}`,
        });
        if (result === "expired") expired.push(target.id);
      });
    }),
  );

  // A subscription the browser has discarded is dead forever; keeping it means
  // failing on it every minute.
  if (expired.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", expired);
  }

  // Marked whether or not a push landed. Someone with no subscription cannot
  // be reminded, and retrying every minute for the rest of their window would
  // achieve nothing.
  await supabase.rpc("mark_expiry_reminded", {
    p_booking_ids: rows.map((r) => r.booking_id),
  });

  return NextResponse.json({ reminded: rows.length, prunedSubscriptions: expired.length });
}
