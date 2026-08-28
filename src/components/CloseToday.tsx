"use client";

import { useState } from "react";
import { closeRestOfToday } from "@/app/admin/close/actions";

/**
 * One-tap closure for weather.
 *
 * Behind a confirm step because it takes hours off sale immediately and there
 * is no undo on this screen — removing it again means going to Settings.
 */
export function CloseToday({ spaces }: { spaces: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-xl border border-[#F0DDBC] bg-[var(--amber-bg)] px-3.5 py-2.5 text-[13px] font-bold text-amber"
      >
        Close for the rest of today
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-[#F0DDBC] bg-[var(--amber-bg)] px-4 py-3.5">
      <p className="text-[13px] font-bold text-amber">Stop selling hours from now</p>
      <p className="text-[12px] leading-relaxed text-[#7A5410]">
        Hours already played still count. Bookings later today are{" "}
        <b>not cancelled</b> — refund or move those yourself.
      </p>

      <div className="flex flex-col gap-1.5 pt-0.5">
        {spaces.map((space) => (
          <form key={space.id} action={closeRestOfToday}>
            <input type="hidden" name="spaceId" value={space.id} />
            <input type="hidden" name="reason" value="Closed early — weather" />
            <button
              type="submit"
              className="w-full rounded-xl bg-amber py-2.5 text-[13px] font-bold text-white"
            >
              Close the {space.name.toLowerCase()}
            </button>
          </form>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="py-1 text-[12.5px] font-semibold text-[#7A5410]"
      >
        Never mind
      </button>
    </div>
  );
}
