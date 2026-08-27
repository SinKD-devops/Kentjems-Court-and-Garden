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
  const { error } = await supabase.auth.verifyOtp({ phone, token, type: "sms" });

  if (error) {
    return {
      error:
        error.message.toLowerCase().includes("expired") ||
        error.message.toLowerCase().includes("invalid")
          ? "That code is wrong or has expired. Ask for a new one."
          : error.message,
    };
  }

  redirect(next);
}

export async function signOut() {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  redirect("/");
}
