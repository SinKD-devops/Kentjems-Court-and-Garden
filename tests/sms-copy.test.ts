import { describe, expect, it } from "vitest";
import { gsmSafe, smsCopy, smsPesos } from "@/lib/sms";

/**
 * SMS copy has two hard limits, and breaking either costs real money without
 * failing anything.
 *
 * Over 160 characters splits into two messages, billed twice. A single
 * character outside the GSM alphabet forces Unicode encoding, which drops the
 * limit to 70 — so one peso sign can turn a one-credit message into three.
 *
 * Longest realistic values are used, since the limit is only ever hit by the
 * worst case: a garden evening booking spanning midnight.
 */

const SPACE = "Garden";
const WHEN = "28 Aug 11:00 PM-12:00 AM";
const OTHER = "29 Aug 10:00 PM-11:00 PM";
const REFERENCE = "0031882774015";
const SUPPORT = "0950 236 1590";

/** GSM 03.38, the characters a plain SMS can carry. */
const GSM =
  "@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà" +
  "\n\r\f^{}\\[~]|€";

const messages: Record<string, string> = {
  approved: smsCopy.approved(SPACE, WHEN, REFERENCE),
  rejected: smsCopy.rejected("duplicate reference", SUPPORT),
  confirmedAtCounter: smsCopy.confirmedAtCounter(SPACE, WHEN),
  superseded: smsCopy.superseded(SPACE, WHEN),
  moved: smsCopy.moved(SPACE, WHEN, OTHER),
  proofToReview: smsCopy.proofToReview(SPACE, WHEN, smsPesos(35000), REFERENCE),
};

describe("SMS copy", () => {
  it("fits in a single message", () => {
    for (const [name, text] of Object.entries(messages)) {
      expect([name, text.length <= 160]).toEqual([name, true]);
    }
  });

  it("uses only characters a plain SMS can carry", () => {
    for (const [name, text] of Object.entries(messages)) {
      const outside = [...text].filter((c) => !GSM.includes(c));
      expect([name, outside]).toEqual([name, []]);
    }
  });

  it("writes amounts without the peso sign", () => {
    expect(smsPesos(35000)).toBe("PHP 350");
    expect(smsPesos(6050)).toBe("PHP 60.50");
  });

  it("rewrites characters that would force Unicode encoding", () => {
    expect(gsmSafe("7:00 – 8:00 ₱100 “quoted” it’s…")).toBe(
      `7:00 - 8:00 PHP 100 "quoted" it's...`,
    );
  });

  /**
   * The words Philippine carriers filter on. The sign-in message is the one
   * that matters most: without it nobody can use the app at all.
   */
  it("avoids the words carriers filter", () => {
    const banned = ["otp", "one-time", "password", "verify", "verification", "pin code"];
    for (const [name, text] of Object.entries(messages)) {
      const found = banned.filter((word) => text.toLowerCase().includes(word));
      expect([name, found]).toEqual([name, []]);
    }
  });
});
