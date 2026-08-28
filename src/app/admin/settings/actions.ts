"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";

export interface SettingsState {
  error?: string;
  saved?: string;
}

/** Pesos typed by a person → integer centavos. Never floats. */
function toCentavos(value: FormDataEntryValue | null): number | null {
  const pesos = Number(String(value ?? "").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(pesos) || pesos < 0) return null;
  return Math.round(pesos * 100);
}

export async function saveRates(
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const supabase = await createSupabaseServer();
  const updates: { id: string; price_centavos: number }[] = [];

  for (const [key, value] of form.entries()) {
    if (!key.startsWith("rate:")) continue;
    const centavos = toCentavos(value);
    if (centavos === null) return { error: "Rates must be a number, like 60 or 250." };
    updates.push({ id: key.slice(5), price_centavos: centavos });
  }

  for (const row of updates) {
    const { error } = await supabase
      .from("pricing_rules")
      .update({ price_centavos: row.price_centavos })
      .eq("id", row.id);
    if (error) return { error: error.message };
  }

  revalidatePath("/admin/settings");
  revalidatePath("/");
  return { saved: "Rates updated. New bookings use them immediately." };
}

export async function saveHours(
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const supabase = await createSupabaseServer();

  for (const [key, value] of form.entries()) {
    if (!key.startsWith("opens:") && !key.startsWith("closes:")) continue;
    const [field, id] = key.split(":");
    const column = field === "opens" ? "opens_at" : "closes_at";
    const { error } = await supabase
      .from("opening_hours")
      .update({ [column]: String(value) })
      .eq("id", id);
    if (error) return { error: error.message };
  }

  revalidatePath("/admin/settings");
  revalidatePath("/");
  return { saved: "Opening hours updated." };
}

export async function saveRules(
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const supabase = await createSupabaseServer();

  const expiry = Number(form.get("expiry") ?? 30);
  if (!Number.isFinite(expiry) || expiry < 5 || expiry > 240) {
    return { error: "The payment window must be between 5 and 240 minutes." };
  }

  const { error } = await supabase
    .from("settings")
    .update({
      request_expiry_minutes: Math.round(expiry),
      gcash_window_opens_at: String(form.get("windowOpens") ?? "06:00"),
      gcash_window_closes_at: String(form.get("windowCloses") ?? "23:00"),
      last_submission_time: String(form.get("lastSubmission") ?? "22:30"),
      payee_name: String(form.get("payeeName") ?? ""),
      payee_number: String(form.get("payeeNumber") ?? ""),
    })
    .eq("id", true);

  if (error) return { error: error.message };

  revalidatePath("/admin/settings");
  return { saved: "Rules updated." };
}

export async function addClosure(
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const supabase = await createSupabaseServer();

  const spaceId = String(form.get("spaceId") ?? "");
  const from = String(form.get("from") ?? "");
  const to = String(form.get("to") ?? "");
  const reason = String(form.get("reason") ?? "").trim();

  if (!from || !to) return { error: "Choose both a start and an end date." };
  if (!reason) return { error: "Give a reason — customers see it on the closed day." };

  // Inclusive of the end date: closing "the 5th to the 7th" must include the 7th.
  const during = `[${from}T00:00:00+08:00,${to}T24:00:00+08:00)`;

  const { error } = await supabase.from("closures").insert({
    space_id: spaceId,
    during,
    reason,
  });

  if (error) return { error: error.message };

  revalidatePath("/admin/settings");
  revalidatePath("/");
  return { saved: "Closure added." };
}

export async function removeClosure(form: FormData) {
  const supabase = await createSupabaseServer();
  await supabase.from("closures").delete().eq("id", String(form.get("id") ?? ""));
  revalidatePath("/admin/settings");
  revalidatePath("/");
}
