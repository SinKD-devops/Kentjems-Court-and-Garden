"use server";

import { revalidatePath } from "next/cache";
import { sendSms, smsCopy } from "@/lib/sms";
import { createSupabaseServer } from "@/lib/supabase/server";
import { formatPeso, formatTime } from "@/lib/time";

/**
 * Approving, rejecting, and confirming cash at the counter.
 *
 * The SMS is sent after the database call succeeds, never before. Telling
 * someone their booking is confirmed and then failing to confirm it is far
 * worse than confirming without a text — they can still see it in the app.
 *
 * A failed SMS is logged rather than surfaced: the decision has already been
 * made and must not appear to have failed.
 */

interface SupersededRow {
  id: string;
  phone: string | null;
  starts_at: string;
  ends_at: string;
}

interface ConfirmResult {
  space: string;
  superseded: SupersededRow[];
}

function describe(startsAt: string, endsAt: string) {
  const day = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    day: "numeric",
    month: "short",
  }).format(new Date(startsAt));
  return `${day}, ${formatTime(startsAt)}-${formatTime(endsAt)}`;
}

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

  return {
    phone: data.contact_phone,
    space: spaceName ?? "Court",
    when: describe(data.starts_at, data.ends_at),
    price: formatPeso(data.price_centavos),
  };
}

/**
 * Everyone still chasing this slot has just lost it. Their request cost them
 * nothing, so without this message their only feedback is walking to the
 * store to pay for a court that is already gone.
 */
async function notifySuperseded(result: ConfirmResult) {
  await Promise.all(
    result.superseded
      .filter((row) => row.phone)
      .map(async (row) => {
        const sent = await sendSms(
          row.phone as string,
          smsCopy.superseded(result.space, describe(row.starts_at, row.ends_at)),
          "superseded",
        );
        if (!sent.ok) console.error("Superseded SMS failed:", row.id, sent.error);
      }),
  );
}

export async function approvePayment(form: FormData) {
  const bookingId = String(form.get("bookingId") ?? "");
  const reference = String(form.get("reference") ?? "");

  const supabase = await createSupabaseServer();
  const summary = await bookingSummary(bookingId);

  const { data, error } = await supabase.rpc("approve_payment", {
    p_booking_id: bookingId,
  });
  if (error) return;

  if (summary?.phone) {
    const sent = await sendSms(
      summary.phone,
      smsCopy.approved(summary.space, summary.when, reference),
      "payment-approved",
    );
    if (!sent.ok) console.error("Approval SMS failed:", sent.error);
  }

  await notifySuperseded(data as ConfirmResult);
  revalidatePath("/admin/payments");
}

export async function confirmCashPayment(form: FormData) {
  const bookingId = String(form.get("bookingId") ?? "");

  const supabase = await createSupabaseServer();
  const summary = await bookingSummary(bookingId);

  const { data, error } = await supabase.rpc("confirm_cash_payment", {
    p_booking_id: bookingId,
  });
  if (error) return;

  if (summary?.phone) {
    const sent = await sendSms(
      summary.phone,
      smsCopy.confirmedAtCounter(summary.space, summary.when),
      "cash-confirmed",
    );
    if (!sent.ok) console.error("Cash confirmation SMS failed:", sent.error);
  }

  await notifySuperseded(data as ConfirmResult);
  revalidatePath("/admin/payments");
  revalidatePath("/admin");
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
    const sent = await sendSms(summary.phone, smsCopy.rejected(reason, support), "payment-rejected");
    if (!sent.ok) console.error("Rejection SMS failed:", sent.error);
  }

  revalidatePath("/admin/payments");
}
