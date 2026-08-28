import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * Deletes payment screenshots once the booking is long finished.
 *
 * They carry financial details and there is no reason to keep them for ever.
 * The payment row and its reference number stay, so the records and the
 * duplicate-reference protection survive — only the image goes.
 *
 * Runs from Postgres via pg_cron, but the deletion has to happen here: the
 * Storage API is what actually removes the file, and deleting the row in
 * storage.objects would only drop the metadata.
 */

export const dynamic = "force-dynamic";

const RETENTION_DAYS = 90;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set." }, { status: 500 });
  }

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

  const { data, error } = await supabase.rpc("proofs_to_purge", { p_days: RETENTION_DAYS });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as { payment_id: string; proof_path: string }[];
  if (rows.length === 0) return NextResponse.json({ purged: 0 });

  const { error: removeError } = await supabase.storage
    .from("payment-proofs")
    .remove(rows.map((r) => r.proof_path));

  // If the files could not be removed, leave proof_path alone so the next run
  // tries again. Clearing it would orphan the images with nothing pointing at
  // them, which is worse than keeping them another day.
  if (removeError) {
    return NextResponse.json({ error: removeError.message }, { status: 500 });
  }

  await supabase.rpc("mark_proofs_purged", {
    p_payment_ids: rows.map((r) => r.payment_id),
  });

  return NextResponse.json({ purged: rows.length, retentionDays: RETENTION_DAYS });
}
