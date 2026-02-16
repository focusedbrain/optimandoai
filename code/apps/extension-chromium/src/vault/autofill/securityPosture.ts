// ============================================================================
// WRVault Autofill — Security Posture Statement
// ============================================================================
//
// This module documents the factual security properties of the autofill
// pipeline.  Every claim is traceable to a specific code mechanism.
//
// This is NOT marketing copy.  It is a technical reference for:
//   - Security auditors reviewing the implementation
//   - Enterprise compliance teams evaluating the product
//   - Developers extending the pipeline
//
// Format: structured data that can be rendered in a security dashboard,
// exported to PDF, or consumed by compliance tooling.
//
// ============================================================================

// ============================================================================
// §1  SECURITY PROPERTIES
// ============================================================================

export interface SecurityProperty {
  /** Stable identifier. */
  id: string
  /** Short title. */
  title: string
  /** Factual description of the property. */
  description: string
  /** How the property is enforced (code mechanism). */
  enforcement: string
  /** File(s) where enforcement is implemented. */
  implementedIn: string[]
  /** Whether this property is independently verifiable. */
  verifiable: boolean
  /** Category for grouping. */
  category: SecurityCategory
}

export type SecurityCategory =
  | 'consent'
  | 'isolation'
  | 'data_handling'
  | 'tamper_detection'
  | 'access_control'
  | 'logging'
  | 'network'

