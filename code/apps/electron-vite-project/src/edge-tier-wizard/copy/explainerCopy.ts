/**
 * Wizard explainer copy — Phase 4.5 (P4.5.1).
 * Enterprise-tone security documentation shown at wizard entry (free and paid).
 */

/** Section with optional title and bullet list. */
export interface ExplainerSection {
  readonly title?: string
  readonly paragraphs: readonly string[]
  readonly bullets?: readonly string[]
}

export const EXPLAINER_HEADLINE = {
  title: 'Off-band validation for high-assurance environments',
} as const

export const EXPLAINER_OVERVIEW: ExplainerSection = {
  paragraphs: [
    'This setup deploys a small validation pod—built from the same code that runs on this computer—onto a Linux VPS you control. A small VPS with root access is enough.',
    'In high-assurance mode, email depackaging happens through the Edge Ingestor. The VPS receives the email content first, depackages it, validates it, and issues a cryptographic validation certificate. Only certified, validated content is delivered to this computer.',
    'Native BEAP capsules can still be received directly, depending on your security settings. For routes configured to require Edge Ingestor, the local app accepts only capsules with a valid Edge certificate. For routes that allow direct native BEAP, local validation still runs normally.',
    'This reduces direct exposure of your endpoint. Malformed attachments, zip bombs, complex MIME structures, and high-volume invalid traffic are handled by the VPS before they reach this machine.',
    'Your computer still performs full local validation as a second check. The Edge certificate is only a gate. If the certificate is missing where required, invalid, or local validation fails, the message is rejected.',
    'The Edge Ingestor also signs the validated content and its hashes. Any tampering between the VPS and this computer invalidates the certificate.',
    'This does not protect against compromise of this computer, stolen account credentials, shared validator bugs, or social-engineering attacks that pass technical validation. Phishing and intent analysis remain handled by the local AI advisory layer.',
  ],
} as const

export const EMAIL_ON_EDGE_SECTION: ExplainerSection = {
  title: 'Optional: email fetched on the Edge Ingestor',
  paragraphs: [
    'When you configure an email account to fetch through the Edge Ingestor, the ingestor connects to your email provider directly. Provider traffic reaches the VPS before it reaches this computer. For those accounts, this computer does not open a connection to the provider.',
    'That mode requires your email provider credentials. For Google or Microsoft accounts, refresh tokens are issued on this computer, encrypted with a key derived from your vault, and transferred to the Edge Ingestor. They are held only in pod memory according to the credential protocol in the high-assurance architecture document. A disk snapshot of the VPS at any point in time should not contain those credentials in plaintext.',
  ],
} as const
