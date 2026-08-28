/**
 * Client-side screenshot compression, run before a payment proof is uploaded.
 *
 * Phone screenshots arrive at 3–8 MB and carry no detail the operator needs:
 * they are read once, against the real GCash history, to check a reference
 * number and an amount. Re-encoding to a 1600px JPEG lands them under half a
 * megabyte, which keeps a customer on mobile data from paying to send pixels —
 * the reason the spec asked for this — and keeps them clear of the bucket cap.
 *
 * Every failure path returns the original file rather than throwing. A proof
 * that uploads large is a slow upload; a proof that does not upload at all is
 * a customer who has already sent money and cannot prove it. HEIC is the real
 * case here: Safari decodes it, most Android browsers do not, so those uploads
 * fall through uncompressed and rely on the bucket's headroom instead.
 */

const MAX_EDGE = 1600;
const QUALITY = 0.82;

/** Matches the `payment-proofs` bucket's `file_size_limit`. Keep in step. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface PreparedImage {
  blob: Blob;
  extension: string;
}

function untouched(file: File): PreparedImage {
  return { blob: file, extension: file.name.split(".").pop()?.toLowerCase() || "jpg" };
}

export async function compressImage(file: File): Promise<PreparedImage> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return untouched(file);
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Undecodable in this browser — HEIC outside Safari, most often.
    return untouched(file);
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) return untouched(file);
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY),
    );

    // A small PNG screenshot can re-encode larger. Keep whichever is smaller.
    if (!blob || blob.size >= file.size) return untouched(file);
    return { blob, extension: "jpg" };
  } catch {
    return untouched(file);
  } finally {
    bitmap.close();
  }
}
