"use server";

import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";

export interface RequestState {
  error?: string;
}

/**
 * Creates a booking request.
 *
 * Every rule lives in the `request_booking` Postgres function — opening
 * hours, the advance window, the open-request limit, pricing, and expiry are
 * all evaluated in the same transaction as the insert. Re-checking any of it
 * here would only add a window for a concurrent request to slip through.
 */
export async function createRequest(
  _prev: RequestState,
  form: FormData,
): Promise<RequestState> {
  const space = String(form.get("space") ?? "");
  const startsAt = String(form.get("startsAt") ?? "");
  const acceptTerms = form.get("terms") === "on";
  const hours = Math.min(12, Math.max(1, Number(form.get("hours") ?? 1) || 1));

  const name = String(form.get("name") ?? "").trim();

  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      `/sign-in?next=${encodeURIComponent(`/book?space=${space}&start=${startsAt}&hours=${hours}`)}`,
    );
  }

  // Saved on the profile, not just the booking, so it is asked for once and
  // then remembered. request_booking copies it onto the booking, which is what
  // the operator sees at the counter — a phone number alone is no use when
  // somebody walks up and says they have a court at seven.
  if (name) {
    const { error: nameError } = await supabase
      .from("profiles")
      .update({ full_name: name })
      .eq("id", user.id);
    if (nameError) return { error: nameError.message };
  }

  const { error } = await supabase.rpc("request_booking", {
    p_space_slug: space,
    p_starts_at: startsAt,
    p_accept_terms: acceptTerms,
    p_hours: hours,
  });

  if (error) {
    // 23P01 is the exclusion constraint: somebody paid for this slot between
    // the grid rendering and this click.
    if (error.code === "23P01") {
      return { error: "Someone just paid for that slot. Please pick another time." };
    }
    if (error.code === "23505") {
      return { error: "You already have an open request for this space." };
    }
    return { error: error.message };
  }

  redirect("/my");
}

export async function withdrawRequest(form: FormData) {
  const id = String(form.get("id") ?? "");
  const supabase = await createSupabaseServer();
  await supabase.rpc("withdraw_booking", { p_booking_id: id });
  redirect("/my");
}
