/**
 * Email Transport Bridge — Capsule Builder → Email Gateway
 *
 * Bridges the handshake capsule builder to the email gateway, enabling
 * outbound delivery of BEAP capsules via email (Gmail, Outlook, IMAP/SMTP).
 *
 * The capsule is serialized to JSON and sent as the email body with
 * BEAP detection markers so the recipient's Ingestor can identify it.
 */

import type { HandshakeCapsuleWire } from './capsuleBuilder'
import { serializeCapsule } from './capsuleTransport'
import type { SendEmailPayload } from '../email/types'

export interface EmailTransportResult {
  success: boolean
  messageId?: string
  error?: string
}

export interface EmailSendFn {
  (accountId: string, payload: SendEmailPayload): Promise<{ success: boolean; messageId?: string; error?: string }>
}

let _emailSendFn: EmailSendFn | null = null

/**
 * Inject the email send function. Called once at app startup with
 * `emailGateway.sendEmail.bind(emailGateway)`.
 *
 * This avoids a direct import of the EmailGateway singleton, keeping
 * the handshake module decoupled and testable with mock senders.
 */
export function setEmailSendFn(fn: EmailSendFn): void {
  _emailSendFn = fn
}

/** @internal — for tests only */
export function _resetEmailSendFn(): void {
  _emailSendFn = null
}

/**
 * Send a built capsule to the recipient via email.
 *
 * The outgoing email includes BEAP detection markers:
 *   - Subject prefix for human identification
 *   - Body is the serialized JSON capsule
 *   - No HTML — plain text only (JSON is the content)
 *
 * @param fromAccountId - The local email account ID to send from
 * @param recipientEmail - The counterparty's email address
 * @param capsule - The built HandshakeCapsuleWire to send
 */
export async function sendCapsuleViaEmail(
  fromAccountId: string,
  recipientEmail: string,
  capsule: HandshakeCapsuleWire,
): Promise<EmailTransportResult> {
  if (!_emailSendFn) {
    return { success: false, error: 'Email send function not configured. Connect an email account first.' }
  }
  if (!fromAccountId) {
    return { success: false, error: 'No email account specified (fromAccountId is required)' }
  }
  if (!recipientEmail) {
    return { success: false, error: 'No recipient email specified' }
  }

  const serialized = serializeCapsule(capsule)
  const hsIdShort = capsule.handshake_id.slice(0, 8)

  const payload: SendEmailPayload = {
    to: [recipientEmail],
    subject: `BEAP Handshake: ${capsule.capsule_type} [${hsIdShort}]`,
    bodyText: serialized,
  }

  try {
    const result = await _emailSendFn(fromAccountId, payload)
    return {
      success: result.success,
      messageId: result.messageId,
      error: result.error,
    }
  } catch (err: any) {
    return {
      success: false,
      error: err?.message ?? 'Email send failed',
    }
  }
}
