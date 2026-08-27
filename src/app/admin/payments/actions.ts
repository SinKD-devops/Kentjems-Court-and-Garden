"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";
import { formatPeso, formatTime } from "@/lib/time";
import { sendSms, smsCopy } from "@/lib/sms";

/**
 * Approving or rejecting a payment.
 *
 * The SMS is sent after the database call succeeds, never before. Telling
 * someone their booking is confirmed and then failing to confirm it is far
 * worse than a booking that is confirmed without a text — they can still see
 * it in the app.
 *
 * A failed SMS is logged rather than surfaced: the decision has already been
 * made and must not appear to have failed. Delivery problems are visible in
 * the sms_deliveries view.
 */

async function bookingSummary(bookingId: string) {
  const supabase = await createSupabaseServer();
  const { data } = await supabase
    .from("bookings")
    .select("starts_at, ends_at, contact_phone, price_centavos, spaces(name)")
    .eq("id", bookingId)
    .single();

  if (!data) return null;
  const spaceName = Array.isArray(data.spaces)
    ? data.spaces[0]?.name
    : (data.spaces as { name: string } | null)?.name;

  const day = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    day: "numeric",
    month: "short",
  }).format(new Date(data.starts_at));

  return {
    phone: data.contact_phone,
    space: spaceName ?? "Court",
    when: `${day}, ${formatTime(data.starts_at)}-${formatTime(data.ends_at)}`,
    price: formatPeso(data.price_centavos),
  };
}

export async function approvePayment(form: FormData) {
  const bookingId = String(form.get("bookingId") ?? "");
  const reference = String(form.get("reference") ?? "");

  const supabase = await createSupabaseServer();
  const summary = await bookingSummary(bookingId);

  const { error } = await supabase.rpc("approve_payment", { p_booking_id: bookingId });
  if (error) return;

  if (summary?.phone) {
    const result = await sendSms(
      summary.phone,
      smsCopy.approved(summary.space, summary.when, reference),
    );
    if (!result.ok) console.error("Approval SMS failed:", result.error);
  }

  revalidatePath("/admin/payments");
}

export async function rejectPayment(form: FormData) {
  const bookingId = String(form.get("bookingId") ?? "");
  const reason = String(form.get("reason") ?? "other");

  const supabase = await createSupabaseServer();
  const summary = await bookingSummary(bookingId);

  const { error } = await supabase.rpc("reject_payment", {
    p_booking_id: bookingId,
    p_reason: reason,
  });
  if (error) return;

  const { data: settings } = await supabase.from("settings").select("support_numbers").single();
  const support = (settings?.support_numbers ?? [])[0] ?? "";

  if (summary?.phone) {
    const result = await sendSms(summary.phone, smsCopy.rejected(reason, support));
    if (!result.ok) console.error("Rejection SMS failed:", result.error);
  }

  revalidatePath("/admin/payments");
}
