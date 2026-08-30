/**
 * Password rules, in one place so the sign-in screen and the change-password
 * screen cannot drift apart.
 *
 * Kept deliberately small. This is a court booking app in a town where most
 * customers will set a password once on a phone keyboard; a rule they cannot
 * satisfy sends them back to waiting for a text, which is the thing passwords
 * exist here to avoid.
 *
 * Two rules earn their place:
 *
 *   Length. Supabase's own default minimum is 6, which is too short for an
 *   account namespace an attacker can enumerate — every Philippine mobile
 *   number is `09` followed by nine digits, so the usernames are not secret.
 *
 *   Not the phone number. It is the first thing someone types when the field
 *   is on the same screen as their number, and it is the first thing anyone
 *   guessing would try.
 *
 * Real strength enforcement — leaked-password checking against HaveIBeenPwned
 * and a project-wide minimum — lives in the Supabase dashboard under
 * Authentication → Policies. It cannot be set from code, and it is the part
 * that actually stops "password123". See HANDOVER §7.
 */

export const MIN_PASSWORD_LENGTH = 8;

/** Returns a message to show the customer, or null when the password is fine. */
export function checkPassword(password: string, phone?: string | null): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Please use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  if (phone) {
    const digits = password.replace(/\D/g, "");
    const phoneDigits = phone.replace(/\D/g, "");
    if (digits.length > 0 && phoneDigits.endsWith(digits) && digits.length >= 7) {
      return "Please do not use your phone number as your password.";
    }
  }

  return null;
}
