"use server";

import { revalidatePath } from "next/cache";
import { sendSms, smsCopy } from "@/lib/sms";
import { createReadClient, createSupabaseServer } from "@/lib/supabase/server";
import { formatPeso, formatTime } from "@/lib/time";

export interface ProofState {
  error?: string;
}

/**
 * Records a payment proof and tells the operator there is something to check.
 *
 * The screenshot itself is uploaded straight from the browser to Storage —
 * phone photos are large and mobile data here is not free — but the rest goes
 * through the server so the operator notification can be sent, which the
 * browser cannot do without exposing the SMS token.
 *
 * The alert matters because the slot is HELD from this moment. Without it, a
 * proof sits unreviewed until the operator happens to open the app, and a
 * court sits unsellable in the meantime.
 */
export async function submitProof(_prev: ProofState, form: FormData): Promise<ProofState> {
  const bookingId = String(form.get("bookingId") ?? "");
  const reference = String(form.get("reference") ?? "").trim();
  const amount = Number(form.get("amount") ?? 0);
  const sender = String(form.get("sender") ?? "").trim();
  const proofPath = String(form.get("proofPath") ?? "") || null;

  const supabase = await createSupabaseServer();

  const { error } = await supabase.rpc("submit_payment_proof", {
    p_booking_id: bookingId,
    p_reference: reference,
    p_amount: amount,
    p_sender_name: sender,
    p_proof_path: proofPath,
  });

  if (error) return { error: error.message };

  await alertOperator(bookingId, reference);

  revalidatePath("/my");
  revalidatePath("/admin/payments");
  return {};
}

async function alertOperator(bookingId: string, reference: string) {
  try {
    const session = await createSupabaseServer();

    // The operator numbers come from settings, which is world-readable —
    // a customer cannot read operator profiles, and should not be able to.
    const [{ data: settings }, { data: row }] = await Promise.all([
      createReadClient().from("settings").select("support_numbers").single(),
      session
        .from("bookings")
        .select("starts_at, ends_at, price_centavos, spaces(name)")
        .eq("id", bookingId)
        .single(),
    ]);

    if (!row) return;

    const spaceName = Array.isArray(row.spaces)
      ? row.spaces[0]?.name
      : (row.spaces as { name: string } | null)?.name;

    const day = new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila",
      day: "numeric",
      month: "short",
    }).format(new Date(row.starts_at));

    const when = `${day} ${formatTime(row.starts_at)}-${formatTime(row.ends_at)}`;
    const message = smsCopy.proofToReview(
      spaceName ?? "Court",
      when,
      formatPeso(row.price_centavos),
      reference,
    );

    // Every operator number, because whoever is at the counter should hear it
    // rather than only whoever is listed first.
    for (const number of settings?.support_numbers ?? []) {
      const sent = await sendSms(number, message, "operator-review");
      if (!sent.ok) console.error("Operator alert failed:", number, sent.error);
    }
  } catch (caught) {
    // The payment is already recorded. A failed alert must not undo that or
    // make the customer think their submission did not go through.
    console.error("Could not alert the operator:", caught);
  }
}
