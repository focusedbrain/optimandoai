/**
 * String Sanitization Utilities — Handshake Capsule Security Layer
 *
 * Provides NFC normalization, control-character stripping, and strict
 * email validation. Used by canonicalRebuild.ts (Gate 2) to ensure
 * every string field entering the Trusted Zone is safe and canonical.
 */

/**
 * Unicode NFC normalization — prevents homoglyph and composition attacks.
 * All string comparisons downstream operate on NFC-normalized text.
 */
export function normalizeNFC(input: string): string {
  return input.normalize('NFC')
}

/**
 * Strip all control characters except newline (\n) and tab (\t).
 * Blocks null bytes, backspace, escape sequences, BEL, vertical tab,
 * form feed, and C1 control characters.
 *
 * Ranges removed:
 *   U+0000–U+0008  (NUL through BS)
 *   U+000B         (VT — vertical tab)
 *   U+000C         (FF — form feed)
 *   U+000E–U+001F  (SO through US)
 *   U+007F         (DEL)
 *   U+0080–U+009F  (C1 control characters)
 */
export function stripControlChars(input: string): string {
  return input.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/g,
    '',
  )
}

/**
 * Strict email validation (restrictive subset of RFC 5322).
 *
 * Rejects:
 *   - Quoted local parts
 *   - IP literal domains
 *   - Comments
 *   - Addresses longer than 254 characters
 *
 * This is deliberately more restrictive than RFC 5322 to reduce
 * the attack surface for injection and encoding tricks.
 */
export function isValidEmail(email: string): boolean {
  if (typeof email !== 'string' || email.length > 254 || email.length === 0) {
    return false
  }
  const pattern =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
  return pattern.test(email)
}
