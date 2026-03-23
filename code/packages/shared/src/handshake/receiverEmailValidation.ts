/**
 * Receiver email validation for handshake acceptance.
 * HIGH ASSURANCE: A handshake addressed to a specific email must ONLY be
 * acceptable by an account with that email.
 */

export interface ReceiverEmailValidationResult {
  valid: boolean
  reason?: string
}

/**
 * Normalize email for comparison: trim, lowercase.
 */
function normalizeEmail(email: string | null | undefined): string {
  if (email == null || typeof email !== 'string') return ''
  return email.trim().toLowerCase()
}

/**
 * Resolve user emails to array.
 *
 * @param userEmails - JWT can return string or string[] (e.g. email claim)
 */
function toEmailArray(userEmails: string | string[] | null | undefined): string[] {
  if (userEmails == null) return []
  if (Array.isArray(userEmails)) {
    return userEmails
      .filter((e): e is string => typeof e === 'string')
      .map((e) => normalizeEmail(e))
      .filter((e) => e.length > 0)
  }
  const s = normalizeEmail(userEmails)
  return s ? [s] : []
}

/**
 * Validate that the receiver email matches the current user's email(s).
 *
 * @param handshakeReceiverEmail - receiver_email from the handshake record (or capsule)
 * @param userEmails - current user's email(s) from SSO/JWT (string or array)
 * @returns { valid, reason? }
 */
export function validateReceiverEmail(
  handshakeReceiverEmail: string | null | undefined,
  userEmails: string | string[] | null | undefined,
): ReceiverEmailValidationResult {
  const receiver = normalizeEmail(handshakeReceiverEmail)

  // Legacy handshakes: receiver_email may be null/empty
  if (!receiver) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[receiverEmailValidation] Legacy handshake: receiver_email is null/empty — allowing acceptance for backward compatibility')
    }
    return { valid: true }
  }

  const userList = toEmailArray(userEmails)
  if (userList.length === 0) {
    return {
      valid: false,
      reason: 'Cannot validate: no authenticated email available.',
    }
  }

  const match = userList.some((u) => u === receiver)
  if (match) {
    return { valid: true }
  }

  const primary = userList[0]
  return {
    valid: false,
    reason: `Handshake rejection: This handshake is addressed to ${receiver}. Your authenticated identity (${primary}) does not match the intended recipient.`,
  }
}
