"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sendSms, smsCopy } from "@/lib/sms";
import { createSupabaseServer } from "@/lib/supabase/server";
import { formatTime } from "@/lib/time";

export interface WalkInState {
  error?: string;
}

interface SupersededRow {
  id: string;
  phone: string | null;
  starts_at: string;
  ends_at: string;
}

function describe(startsAt: string, endsAt: string) {
  const day = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    day: "numeric",
    month: "short",
  }).format(new Date(startsAt));
  return `${day}, ${formatTime(startsAt)}-${formatTime(endsAt)}`;
}

export async function createWalkIn(
  _prev: WalkInState,
  form: FormData,
): Promise<WalkInState> {
  const space = String(form.get("space") ?? "court");
  const startsAt = String(form.get("startsAt") ?? "");
  const hours = Math.min(12, Math.max(1, Number(form.get("hours") ?? 1) || 1));
  const name = String(form.get("name") ?? "");
  const phone = String(form.get("phone") ?? "");

  if (!startsAt) return { error: "Choose a start time." };

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc("create_walk_in", {
    p_space_slug: space,
    p_starts_at: startsAt,
    p_hours: hours,
    p_name: name,
    p_phone: phone,
  });

  if (error) return { error: error.message };

  const result = data as { space: string; superseded: SupersededRow[] };

  // Confirm to the customer even though they are standing right here: the text
  // is their record of the booking, and the only thing they can show up with
  // if there is ever a disagreement about the time.
  const endsAt = new Date(new Date(startsAt).getTime() + hours * 3_600_000).toISOString();
  const sent = await sendSms(
    phone,
    smsCopy.confirmedAtCounter(result.space, describe(startsAt, endsAt)),
    "walk-in",
  );
  if (!sent.ok) console.error("Walk-in confirmation SMS failed:", sent.error);

  // Anyone who was still hoping to pay for this time has just lost it.
  await Promise.all(
    (result.superseded ?? [])
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

  revalidatePath("/admin");
  redirect("/admin");
}
