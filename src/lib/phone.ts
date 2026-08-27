/**
 * Philippine mobile numbers, normalised to E.164 for Supabase auth.
 *
 * People type these four ways: 09171234567, 9171234567, +639171234567,
 * and 639171234567. All four are the same number and all four must work —
 * rejecting a format is how you lose a booking at the counter.
 */
export function normalizePhPhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "").replace(/^\+/, "");

  let national: string;
  if (digits.startsWith("63") && digits.length === 12) national = digits.slice(2);
  else if (digits.startsWith("0") && digits.length === 11) national = digits.slice(1);
  else if (digits.length === 10) national = digits;
  else return null;

  // Every PH mobile number is 10 digits starting with 9.
  if (!/^9\d{9}$/.test(national)) return null;
  return `+63${national}`;
}

/** +639171234567 → 0917 123 4567 */
export function formatPhPhone(e164: string): string {
  const n = e164.replace(/^\+63/, "");
  if (!/^9\d{9}$/.test(n)) return e164;
  return `0${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
}
