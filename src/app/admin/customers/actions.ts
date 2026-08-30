"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * Clears a customer's password from the counter.
 *
 * For the person standing at the counter saying they cannot get in. Afterwards
 * they sign in with a code and are required to choose a new password, which is
 * the same path a brand new customer takes.
 *
 * It does NOT help during an SMS outage — the code will not arrive either. That
 * is deliberate and it is not the hole it looks like: during an outage the
 * customer is standing in front of an operator who can simply take the booking
 * as a walk-in. This restores app access; the counter handles the court.
 */
export async function clearCustomerPassword(form: FormData) {
  const profileId = String(form.get("profileId") ?? "");
  const query = String(form.get("q") ?? "");

  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  // Re-checked here with the caller's own session. The page also checks, but a
  // server action is an endpoint anyone can post to — a guard that lives only
  // in the page it is rendered on guards nothing.
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (me?.role !== "operator") return;

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Supabase has no "remove password". `updateUserById({ password: null })` is
  // ACCEPTED AND DOES NOTHING — verified 30 August 2026: the old password kept
  // working afterwards. So the password is overwritten with a value nobody has
  // ever seen and nobody records, which is the same thing from the customer's
  // side. Do not replace this with the null form because it reads better.
  const unusable = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const { error } = await admin.auth.admin.updateUserById(profileId, {
    password: unusable,
  });
  if (error) return;

  // Sends them back through the required-password screen after their next code
  // sign-in, so they leave with a password rather than without one.
  await admin.from("profiles").update({ password_set_at: null }).eq("id", profileId);

  // Any session they still hold elsewhere is ended, or clearing the password
  // would leave whoever is using that device signed in regardless.
  await admin.auth.admin.signOut(profileId, "global").catch(() => {});

  revalidatePath(`/admin/customers?q=${encodeURIComponent(query)}`);
}
