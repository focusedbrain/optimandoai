// ============================================================================
// WRVault Autofill — UX Microcopy (Centralized Strings)
// ============================================================================
//
// Every user-facing string lives here.  No UI module should contain inline
// text.  This enables:
//   - Consistent voice across all autofill surfaces
//   - Future i18n without touching UI code
//   - Single-point review for compliance / legal copy
//
// Voice guidelines:
//   - Short. One sentence max.  No jargon.
//   - Active voice.  Address the user as "you."
//   - State what will happen, not what could happen.
//   - Never blame the user for errors.
//
// ============================================================================

// ============================================================================
// §1  OVERLAY PREVIEW
// ============================================================================

export const OVERLAY = {
  /** Top-level explanation shown in the overlay header region. */
  heading: 'WRVault wants to fill this form',

  /** Explanation of what the overlay does (shown on first use or hover). */
  explanation:
    'WRVault found matching credentials for this page. ' +
    'Review the fields below, then click Insert to fill them.',

  /** Why consent is required — shown as a subtle footnote or tooltip. */
  consentReason:
    'Your explicit consent is required before any value is written to the page. ' +
    'This prevents accidental data exposure and ensures you control what is shared.',

  /** Button labels. */
  insertButton: 'Insert',
  cancelButton: 'Cancel',
  closeLabel: 'Close',

  /** Trust toggle. */
  trustToggleLabel: (domain: string) => `Always allow on ${domain}`,
  trustToggleHint: 'Skip this preview on future visits to this site.',

  /** Field row labels. */
  passwordMasked: 'Password (hidden)',
  revealLabel: 'Reveal',
  hideLabel: 'Hide',
  copyLabel: 'Copy',
  copiedLabel: 'Copied',

  /** Expire notice. */
  expiredNotice: 'This preview expired. Please reopen to try again.',

  /** Keyboard hint (screen reader only). */
  keyboardHint: 'Press Enter to insert, Escape to cancel.',
} as const

// ============================================================================
// §2  QUICK SELECT
// ============================================================================

export const QUICK_SELECT = {
  /** Search input placeholder. */
  searchPlaceholder: 'Search vault\u2026',

  /** Trigger icon tooltip / aria-label. */
  triggerIconLabel: 'Search vault',
  triggerIconTooltip: 'Search vault (Ctrl+Shift+.)',

  /** Empty states. */
  emptySearch: 'No matching entries',
  emptyVault: 'Vault is empty',

  /** Domain match badge. */
  domainBadge: 'This site',

  /** Status bar. */
  resultCount: (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`,

  /** Keyboard shortcut display. */
  shortcutLabel: 'Ctrl+Shift+.',

  /** Screen reader announcement. */
  srAnnounce: (n: number) => `${n} vault ${n === 1 ? 'entry' : 'entries'} available`,
} as const

// ============================================================================
// §3  SAVE PASSWORD BAR
// ============================================================================

export const SAVE_BAR = {
  /** Disk icon tooltip / aria-label. */
  iconLabel: 'Save password to WRVault',
  iconTooltip: 'Save this password',

  /** Dialog heading. */
  dialogHeading: 'Save to WRVault',

  /** Field labels in the save dialog. */
  domainLabel: 'Site',
  titleLabel: 'Title',
  usernameLabel: 'Username',
  passwordLabel: 'Password',

  /** Buttons. */
  saveButton: 'Save',
  updateButton: 'Update',
  cancelButton: 'Cancel',
  neverButton: 'Never for this site',

  /** Duplicate detection. */
  existingHeading: 'Existing credentials found',
  updateExisting: 'Update existing',
  saveNew: 'Save as new entry',

  /** Feedback. */
  savedConfirmation: 'Saved to vault.',
  updatedConfirmation: 'Credential updated.',

  /** Why we ask (tooltip on the "Never" button). */
  neverHint: 'WRVault will not offer to save passwords on this site.',
} as const

// ============================================================================
// §4  ERROR MESSAGES (user-facing)
// ============================================================================

export const ERRORS = {
  /** Generic fallback. */
  generic: 'Something went wrong. Please try again.',

  /** Field-specific. */
  fieldGone: 'The field was removed from the page.',
  fieldHidden: 'The field is no longer visible.',
  fieldDisabled: 'The field is disabled.',
  fieldMoved: 'The field moved. Please try again.',
  fieldReadonly: 'This field is read-only.',

  /** Security blocks. */
  iframeBlocked: 'This field is in a restricted frame.',
  clickjackDetected: 'A suspicious overlay was detected. Fill blocked for safety.',
  domChanged: 'The page changed since the preview. Please reopen.',

  /** Session. */
  sessionExpired: 'Session timed out. Please reopen the preview.',
  vaultLocked: 'Vault is locked. Unlock and try again.',

  /** Safe mode. */
  safeModeFallback: 'Low confidence. Use the search icon to choose manually.',
  multiAccount: 'Multiple accounts found. Please choose one.',
} as const

// ============================================================================
// §5  SETTINGS PANEL
// ============================================================================

export const SETTINGS = {
  /** Section heading in vault settings. */
  sectionHeading: 'Secure Insert Overlay',
  sectionDescription: 'Control how WRVault fills forms on web pages.',

  /** Global toggle. */
  globalToggleLabel: 'Enable autofill overlay',
  globalToggleHint: 'When off, WRVault will not interact with page fields.',

  /** Per-section toggles. */
  loginToggle: 'Login autofill (username, email, password)',
  identityToggle: 'Identity autofill (name, address, phone)',
  companyToggle: 'Company autofill (company name, VAT, IBAN)',
  customToggle: 'Custom fields (tagged entries)',

  /** Audit log panel. */
  auditLogHeading: 'Autofill Activity Log',
  auditLogDescription: 'Local-only log of autofill events. Not transmitted.',
  clearLogButton: 'Clear log',
  noLogEntries: 'No events recorded.',
} as const

// ============================================================================
// §6  CONSENT EXPLAINER (for first-time users or help panel)
// ============================================================================

export const CONSENT_EXPLAINER = {
  heading: 'Why does WRVault ask for consent?',

  paragraphs: [
    'WRVault never fills form fields automatically without your approval. ' +
    'When a match is found, a preview appears showing exactly which values will be inserted.',

    'You must click "Insert" or press Enter to proceed. ' +
    'This prevents silent data leakage — especially for passwords, which are never ' +
    'displayed in cleartext unless you explicitly reveal them.',

    'If WRVault is unsure about a field, it shows a search icon instead of filling automatically. ' +
    'You can then pick the right entry from your vault yourself.',

    'All of this happens locally. No field values leave your device during the autofill process.',
  ],

  securityNotes: [
    'Passwords are masked by default. Cleartext is only shown on explicit reveal.',
    'All UI runs inside an isolated Shadow DOM that page scripts cannot access.',
    'A structural fingerprint of each field is checked before filling to detect tampering.',
    'Cross-origin iframes are never filled.',
    'Sessions expire automatically to prevent stale consents.',
  ],
} as const
