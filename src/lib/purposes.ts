/**
 * What the court can be rented for.
 *
 * This list is for LABELS ONLY. The authority on which purposes are accepted
 * is `request_booking` in Postgres, which validates the value and declines
 * cheerdance and practice in the same transaction as the insert — the same
 * reason every other booking rule lives there rather than here.
 *
 * The declined two are deliberately still offered. Hiding them would leave
 * someone who wants the court for cheerdance guessing why their activity is
 * missing; offering them means they get an actual answer and a number to call.
 * Do not add a client-side block on them — the polite refusal is the feature.
 *
 * If this list and the database ever disagree, the database wins and the
 * customer sees "Please choose what the court is for."
 */
export const COURT_PURPOSES = [
  { value: "pickleball", label: "Pickleball" },
  { value: "badminton", label: "Badminton" },
  { value: "volleyball", label: "Volleyball" },
  { value: "cheerdance", label: "Cheerdance" },
  { value: "practice", label: "Practice" },
  { value: "basketball", label: "Basketball" },
] as const;

export type CourtPurpose = (typeof COURT_PURPOSES)[number]["value"];

/** Title-cases a stored purpose for display. Unknown values pass through. */
export function purposeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return COURT_PURPOSES.find((p) => p.value === value)?.label ?? value;
}
