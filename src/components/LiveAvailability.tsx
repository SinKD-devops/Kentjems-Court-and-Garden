"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

/**
 * Refreshes the slot grid when anything changes in this space.
 *
 * Subscribes to `availability_pulse` rather than to `bookings`. RLS hides
 * other people's bookings from a customer, so a direct subscription would
 * deliver nothing; relaxing that policy would leak names and phone numbers,
 * since RLS filters rows and not columns. The pulse carries only a revision
 * counter, and the refresh refetches availability through the public views.
 *
 * The result is that confirming a payment at the counter darkens the slot on
 * every open phone within about a second.
 */
export function LiveAvailability({ spaceId }: { spaceId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createSupabaseBrowser();

    const channel = supabase
      .channel(`availability:${spaceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "availability_pulse",
          filter: `space_id=eq.${spaceId}`,
        },
        () => router.refresh(),
      )
      .subscribe();

    // A phone that slept through a change reconnects with stale content, so
    // refetch whenever the tab comes back to the foreground.
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [spaceId, router]);

  return null;
}
