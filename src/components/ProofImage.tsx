"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

/**
 * Payment screenshot from the private bucket.
 *
 * The bucket is not public, so the image needs a signed URL. Those are minted
 * in the browser rather than rendered into the page, so a short-lived link to
 * someone's financial screenshot never sits in server-rendered HTML that
 * might be cached or logged.
 */
export function ProofImage({ path }: { path: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!path) return;
    let live = true;

    createSupabaseBrowser()
      .storage.from("payment-proofs")
      .createSignedUrl(path, 300)
      .then(({ data, error }) => {
        if (!live) return;
        if (error || !data) setFailed(true);
        else setUrl(data.signedUrl);
      });

    return () => {
      live = false;
    };
  }, [path]);

  if (!path) {
    return (
      <p className="rounded-lg bg-sunken px-3 py-2 text-[11.5px] font-semibold text-soft">
        No screenshot attached — verify from the reference number alone.
      </p>
    );
  }

  if (failed) {
    return (
      <p className="rounded-lg bg-sunken px-3 py-2 text-[11.5px] font-semibold text-soft">
        Screenshot could not be loaded.
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="overflow-hidden rounded-lg border border-line bg-sunken"
        aria-label="Enlarge payment screenshot"
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="Payment screenshot" className="h-24 w-full object-cover" />
        ) : (
          <span className="flex h-24 items-center justify-center text-[11.5px] font-semibold text-soft">
            Loading…
          </span>
        )}
      </button>

      {open && url && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="Payment screenshot, enlarged"
            className="max-h-full max-w-full rounded-xl"
          />
        </div>
      )}
    </>
  );
}
