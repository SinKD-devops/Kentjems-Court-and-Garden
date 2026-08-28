"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

/**
 * Re-renders the page whenever anything changes.
 *
 * Subscribes to `availability_pulse` rather than to `bookings` or `payments`.
 * RLS hides other people's rows from a customer, so a direct subscription
 * would deliver nothing; relaxing that policy would leak names and phone
 * numbers, because RLS filters rows and not columns. The pulse carries only a
 * revision counter, and the refresh refetches through views each viewer is
 * allowed to read.
 *
 * `spaceId` narrows it for the customer grid, which only cares about the space
 * being looked at. The counter console omits it and watches everything, since
 * a payment arriving for either space is news.
 *
 * router.refresh() re-runs the server render and reconciles — it does not
 * reload the page, so scroll position and any slot selection survive.
 */
export function LiveAvailability({ spaceId }: { spaceId?: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createSupabaseBrowser();

    const channel = supabase
      .channel(spaceId ? `pulse:${spaceId}` : "pulse:all")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "availability_pulse",
          ...(spaceId ? { filter: `space_id=eq.${spaceId}` } : {}),
        },
        () => router.refresh(),
      )
      .subscribe();

    // A phone that slept through a change reconnects showing stale content,
    // and the socket may have dropped while it was away.
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