export const SECURITY_PROPERTIES: readonly SecurityProperty[] = [

  // ── Consent ──

  {
    id: 'SEC-CONSENT-01',
    title: 'Explicit consent before every fill',
    description:
      'No value is written to any page DOM element without the user clicking "Insert" ' +
      'or pressing Enter on the overlay preview.  The overlay is the only code path ' +
      'that can transition a session to the "committed" state.',
    enforcement:
      'commitInsert() requires session.state === "preview".  The overlay promise ' +
      'resolves with action:"insert" only on explicit user interaction.  No timer, ' +
      'mutation, or script can trigger it.',
    implementedIn: ['committer.ts', 'overlayManager.ts'],
    verifiable: true,
    category: 'consent',
  },
  {
    id: 'SEC-CONSENT-02',
    title: 'Session expiry prevents stale consents',
    description:
      'Overlay sessions expire after a configurable timeout (default 120s).  ' +
      'An expired session cannot be committed regardless of prior consent.',
    enforcement:
      'commitInsert gate 2 checks Date.now() - session.createdAt > session.timeoutMs.  ' +
      'The overlay also has an independent expire timer that auto-dismisses.',
    implementedIn: ['committer.ts', 'overlayManager.ts'],
    verifiable: true,
    category: 'consent',
  },
  {
    id: 'SEC-CONSENT-03',
    title: 'Safe mode: uncertain matches require manual selection',
    description:
      'When the matching engine is uncertain (ambiguous mapping, unknown form context, ' +
      'multi-account domain, public suffix), the system does not auto-insert.  Instead, ' +
      'a trigger icon is shown and the user must open QuickSelect to choose manually.',
    enforcement:
      'evaluateSafeMode() returns autoInsertAllowed: false with specific reasons.  ' +
      'The orchestrator shows the trigger icon instead of the overlay.',
    implementedIn: ['hardening.ts', 'autofillOrchestrator.ts'],
    verifiable: true,
    category: 'consent',
  },

  // ── Isolation ──

  {
    id: 'SEC-ISOL-01',
    title: 'Closed Shadow DOM for all injected UI',
    description:
      'All autofill UI (overlay, QuickSelect dropdown, trigger icons, save bar) ' +
      'is rendered inside Shadow DOM hosts with mode:"closed".  Page scripts cannot ' +
      'access the shadow root, its internal nodes, or event listeners.',
    enforcement:
      'attachShadow({ mode: "closed" }) in overlayManager, quickSelect, saveBar.  ' +
      'The ShadowRoot reference is held only in module-private variables.',
    implementedIn: ['overlayManager.ts', 'quickSelect.ts', 'saveBar.ts'],
    verifiable: true,
    category: 'isolation',
  },
  {
    id: 'SEC-ISOL-02',
    title: 'Cross-origin iframes hard-blocked',
    description:
      'Fields inside cross-origin iframes are excluded from scanning, overlays, ' +
      'commit, QuickSelect, and save-password detection.  The content script ' +
      'cannot access cross-origin frame content by browser security policy; this ' +
      'is additionally enforced at the scanner and guard levels.',
    enforcement:
      'isCrossOriginElement() in fieldScanner.ts returns true for cross-origin.  ' +
      'guardElement() in hardening.ts checks window.parent.location.origin and ' +
      'iframe sandbox attributes.',
    implementedIn: ['fieldScanner.ts', 'hardening.ts', 'committer.ts'],
    verifiable: true,
    category: 'isolation',
  },
  {
    id: 'SEC-ISOL-03',
    title: 'No external resource loads from injected UI',
    description:
      'All icons are inline SVG.  All fonts use system font stack.  No images, ' +
      'stylesheets, or scripts are loaded from external URLs by any autofill UI component.',
    enforcement:
      'CSS_TOKENS uses system font families.  SVG icons are string literals in the ' +
      'module source.  No <link>, <img src>, or fetch() calls exist in UI modules.',
    implementedIn: ['overlayStyles.ts', 'overlayManager.ts', 'quickSelect.ts', 'saveBar.ts'],
    verifiable: true,
    category: 'isolation',
  },

  // ── Data Handling ──

  {
    id: 'SEC-DATA-01',
    title: 'Passwords never appear in DOM text nodes or attributes',
    description:
      'Password values are only written to input.value (IDL property) via ' +
      'setValueSafely().  They never appear in innerHTML, textContent, data-*, ' +
      'title, aria-label, or any other DOM attribute.  The overlay preview ' +
      'displays masked values (bullet characters) by default.',
    enforcement:
      'overlayManager.updateValueDisplay() calls computeDisplayValue() which returns ' +
      'bullets for sensitive fields.  setValueSafely() writes only to the value property.  ' +
      'No setAttribute("value", ...) is called for password-type fields without immediate ' +
      'property override.',
    implementedIn: ['overlayManager.ts', 'committer.ts'],
    verifiable: true,
    category: 'data_handling',
  },
  {
    id: 'SEC-DATA-02',
    title: 'Clipboard auto-clear after copy',
    description:
      'When a password is copied from the overlay, the clipboard is automatically ' +
      'cleared after 30 seconds (configurable).  The clear operation verifies the ' +
      'clipboard still contains the copied value before overwriting.',
    enforcement:
      'overlayManager.onCopy() sets a timer at DEFAULT_MASKING.clipboardClearMs.  ' +
      'On expiry, reads clipboard and clears only if content matches.',
    implementedIn: ['overlayManager.ts'],
    verifiable: true,
    category: 'data_handling',
  },
  {
    id: 'SEC-DATA-03',
    title: 'In-memory search index excludes passwords',
    description:
      'The vault index used by QuickSelect stores only non-sensitive metadata: ' +
      'title, domain, username, category, favorite flag, updatedAt.  Password ' +
      'values and other sensitive fields are never included in search tokens.',
    enforcement:
      'vaultIndex.itemToEntry() extracts username via extractUsername() which skips ' +
      'fields with type "password".  No field.value for sensitive fields is stored.',
    implementedIn: ['vaultIndex.ts'],
    verifiable: true,
    category: 'data_handling',
  },
  {
    id: 'SEC-DATA-04',
    title: 'Index and audit data cleared on vault lock',
    description:
      'When the vault locks, all in-memory data derived from vault contents is ' +
      'zeroized: the search index, the audit log, and the telemetry buffer.',
    enforcement:
      'teardownAutofill() calls clearIndex(), clearAuditLog(), clearTelemetry().  ' +
      'handleToggleChange() does the same when vaultUnlocked transitions to false.',
    implementedIn: ['autofillOrchestrator.ts', 'vaultIndex.ts', 'hardening.ts'],
    verifiable: true,
    category: 'data_handling',
  },

  // ── Tamper Detection ──

  {
    id: 'SEC-TAMP-01',
    title: 'DOM fingerprint validated before commit',
    description:
      'A structural fingerprint (SHA-256 hash of 10 element properties) is captured ' +
      'when the overlay opens and re-validated at commit time.  If any property ' +
      'changed (tag name, type, name, id, autocomplete, bounding rect, visibility, ' +
      'parent chain, frame origin, form action), the commit is blocked.',
    enforcement:
      'takeFingerprint() at session creation.  validateFingerprint() inside ' +
      'runSafetyChecks() at commit time.  Hash mismatch → FINGERPRINT_MISMATCH.',
    implementedIn: ['domFingerprint.ts', 'committer.ts'],
    verifiable: true,
    category: 'tamper_detection',
  },
  {
    id: 'SEC-TAMP-02',
    title: 'Bounding rect stability check',
    description:
      'The element\'s position is checked for drift between fingerprint capture ' +
      'and commit.  Movements larger than 4px in any dimension block the commit.',
    enforcement:
      'checkBoundingRectStable() in committer.ts.  RECT_TOLERANCE_PX = 4.',
    implementedIn: ['committer.ts'],
    verifiable: true,
    category: 'tamper_detection',
  },
  {
    id: 'SEC-TAMP-03',
    title: 'Clickjacking detection via elementFromPoint',
    description:
      'Before creating an overlay session, guardElement() checks whether a ' +
      'transparent or nearly-transparent element covers the target at its center ' +
      'point.  If detected, the operation is blocked with CLICKJACK_DETECTED.',
    enforcement:
      'guardElement() calls document.elementFromPoint(centerX, centerY) and checks ' +
      'if the returned element is not the target and has opacity < 0.1.',
    implementedIn: ['hardening.ts'],
    verifiable: true,
    category: 'tamper_detection',
  },
  {
    id: 'SEC-TAMP-04',
    title: 'Overlay host position tamper detection',
    description:
      'The overlay position watchdog continuously checks whether the host element ' +
      'has been moved outside the viewport by a page script.  If the host is ' +
      'positioned more than 100px outside any viewport edge, the overlay auto-dismisses.',
    enforcement:
      'startPositionWatchdog() in overlayManager.ts checks _host.getBoundingClientRect() ' +
      'on every animation frame.',
    implementedIn: ['overlayManager.ts'],
    verifiable: true,
    category: 'tamper_detection',
  },

  // ── Access Control ──

  {
    id: 'SEC-ACL-01',
    title: 'Capability gating by vault tier',
    description:
      'Autofill operations respect the vault capability system.  Record types ' +
      'that require a higher tier (e.g., human_credential requires pro) are ' +
      'blocked if the user\'s tier is insufficient.',
    enforcement:
      'canAccessRecordType() from vaultCapabilities.ts is checked before listing ' +
      'items for the search index and before creating overlay sessions.',
    implementedIn: ['vaultCapabilities.ts', 'vaultIndex.ts'],
    verifiable: true,
    category: 'access_control',
  },
  {
    id: 'SEC-ACL-02',
    title: 'VSBT token required for vault API calls',
    description:
      'All HTTP API calls from the extension to the Electron vault backend require ' +
      'a valid VSBT (Vault Session Binding Token).  Expired or missing tokens cause ' +
      'a 401 response, which gracefully dismisses autofill UI.',
    enforcement:
      'apiCall() in api.ts includes the VSBT header.  401 responses are caught ' +
      'by the orchestrator and trigger teardownAutofill().',
    implementedIn: ['api.ts', 'autofillOrchestrator.ts'],
    verifiable: true,
    category: 'access_control',
  },

  // ── Logging ──

  {
    id: 'SEC-LOG-01',
    title: 'Audit log is local-only with secret redaction',
    description:
      'All autofill events are logged to an in-memory ring buffer (500 entries). ' +
      'Messages are automatically redacted via redactSecrets() before storage.  ' +
      'The log is never transmitted over the network.  Optional persistence uses ' +
      'chrome.storage.local with 3-chunk rotation.',
    enforcement:
      'auditLog() calls redactSecrets() on every message.  No fetch(), XHR, or ' +
      'WebSocket call exists in hardening.ts.  flushAuditLog() writes only to ' +
      'chrome.storage.local.',
    implementedIn: ['hardening.ts'],
    verifiable: true,
    category: 'logging',
  },
  {
    id: 'SEC-LOG-02',
    title: 'Telemetry contains no sensitive values',
    description:
      'Telemetry events contain only: event type, timestamp, hostname, duration, ' +
      'field counts, error codes.  No passwords, usernames, emails, or field values ' +
      'are included in any telemetry payload.',
    enforcement:
      'TelemetryEvent.payload is typed as Record<string, string | number | boolean>.  ' +
      'All emitTelemetryEvent calls are reviewed for value exclusion.  ' +
      'CommitTelemetryEvent.fields[] contains only kind and errorCode.',
    implementedIn: ['hardening.ts', 'committer.ts'],
    verifiable: true,
    category: 'logging',
  },

  // ── Network ──

  {
    id: 'SEC-NET-01',
    title: 'Zero network calls during autofill rendering',
    description:
      'The overlay preview, QuickSelect dropdown, save bar, and all associated ' +
      'UI rendering is performed entirely locally.  No HTTP requests, WebSocket ' +
      'messages, or extension message passing occurs during UI display.  Network ' +
      'calls occur only for vault API operations (list items, save credential) and ' +
      'are authenticated via VSBT.',
    enforcement:
      'UI modules (overlayManager, quickSelect, saveBar) contain no fetch(), XHR, ' +
      'or chrome.runtime.sendMessage calls.  Vault API calls are confined to ' +
      'vaultIndex.buildIndex() and credentialStore.executeCredentialSave().',
    implementedIn: ['overlayManager.ts', 'quickSelect.ts', 'saveBar.ts', 'vaultIndex.ts', 'credentialStore.ts'],
    verifiable: true,
    category: 'network',
  },
] as const

// ============================================================================
// §2  POSTURE SUMMARY (machine-readable)
// ============================================================================

export interface PostureSummary {
  totalProperties: number
  byCategory: Record<SecurityCategory, number>
  allVerifiable: boolean
  generatedAt: string
}

export function getPostureSummary(): PostureSummary {
  const byCategory: Record<string, number> = {}
  for (const prop of SECURITY_PROPERTIES) {
    byCategory[prop.category] = (byCategory[prop.category] ?? 0) + 1
  }
  return {
    totalProperties: SECURITY_PROPERTIES.length,
    byCategory: byCategory as Record<SecurityCategory, number>,
    allVerifiable: SECURITY_PROPERTIES.every(p => p.verifiable),
    generatedAt: new Date().toISOString(),
  }
}
