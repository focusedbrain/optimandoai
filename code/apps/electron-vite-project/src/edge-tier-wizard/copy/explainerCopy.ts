/**
 * Wizard explainer copy — Phase 4.5 (P4.5.1).
 * Enterprise-tone security documentation shown at wizard entry (free and paid).
 * UI layout consumes these structures in P4.5.2+.
 */

/** Section with optional title and bullet list. */
export interface ExplainerSection {
  readonly title?: string
  readonly paragraphs: readonly string[]
  readonly bullets?: readonly string[]
}

/** One threat the off-band pod is designed to address. */
export interface ExplainerThreat {
  readonly name: string
  readonly description: string
  readonly defense: string
}

export const EXPLAINER_HEADLINE = {
  title: 'Off-band validation for high-assurance environments',
} as const

export const EXPLAINER_OVERVIEW: ExplainerSection = {
  paragraphs: [
    'This setup deploys a small validation pod—built from the same code that runs on this computer—onto a Linux virtual server you control. Inbound BEAP messages and, if you opt in, selected email accounts are received, depackaged, and validated on that server first. Only certified, depackaged content is delivered to this computer.',
    'Validation that runs only on the endpoint is a single point of failure. A defect in attachment parsing, an error in MIME handling, or a denial-of-service attack aimed at the validator affects this machine directly. Moving validation off-band to a separate virtual server means attacker-controlled bytes are processed there first. This computer receives them only after they have been validated and bound to a cryptographic certificate you can verify.',
    'This computer still runs the full validator as a second check. The off-band certificate is a gate, not a replacement for local validation. If the certificate is missing or invalid, the message is rejected. If local validation fails even when the certificate verifies, the message is rejected.',
  ],
} as const

export const THREE_THREATS: readonly ExplainerThreat[] = [
  {
    name: 'Parser exploitation',
    description:
      'A crafted message may target weaknesses in parsing code—for example a zip bomb, deeply nested MIME structures, or malformed character encodings—intended to crash or compromise the validator during depackaging.',
    defense:
      'The off-band pod parses the bytes first. If exploitation succeeds, it occurs on the remote server, not on this endpoint. Restarting the off-band pod clears the failed state; this computer is not exposed to the malformed input.',
  },
  {
    name: 'Denial of service against the validator',
    description:
      'High-volume or resource-intensive malformed traffic can be used to saturate validation capacity and disrupt message processing on the endpoint.',
    defense:
      'The off-band pod absorbs that volume. This computer accepts only messages accompanied by a valid certificate, which can only be issued after successful validation on the off-band pod. Saturation of the off-band pod may delay delivery but does not expose this endpoint to unvalidated bytes.',
  },
  {
    name: 'Transit tampering of validated content',
    description:
      'An adversary positioned between the off-band pod and this computer might alter message content after validation but before local processing.',
    defense:
      'The off-band pod signs a certificate over the raw message bytes and the canonical validated form. This computer verifies the signature and hash bindings before processing. Any tampering invalidates the certificate and the message is rejected.',
  },
] as const

export const WHAT_IT_DOES_NOT_PROTECT_AGAINST: ExplainerSection = {
  title: 'Limitations',
  paragraphs: [
    'This feature does not protect against compromise of this computer, compromise of your identity provider, defects shared between the off-band pod validator and this computer validator, or attacks at the application layer that pass validation cleanly—for example a phishing message that contains no malicious payload, only social engineering. For phishing and social-engineering assessment, the AI analysis on this computer provides advisory scoring; that scoring remains available regardless of off-band validation.',
  ],
} as const

export const EMAIL_ON_EDGE_SECTION: ExplainerSection = {
  title: 'Optional: email fetched on the off-band pod',
  paragraphs: [
    'When you configure an email account to fetch through the off-band pod, the pod connects to your email provider directly. Provider traffic reaches the off-band pod before it reaches this computer. For those accounts, this computer does not open a connection to the provider.',
    'That mode requires your email provider credentials. For Google or Microsoft accounts, refresh tokens are issued on this computer, encrypted with a key derived from your vault, and transferred to the off-band pod. They are held only in pod memory according to the credential protocol in the high-assurance architecture document. A disk snapshot of the off-band virtual server at any point in time should not contain those credentials in plaintext.',
  ],
} as const
