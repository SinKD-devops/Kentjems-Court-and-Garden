"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * Closes a space for the remainder of today.
 *
 * The court is uncovered and the refund policy is built around rain. When it
 * actually starts raining, filling in a date range in Settings is the wrong
 * amount of work — this is one button.
 *
 * It closes from NOW, not from the start of the day, so hours already played
 * are still billable and still appear in takings.
 *
 * Existing bookings are deliberately left alone. Cancelling them automatically
 * would decide a refund on the operator's behalf, and the policy is that they
 * approve each one — the notice says so.
 */
export async function closeRestOfToday(form: FormData) {
  const spaceId = String(form.get("spaceId") ?? "");
  const reason = String(form.get("reason") ?? "").trim() || "Closed early";

  const supabase = await createSupabaseServer();

  const now = new Date();
  const manilaDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  // Up to the end of the Manila day, which is the following midnight.
  const until = new Date(`${manilaDate}T00:00:00+08:00`);
  until.setTime(until.getTime() + 86_400_000);

  const { error } = await supabase.from("closures").insert({
    space_id: spaceId,
    during: `[${now.toISOString()},${until.toISOString()})`,
    reason,
  });

  if (error) console.error("Could not close the space:", error.message);

  revalidatePath("/admin");
  revalidatePath("/admin/settings");
  revalidatePath("/");
}
