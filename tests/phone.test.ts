import { describe, expect, it } from "vitest";
import { formatPhPhone, normalizePhPhone } from "@/lib/phone";

/**
 * Phone normalisation.
 *
 * This is not cosmetic. PhilSMS requires E.164, and the numbers in the system
 * arrive in three different shapes: Supabase stores a signed-in customer's
 * phone without the leading plus, walk-ins are typed at the counter in local
 * form, and some callers already pass +63. Sending any of the first two
 * unchanged means the customer never hears that their payment was received.
 */
describe("normalizePhPhone", () => {
  it("accepts every shape a Philippine number arrives in", () => {
    const expected = "+639958192317";
    expect(normalizePhPhone("09958192317")).toBe(expected); // typed at the counter
    expect(normalizePhPhone("639958192317")).toBe(expected); // as Supabase stores it
    expect(normalizePhPhone("+639958192317")).toBe(expected); // already E.164
    expect(normalizePhPhone("9958192317")).toBe(expected); // leading zero dropped
  });

  it("ignores spaces and punctuation people type", () => {
    expect(normalizePhPhone("0995 819 2317")).toBe("+639958192317");
    expect(normalizePhPhone("0995-819-2317")).toBe("+639958192317");
    expect(normalizePhPhone(" (0995) 819 2317 ")).toBe("+639958192317");
  });

  it("rejects what is not a Philippine mobile number", () => {
    expect(normalizePhPhone("")).toBeNull();
    expect(normalizePhPhone("12345")).toBeNull();
    expect(normalizePhPhone("0812 345 6789")).toBeNull(); // landline, not 9xx
    expect(normalizePhPhone("099581923171")).toBeNull(); // one digit too many
  });

  it("formats back to the local form people recognise", () => {
    expect(formatPhPhone("+639958192317")).toBe("0995 819 2317");
  });
});
