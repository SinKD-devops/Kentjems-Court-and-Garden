"use server";

import { redirect } from "next/navigation";
import { checkPassword } from "@/lib/password";
import { createSupabaseServer } from "@/lib/supabase/server";

export interface PasswordState {
  error?: string;
  done?: boolean;
}

/**
 * Was this session opened with a password, or with a texted code?
 *
 * It decides whether the current password has to be given before setting a new
 * one. Asking is right for a password session — otherwise an unlocked phone
 * left on a counter is enough to take the account, and since a password now
 * gates booking, taking it locks the real owner out.
 *
 * Asking is wrong for a code session. That is the recovery path: someone who
 * has forgotten their password signs in with a code, and demanding the
 * forgotten password at that point would make recovery impossible. The code
 * already proved they hold the number, which is the same thing the password
 * would have proved.
 *
 * `getClaims()` verifies the JWT rather than decoding it, so a tampered cookie
 * claiming `otp` does not get a free pass.
 */
async function signedInWithPassword(
  supabase: Awaited<ReturnType<typeof createSupabaseServer>>,
): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getClaims();
    const amr = (data?.claims as { amr?: { method?: string }[] } | undefined)?.amr;
    if (!Array.isArray(amr) || amr.length === 0) return true;
    return amr.some((entry) => entry?.method === "password");
  } catch {
    // Unreadable claims fall back to asking. The safe direction is the one
    // that demands more proof, not less.
    return true;
  }
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

  // Someone who already has a password must prove they know it. A live session
  // is otherwise enough to change it, so an unlocked phone left on a counter
  // is enough to take the account — and now that a password gates booking,
  // taking it locks the real owner out rather than merely inconveniencing them.
  //
  // Only asked of people who have one. The first-run screen would otherwise
  // demand a password nobody has yet.
  const { data: profile } = await supabase
    .from("profiles")
    .select("password_set_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.password_set_at && (await signedInWithPassword(supabase))) {
    const current = String(form.get("current") ?? "");
    if (!current) return { error: "Please enter your current password." };

    // Verified on a throwaway client. Signing in on the request's own client
    // would rewrite the session cookie as a side effect of a check.
    const { createClient } = await import("@supabase/supabase-js");
    const probe = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { error: wrong } = await probe.auth.signInWithPassword({
      phone: `+${user.phone}`,
      password: current,
    });
    if (wrong) return { error: "That is not your current password." };
  }

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
