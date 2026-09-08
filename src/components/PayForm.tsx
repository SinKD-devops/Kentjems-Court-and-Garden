"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { submitProof } from "@/app/pay/[id]/actions";
import { Countdown } from "@/components/Countdown";
import { MAX_UPLOAD_BYTES, compressImage } from "@/lib/image";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { formatPeso } from "@/lib/time";

/**
 * Payment proof submission.
 *
 * The screenshot uploads straight from the browser to Supabase Storage rather
 * than through a server action — phone photos are large, mobile data in the
 * Philippines is not free, and routing several megabytes through the server
 * adds nothing.
 *
 * The reference number is typed rather than read from the image on purpose.
 * It carries a unique index, so one payment can never be claimed against two
 * bookings — which blocks the likeliest abuse, reusing a single screenshot.
 */
export function PayForm({
  bookingId,
  amountCentavos,
  expiresAt,
}: {
  bookingId: string;
  amountCentavos: number;
  expiresAt: string | null;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(form: FormData) {
    setError(null);
    setBusy(true);

    try {
      const supabase = createSupabaseBrowser();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Please sign in again.");

      let proofPath: string | null = null;
      if (file) {
        const { blob } = await compressImage(file);

        // Checked here so an oversized proof fails with something a customer
        // can act on, rather than an opaque storage error after the upload.
        if (blob.size > MAX_UPLOAD_BYTES) {
          throw new Error(
            "That image is too large to send. Please take a screenshot rather than a photo of the screen.",
          );
        }

        // No extension in the path, deliberately. It used to carry the source
        // file's, so a customer who first sent a .heic and then a compressed
        // .jpg wrote to two different objects: the upsert replaced neither and
        // the first was orphaned in the bucket until the 90-day purge. One
        // booking is one object. The operator's view fetches a signed URL and
        // renders from the stored content type, which does not need the suffix.
        proofPath = `${user.id}/${bookingId}`;
        const { error: uploadError } = await supabase.storage
          .from("payment-proofs")
          .upload(proofPath, blob, { upsert: true, contentType: blob.type });
        if (uploadError) throw new Error(`Could not upload the screenshot: ${uploadError.message}`);
      }

      // Recorded through the server rather than by calling the RPC directly,
      // so the operator can be texted — the browser cannot send SMS without
      // exposing the provider token.
      const payload = new FormData();
      payload.set("bookingId", bookingId);
      payload.set("reference", String(form.get("reference") ?? ""));
      payload.set("amount", String(amountCentavos));
      payload.set("sender", String(form.get("sender") ?? ""));
      if (proofPath) payload.set("proofPath", proofPath);

      const result = await submitProof({}, payload);
      if (result.error) throw new Error(result.error);

      router.push("/my");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <form action={submit} className="flex flex-col gap-3">
      {expiresAt && (
        <div className="flex justify-center">
          <Countdown expiresAt={expiresAt} />
        </div>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-faint">
          Reference number
        </span>
        <input
          name="reference"
          inputMode="numeric"
          required
          minLength={6}
          placeholder="From your payment receipt"
          className="rounded-xl border border-line bg-surface px-3.5 py-3 text-[16px] font-semibold tabular-nums outline-none focus:border-green focus:ring-3 focus:ring-green/15"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-faint">
          Name on your account
        </span>
        <input
          name="sender"
          autoComplete="name"
          placeholder="Who sent the payment"
          className="rounded-xl border border-line bg-surface px-3.5 py-3 text-[16px] font-semibold outline-none focus:border-green focus:ring-3 focus:ring-green/15"
        />
      </label>

      <label className="flex cursor-pointer flex-col gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-faint">
          Screenshot of your receipt
        </span>
        <div className="rounded-xl border-[1.5px] border-dashed border-[#C2D3C8] bg-surface px-4 py-4 text-center text-[12.5px] font-semibold text-soft">
          {file ? file.name : "Tap to attach"}
        </div>
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>

      {error && (
        <p
          role="alert"
          className="rounded-xl bg-[var(--red-bg)] px-3.5 py-2.5 text-[13px] font-semibold text-red"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="rounded-full bg-green py-3.5 text-[14.5px] font-bold text-white shadow-[0_4px_12px_rgba(18,114,77,0.3)] disabled:opacity-60"
      >
        {busy ? "Sending…" : `I've sent ${formatPeso(amountCentavos)}`}
      </button>

      <p className="px-1 text-center text-[11.5px] leading-relaxed text-soft">
        Your slot is held while the operator checks the payment. Usually approved within
        the hour.
      </p>
    </form>
  );
}
