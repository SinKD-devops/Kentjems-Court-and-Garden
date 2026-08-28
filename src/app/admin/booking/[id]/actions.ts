"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sendSms, smsCopy } from "@/lib/sms";
import { createSupabaseServer } from "@/lib/supabase/server";
import { formatPeso, formatTime } from "@/lib/time";

export interface BookingActionState {
  error?: string;
}

function describe(startsAt: string, endsAt: string) {
  const day = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    day: "numeric",
    month: "short",
  }).format(new Date(startsAt));
  return `${day}, ${formatTime(startsAt)}-${formatTime(endsAt)}`;
}

export async function moveBooking(
  _prev: BookingActionState,
  form: FormData,
): Promise<BookingActionState> {
  const id = String(form.get("id") ?? "");
  const startsAt = String(form.get("startsAt") ?? "");
  const hours = Math.min(12, Math.max(1, Number(form.get("hours") ?? 1) || 1));
  const reason = String(form.get("reason") ?? "");

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc("move_booking", {
    p_booking_id: id,
    p_starts_at: startsAt,
    p_hours: hours,
    p_reason: reason,
  });

  if (error) return { error: error.message };

  const result = data as {
    space: string;
    phone: string | null;
    from_starts_at: string;
    from_ends_at: string;
    to_starts_at: string;
    to_ends_at: string;
  };

  // Someone who is not told will turn up at the old time.
  if (result.phone) {
    const sent = await sendSms(
      result.phone,
      smsCopy.moved(
        result.space,
        describe(result.from_starts_at, result.from_ends_at),
        describe(result.to_starts_at, result.to_ends_at),
      ),
    );
    if (!sent.ok) console.error("Move SMS failed:", sent.error);
  }

  revalidatePath("/admin");
  redirect("/admin");
}

export async function refundBooking(
  _prev: BookingActionState,
  form: FormData,
): Promise<BookingActionState> {
  const id = String(form.get("id") ?? "");
  const reason = String(form.get("reason") ?? "rain");

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc("approve_refund", {
    p_booking_id: id,
    p_reason: reason,
  });

  if (error) return { error: error.message };

  const result = data as {
    space: string;
    phone: string | null;
    amount_centavos: number;
    starts_at: string;
    ends_at: string;
  };

  const { data: settings } = await supabase.from("settings").select("support_numbers").single();
  const support = (settings?.support_numbers ?? [])[0] ?? "";

  if (result.phone) {
    const sent = await sendSms(
      result.phone,
      `Kentjems: your ${result.space} booking on ${describe(result.starts_at, result.ends_at)} is cancelled (${reason}). ` +
        `Collect your ${formatPeso(result.amount_centavos)} refund at Kentjems Store. Call ${support}.`,
    );
    if (!sent.ok) console.error("Refund SMS failed:", sent.error);
  }

  revalidatePath("/admin");
  revalidatePath("/admin/refunds");
  redirect("/admin/refunds");
}

export async function settleRefund(form: FormData) {
  const id = String(form.get("refundId") ?? "");
  const supabase = await createSupabaseServer();
  await supabase.rpc("settle_refund", { p_refund_id: id });
  revalidatePath("/admin/refunds");
}
