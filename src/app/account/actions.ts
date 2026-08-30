"use server";

import { redirect } from "next/navigation";
import { checkPassword } from "@/lib/password";
import { createSupabaseServer } from "@/lib/supabase/server";

export interface PasswordState {
  error?: string;
  done?: boolean;
}

/**
 * Sets or replaces the signed-in customer's password.
 *
 * Requires a live session, which is the whole security model here: the only
 * ways to hold one are a code sent to the number, or a password already set on
 * it. There is deliberately no "reset by answering questions" path — the
 * recovery route for a forgotten password is a code, and when SMS itself is
 * down, the operator resets it at the counter. That is a real desk in Butuan
 * rather than an email nobody reads.
 */
export async function setPassword(
  _prev: PasswordState,
  form: FormData,
): Promise<PasswordState> {
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");

  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/sign-in?next=%2Faccount");

  if (password !== confirm) {
    return { error: "The two passwords do not match." };
  }

  const complaint = checkPassword(password, user.phone);
  if (complaint) return { error: complaint };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  // Stamped after the password actually changed, never before. If this write
  // fails the customer simply gets offered the screen again next time, which
  // is the harmless direction to fail in.
  await supabase
    .from("profiles")
    .update({ password_set_at: new Date().toISOString() })
    .eq("id", user.id);

  // Ends every other session on every other device, keeping this one alive.
  //
  // Someone changing a password because they think another person has it
  // gains nothing if that person's session simply carries on. A shared phone
  // in a household is the ordinary case here, not an attack.
  await supabase.auth.signOut({ scope: "others" });

  const next = String(form.get("next") ?? "");
  if (next.startsWith("/")) redirect(next);

  return { done: true };
}
