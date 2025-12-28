/**
 * Handshake Microcopy
 * 
 * Exact text strings for the handshake fingerprint UI.
 * All text is canonical and should not be modified without review.
 */

// =============================================================================
// Badge Text
// =============================================================================

export const BADGE_TEXT = {
  LOCAL: 'Local (unregistered)',
  VERIFIED: 'Verified via wrcode.org',
} as const

// =============================================================================
// Automation Mode Labels
// =============================================================================

export const AUTOMATION_LABELS = {
  DENY: 'Deny',
  REVIEW: 'Review',
  ALLOW: 'Allow',
} as const

export const AUTOMATION_DESCRIPTIONS = {
  DENY: 'Packages may be received, no automation executed',
  REVIEW: 'Actions suggested, require manual confirmation',
  ALLOW: 'Policy-bound auto-execution permitted',
} as const

// =============================================================================
// Tooltips
// =============================================================================

export const TOOLTIPS = {
  FINGERPRINT: 'A fingerprint is a short identifier derived from the handshake identity. It helps prevent mix-ups and look-alike contacts. It is not a secret key.',
  FINGERPRINT_TITLE: 'Fingerprint',
  COPY_FINGERPRINT: 'Copy Fingerprint',
  COMPARE_FINGERPRINTS: 'Compare Fingerprints',
  VERIFY_VIA_WRCODE: 'Verify via wrcode.org',
} as const

// =============================================================================
// Policy Notes
// =============================================================================

export const POLICY_NOTES = {
  LOCAL_OVERRIDE: 'Local Receiver Policy overrides package policy.',
  NO_ESCALATION: 'Package policy cannot elevate permissions above local policy.',
} as const

// =============================================================================
// Action Labels
// =============================================================================

export const ACTION_LABELS = {
  COPY_FINGERPRINT: 'Copy Fingerprint',
  VERIFY_WRCODE: 'Verify via wrcode.org',
  ACCEPT_HANDSHAKE: 'Accept Handshake',
  REJECT_HANDSHAKE: 'Reject',
  COMPARE: 'Compare',
} as const

// =============================================================================
// Status Messages
// =============================================================================

export const STATUS_MESSAGES = {
  FINGERPRINT_COPIED: 'Fingerprint copied to clipboard',
  FINGERPRINTS_MATCH: 'Fingerprints match ✓',
  FINGERPRINTS_MISMATCH: 'Fingerprints do not match ✗',
  VERIFICATION_PENDING: 'Verification pending...',
  VERIFICATION_SUCCESS: 'Verified successfully',
  VERIFICATION_FAILED: 'Verification failed',
} as const

// =============================================================================
// Handshake Request Default Message
// =============================================================================

export const HANDSHAKE_REQUEST_TEMPLATE = `Dear [Recipient Name],

I am writing to request the establishment of a BEAP™ (Bidirectional Email Automation Protocol) handshake between our systems.

Upon successful completion, this handshake will enable:

• Cryptographically verified BEAP™ package exchange
• Policy-bound, trusted automation workflows
• End-to-end encrypted, integrity-validated bidirectional communication

The handshake serves as the trust anchor for future interactions and ensures that all exchanged BEAP™ packages are processed in accordance with verified identity, declared execution policies, and local enforcement rules.

**Handshake Fingerprint:** [FINGERPRINT]

Please verify this fingerprint matches what you expect before accepting.

Please confirm acceptance of this request to complete the handshake initialization.

Kind regards,
[Your Name]
[Organization]
[Role / Function, if applicable]`

// =============================================================================
// All Microcopy as JSON Map
// =============================================================================

export const MICROCOPY = {
  badges: BADGE_TEXT,
  automation: {
    labels: AUTOMATION_LABELS,
    descriptions: AUTOMATION_DESCRIPTIONS,
  },
  tooltips: TOOLTIPS,
  policy: POLICY_NOTES,
  actions: ACTION_LABELS,
  status: STATUS_MESSAGES,
  templates: {
    handshakeRequest: HANDSHAKE_REQUEST_TEMPLATE,
  },
} as const

