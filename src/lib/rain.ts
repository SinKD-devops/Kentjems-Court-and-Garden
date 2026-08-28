/**
 * Rain thresholds, shared by server and client.
 *
 * Kept out of lib/weather.ts because that module is server-only — it holds the
 * forecast fetch — and the slot grid is a client component.
 */

/** Only worth showing when it might change a decision. */
export function rainWarning(chance: number): string | null {
  if (chance >= 70) return "Rain likely";
  if (chance >= 40) return "Rain possible";
  return null;
}

export const RAIN_LIKELY = 70;
