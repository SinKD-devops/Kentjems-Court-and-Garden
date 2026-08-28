import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline · Kentjems" };

/**
 * Shown when a page is requested with no connection.
 *
 * It deliberately shows no availability at all. Slots cached from an earlier
 * visit would look current and send someone to the store for an hour that has
 * already sold — the one failure this app must never produce.
 */
export default function OfflinePage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-faint">
        Kentjems Court and Garden
      </p>
      <h1 className="text-[20px] font-bold tracking-tight">You&rsquo;re offline</h1>
      <p className="max-w-xs text-[13.5px] leading-relaxed text-soft">
        Available hours change by the minute, so we don&rsquo;t show them without a
        connection — an old list would send you to the store for a slot that has
        already gone.
      </p>
      <p className="text-[13px] text-soft">
        Reconnect and try again, or call{" "}
        <a href="tel:+639502361590" className="font-semibold text-green">
          0950 236 1590
        </a>
        .
      </p>
    </div>
  );
}
