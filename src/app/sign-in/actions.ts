"use server";

import { redirect } from "next/navigation";
import { normalizePhPhone } from "@/lib/phone";
import { createSupabaseServer } from "@/lib/supabase/server";

export interface AuthState {
  error?: string;
}

export async function sendCode(_prev: AuthState, form: FormData): Promise<AuthState> {
  const phone = normalizePhPhone(String(form.get("phone") ?? ""));
  const next = String(form.get("next") ?? "/");

  if (!phone) {
    return { error: "That does not look like a Philippine mobile number." };
  }

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signInWithOtp({ phone });

  if (error) return { error: error.message };

  redirect(`/sign-in?phone=${encodeURIComponent(phone)}&next=${encodeURIComponent(next)}`);
}

export async function verifyCode(_prev: AuthState, form: FormData): Promise<AuthState> {
  const phone = String(form.get("phone") ?? "");
  const token = String(form.get("code") ?? "").trim();
  const next = String(form.get("next") ?? "/");

  if (!/^\d{4,8}$/.test(token)) {
    return { error: "Enter the code from your text message." };
  }

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.verifyOtp({ phone, token, type: "sms" });

  if (error) {
    return {
      error:
        error.message.toLowerCase().includes("expired") ||
        error.message.toLowerCase().includes("invalid")
          ? "That code is wrong or has expired. Ask for a new one."
          : error.message,
    };
  }

  // Offer a password at the moment the account comes into existence, rather
  // than leaving it on a screen nobody visits. A fallback set after the first
  // outage is a fallback that was missing when it mattered.
  //
  // Read with the caller's own session: RLS limits profiles to their owner, so
  // the anonymous client would return nothing here and everyone would be
  // offered the screen forever (§4).
  if (data.user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("password_set_at")
      .eq("id", data.user.id)
      .maybeSingle();

    if (!profile?.password_set_at) {
      redirect(`/account?first=1&next=${encodeURIComponent(next)}`);
    }
  }

  redirect(next);
}

/**
 * The fallback sign-in path.
 *
 * It exists because SMS is a third party that has already failed this project
 * once: PhilSMS reported every message delivered while silently sending none
 * to Smart and TNT. A password means an existing customer can still get in
 * when the provider is down, the balance has run out, or a carrier is
 * filtering.
 *
 * It is a fallback for people who already have an account. Registering still
 * needs one code, because a phone number nobody has verified is a phone number
 * anybody could claim.
 */
export async function signInWithPassword(
  _prev: AuthState,
  form: FormData,
): Promise<AuthState> {
  const phone = normalizePhPhone(String(form.get("phone") ?? ""));
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/");

  if (!phone) {
    return { error: "That does not look like a Philippine mobile number." };
  }
  if (!password) {
    return { error: "Please enter your password." };
  }

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ phone, password });

  if (error) {
    // Deliberately does not distinguish "no such number" from "wrong
    // password". Saying which one is wrong tells anyone who asks whether a
    // given number has an account here, and the numbers are guessable.
    return {
      error: "That number and password do not match. Try a code instead, or ask at the store.",
    };
  }

  redirect(next);
}

export async function signOut() {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  redirect("/");
}
