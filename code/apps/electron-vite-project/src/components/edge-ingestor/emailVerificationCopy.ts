/**
 * Email verification panel — user-facing copy (Prompt C).
 * Avoid implementation jargon in primary strings; "Ingestor" does not appear here.
 */

export const EMAIL_VERIFICATION_TITLE = 'Email verification'

export const EMAIL_VERIFICATION_SUMMARY =
  'Email attachments and encrypted payloads are verified before being shown on this computer. By default, verification runs locally on this device, inside an isolated environment.'

export const EMAIL_VERIFICATION_UPGRADE =
  'For high-risk use — journalism, legal work, regulated environments — verification can be moved to a separate Linux server you control. Attachments are then never processed on this computer until your server has verified them. Requires a paid tier and a Linux VPS.'

export const EMAIL_VERIFICATION_LEARN_MORE = 'Learn more about email verification'

export const EMAIL_VERIFICATION_CURRENT_SETUP = 'Current setup'

export const SETUP_SERVER_VERIFICATION_BUTTON = 'Set up server-side verification'

export const SWITCH_BACK_TO_LOCAL_BUTTON = 'Switch back to local verification'

export const MANAGE_REPLICAS_BUTTON = 'Manage replicas'

export const ALLOW_TEMPORARY_LOCAL_BUTTON = 'Allow temporary local verification'

export const RETRY_CONNECTION_BUTTON = 'Retry connection'

export const REMOVE_REPLICA_BUTTON = 'Remove replica'

export const RESUME_SETUP_BUTTON = 'Resume setup'

export const PAID_TIER_BADGE = 'PAID'

/** Cleaned explainer paragraphs for the Learn more expansion. */
export const EMAIL_VERIFICATION_LEARN_MORE_PARAGRAPHS: readonly string[] = [
  'Encrypted email messages are validated safely by default. In standard mode, attachments are unpacked and checked for malicious content on this computer inside an isolated environment.',
  'Server-side verification adds another layer for higher-risk environments: the same verification software runs on a separate Linux server you control. The server receives email content first, unpacks attachments, checks for malicious content, and issues a cryptographic certificate. Only certified content is then delivered to this computer.',
  'Your computer still performs full local validation as a second check. The server certificate is a gate, not a replacement — if the certificate is missing, invalid, or local validation fails, the message is rejected.',
  'This mode is intended for users and organizations with higher assurance requirements. Standard local verification is secure; server-side verification adds an additional isolation layer when the stakes are higher.',
]

export const SWITCH_BACK_CONFIRM_TITLE = 'Switch back to local verification?'

export function switchBackConfirmBody(host: string): string {
  return `Switching back to local verification will remove the verification server configuration for ${host} from this app and delete its keys here. Encrypted email messages will then be unpacked on this computer instead. The remote server may still be running until you remove it manually. Continue?`
}

export function setupInProgressBody(host: string): string {
  return `Setup in progress on ${host}.`
}

export function configuredActiveBody(host: string, lastContact: string): string {
  return `Verification is running on your server (${host}). Last contact: ${lastContact}.`
}

export function configuredUnreachableBody(heldCount: number): string {
  const noun = heldCount === 1 ? 'email is' : 'emails are'
  return `Your verification server is currently unreachable. ${heldCount} ${noun} being held safely.`
}

export const HOST_FALLBACK_CONFIRM_BODY =
  'Allowing temporary local verification means email will be unpacked on this computer instead of your server for the rest of this session. This authorization expires when you quit the app.'
