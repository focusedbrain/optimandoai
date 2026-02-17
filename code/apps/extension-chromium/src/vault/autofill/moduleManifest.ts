// ============================================================================
// WRVault Autofill — Module Manifest & Refactor Plan
// ============================================================================
//
// This file defines the canonical module structure for the autofill pipeline.
// It serves as:
//   - An architectural map for developers
//   - A dependency graph enforcer (import lint rules can reference this)
//   - A refactor roadmap showing current → target state for each module
//
// ============================================================================

// ============================================================================
// §1  MODULE CATALOGUE
// ============================================================================

export interface ModuleDescriptor {
  /** Unique module identifier matching the filename (without .ts). */
  id: ModuleId
  /** Human-readable name. */
  name: string
  /** One-line responsibility statement.  If it can't fit in one line, split the module. */
  responsibility: string
  /** Primary exports (public API surface). */
  publicApi: string[]
  /** Modules this module imports from (direct dependencies). */
  dependsOn: ModuleId[]
  /** Which concern layer this module belongs to. */
  layer: ModuleLayer
  /** Current status. */
  status: 'stable' | 'needs_refactor' | 'new'
  /** Refactor notes (empty if stable). */
  refactorNotes: string
}

export type ModuleId =
  | 'fieldScanner'
  | 'overlayManager'
  | 'overlayStyles'
  | 'committer'
  | 'domFingerprint'
  | 'submitWatcher'
  | 'saveBar'
  | 'credentialStore'
  | 'quickSelect'
  | 'vaultIndex'
  | 'toggleSync'
  | 'hardening'
  | 'autofillOrchestrator'
  | 'microcopy'
  | 'securityPosture'
  | 'tierConfig'
  | 'index'

/**
 * Layer hierarchy (lower layers must not import from higher layers):
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  L4  ORCHESTRATOR          autofillOrchestrator             │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │  L3  FEATURE MODULES                                        │
 *   │       ┌──────────┐ ┌────────────┐ ┌──────────┐ ┌─────────┐│
 *   │       │ overlay   │ │ save-cred  │ │quickinsert│ │settings ││
 *   │       │ Manager   │ │  saveBar   │ │quickSelect│ │toggleSync││
 *   │       │ Styles    │ │credStore   │ │vaultIndex │ │tierConf ││
 *   │       └──────────┘ │submitWatch │ └──────────┘ └─────────┘│
 *   │                     └────────────┘                          │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │  L2  CORE PIPELINE                                          │
 *   │       ┌──────────┐ ┌──────────┐ ┌──────────────┐           │
 *   │       │  matcher  │ │ committer│ │ fingerprint  │           │
 *   │       │fieldScan  │ │          │ │ domFingerpr  │           │
 *   │       └──────────┘ └──────────┘ └──────────────┘           │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │  L1  FOUNDATION                                              │
 *   │       ┌──────────┐ ┌──────────┐ ┌──────────────┐           │
 *   │       │hardening │ │microcopy │ │securityPosture│           │
 *   │       └──────────┘ └──────────┘ └──────────────┘           │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │  L0  SHARED (packages/shared)                                │
 *   │       fieldTaxonomy, vaultCapabilities                       │
 *   └─────────────────────────────────────────────────────────────┘
 */
export type ModuleLayer =
  | 'L0_shared'
  | 'L1_foundation'
  | 'L2_core'
  | 'L3_feature'
  | 'L4_orchestrator'
  | 'barrel'

// ============================================================================
// §2  MODULE DEFINITIONS
// ============================================================================

export const MODULE_MANIFEST: readonly ModuleDescriptor[] = [

  // ── L1: Foundation ──

  {
    id: 'hardening',
    name: 'Hardening & Guards',
    responsibility:
      'Failure mode catalogue, error codes, safe-mode policy, element guards, ' +
      'SPA watcher, domain matching, data minimization, audit log, telemetry.',
    publicApi: [
      'FAILURE_MODES', 'ERROR_MESSAGES', 'getUserMessage',
      'evaluateSafeMode', 'guardElement',
      'startSPAWatcher', 'stopSPAWatcher',
      'isPublicSuffixDomain', 'domainRelated', 'countDomainMatches',
      'redactSecrets', 'redactError', 'maskValue',
      'auditLog', 'onAuditEvent', 'getAuditLog', 'clearAuditLog', 'flushAuditLog',
      'emitTelemetryEvent', 'onTelemetryEvent', 'getTelemetryLog', 'clearTelemetry',
    ],
    dependsOn: [],
    layer: 'L1_foundation',
    status: 'needs_refactor',
    refactorNotes:
      'This module is too large (~700 LOC) and bundles three distinct concerns: ' +
      'guards/safe-mode, audit logging, and telemetry.  Target: split into ' +
      'hardening/guards.ts, hardening/auditLog.ts, hardening/telemetry.ts ' +
      'with a hardening/index.ts barrel.  The public API stays the same.',
  },
  {
    id: 'microcopy',
    name: 'UX Microcopy',
    responsibility: 'All user-facing strings for autofill surfaces.',
    publicApi: ['OVERLAY', 'QUICK_SELECT', 'SAVE_BAR', 'ERRORS', 'SETTINGS', 'CONSENT_EXPLAINER'],
    dependsOn: [],
    layer: 'L1_foundation',
    status: 'new',
    refactorNotes: '',
  },
  {
    id: 'securityPosture',
    name: 'Security Posture',
    responsibility: 'Factual security property catalogue for audit and compliance.',
    publicApi: ['SECURITY_PROPERTIES', 'getPostureSummary'],
    dependsOn: [],
    layer: 'L1_foundation',
    status: 'new',
    refactorNotes: '',
  },

  // ── L2: Core Pipeline ──

  {
    id: 'domFingerprint',
    name: 'DOM Fingerprint',
    responsibility: 'Capture and validate structural fingerprints of DOM elements for tamper detection.',
    publicApi: ['takeFingerprint', 'validateFingerprint', 'captureProperties'],
    dependsOn: [],
    layer: 'L2_core',
    status: 'stable',
    refactorNotes: '',
  },
  {
    id: 'fieldScanner',
    name: 'Matcher Module',
    responsibility:
      'Scan DOM for autofill candidate fields, score them against the field taxonomy, ' +
      'and produce ranked mappings.  Owns MutationObserver, caching, and throttling.',
    publicApi: [
      'collectCandidates', 'scoreCandidate', 'pickBestMapping',
      'invalidateScanCache', 'startWatching', 'stopWatching',
    ],
    dependsOn: ['hardening'],
    layer: 'L2_core',
    status: 'needs_refactor',
    refactorNotes:
      'Extract inline label/keyword constants into a separate signals.ts. ' +
      'Move MutationObserver lifecycle into the orchestrator to simplify testability.  ' +
      'Replace getFieldLabel()/getFieldIcon() with imports from microcopy.ts. ' +
      'Accept AutofillTierConfig.maxScanElements and confidenceThreshold as params.',
  },
  {
    id: 'committer',
    name: 'Commit Module',
    responsibility:
      'Atomic value injection into DOM elements.  Multi-strategy cascade (native setter, ' +
      'direct assignment, setAttribute+override).  Safety checks, fingerprint re-validation, ' +
      'retry on framework overwrite.',
    publicApi: ['commitInsert', 'runSafetyChecks', 'setTelemetryHook'],
    // setValueSafely is intentionally NOT public. Access restricted via writeBoundary.ts.
    dependsOn: ['domFingerprint', 'hardening'],
    layer: 'L2_core',
    status: 'needs_refactor',
    refactorNotes:
      'Extract safety check suite into a standalone safetyChecks.ts for independent testing.  ' +
      'Accept session timeout from AutofillTierConfig.sessionTimeoutMs.  ' +
      'Move tryDirectAssignRetry() inline logic into a named strategy pattern.',
  },

  // ── L3: Feature Modules ──

  // -- Overlay Module --

  {
    id: 'overlayStyles',
    name: 'Overlay Styles',
    responsibility: 'CSS tokens, stylesheet builder for Shadow DOM overlay.',
    publicApi: ['CSS_TOKENS', 'buildOverlayCSS', 'createOverlayStyleSheet'],
    dependsOn: [],
    layer: 'L3_feature',
    status: 'stable',
    refactorNotes: '',
  },
  {
    id: 'overlayManager',
    name: 'Overlay Module',
    responsibility:
      'Preview overlay UI: create Shadow DOM host, render field list, handle user decisions ' +
      '(Insert/Cancel), keyboard accessibility, dynamic positioning, session expiry.',
    publicApi: ['showOverlay', 'hideOverlay', 'isOverlayVisible', 'applyTheme', 'getTokens'],
    dependsOn: ['overlayStyles', 'hardening', 'microcopy'],
    layer: 'L3_feature',
    status: 'needs_refactor',
    refactorNotes:
      'Replace inline FIELD_ICONS and LABELS with imports from microcopy.ts.  ' +
      'Use CSS_TOKENS from overlayStyles.ts for all color values (some are still inline).  ' +
      'Accept AutofillTierConfig for sessionTimeoutMs, clipboardClearMs, trustDomainToggleVisible.',
  },

  // -- Save-Credential Module --

  {
    id: 'submitWatcher',
    name: 'Submit Watcher',
    responsibility:
      'Detect credential submissions: form submit, fetch/XHR interception, ' +
      'history.pushState.  Extract username + password.  False positive filtering.',
    publicApi: ['startSubmitWatcher', 'stopSubmitWatcher', 'onCredentialSubmit', 'SAVE_BAR_TIMEOUT_MS'],
    dependsOn: ['hardening'],
    layer: 'L3_feature',
    status: 'needs_refactor',
    refactorNotes:
      'Make fetch/XHR interception opt-in via AutofillTierConfig.interceptNetworkRequests.  ' +
      'Extract payment form detection heuristics into a shared isPaymentForm() utility.  ' +
      'Add configurable password length thresholds.',
  },
  {
    id: 'saveBar',
    name: 'Save Bar UI',
    responsibility:
      'Two-stage save-password UI: pulsing disk icon → modal dialog.  Shadow DOM.  ' +
      'Duplicate credential display.  User decision (save/update/never/cancel).',
    publicApi: ['showSaveBar', 'hideSaveBar', 'isSaveBarVisible'],
    dependsOn: ['overlayStyles', 'hardening', 'microcopy'],
    layer: 'L3_feature',
    status: 'needs_refactor',
    refactorNotes:
      'Replace inline strings with imports from microcopy.ts.  ' +
      'Accept saveBarTimeoutMs from AutofillTierConfig.',
  },
  {
    id: 'credentialStore',
    name: 'Credential Store',
    responsibility:
      'Secure handoff to vault: find existing credentials, execute save/update, ' +
      'manage "never save" domain blocklist.',
    publicApi: [
      'findExistingCredentials', 'executeCredentialSave',
      'isNeverSaveDomain', 'addToNeverSaveList', 'removeFromNeverSaveList',
    ],
    dependsOn: ['hardening'],
    layer: 'L3_feature',
    status: 'stable',
    refactorNotes: '',
  },

  // -- QuickInsert Module --

  {
    id: 'vaultIndex',
    name: 'Vault Index',
    responsibility:
      'In-memory privacy-conscious search index.  Stores non-sensitive metadata.  ' +
      'Tokenized search with domain/favorite boosts.  Cleared on vault lock.',
    publicApi: ['buildIndex', 'searchIndex', 'clearIndex', 'invalidateIndex', 'indexSize', 'isIndexStale'],
    dependsOn: ['hardening'],
    layer: 'L3_feature',
    status: 'stable',
    refactorNotes: '',
  },
  {
    id: 'quickSelect',
    name: 'QuickInsert Module',
    responsibility:
      'Manual vault entry search dropdown.  Trigger icon, searchable list, ' +
      'keyboard navigation, ARIA combobox pattern.  Shadow DOM.',
    publicApi: [
      'quickSelectOpen', 'quickSelectClose', 'quickSelectIsOpen',
      'showTriggerIcon', 'hideTriggerIcon',
      'registerShortcut', 'unregisterShortcut',
    ],
    dependsOn: ['vaultIndex', 'overlayStyles', 'hardening', 'microcopy'],
    layer: 'L3_feature',
    status: 'needs_refactor',
    refactorNotes:
      'Replace inline aria-label strings with imports from microcopy.ts.  ' +
      'Accept quickSelectMaxResults from AutofillTierConfig.',
  },

  // -- Settings Module --

  {
    id: 'toggleSync',
    name: 'Settings Module',
    responsibility:
      'Synchronize vault settings (autofill toggles) between vault DB, ' +
      'background script, and content script.  Chrome.storage.local cache + messaging.',
    publicApi: [
      'initContentToggleSync', 'getToggles', 'getEffectiveToggles', 'isAutofillActive',
      'onToggleChange', 'syncTogglesFromVault', 'pushToggleUpdate',
      'markVaultLocked', 'handleToggleRequest',
    ],
    dependsOn: [],
    layer: 'L3_feature',
    status: 'stable',
    refactorNotes: '',
  },
  {
    id: 'tierConfig',
    name: 'Tier Configuration',
    responsibility:
      'Consumer/Pro/Enterprise configuration presets.  Tier resolver, override merge, diff utility.',
    publicApi: [
      'getConfigForTier', 'mergeConfig', 'diffConfig', 'tierToBand',
      'CONSUMER_CONFIG', 'PRO_CONFIG', 'ENTERPRISE_CONFIG', 'TIER_CONFIGS',
    ],
    dependsOn: [],
    layer: 'L3_feature',
    status: 'new',
    refactorNotes: '',
  },

  // ── L4: Orchestrator ──

  {
    id: 'autofillOrchestrator',
    name: 'Autofill Orchestrator',
    responsibility:
      'Top-level lifecycle: init → scan → decide (auto-insert vs QuickInsert) → ' +
      'overlay → commit → save.  Wires all modules together.  Owns global state ' +
      '(active session, scan results, shortcut registration).',
    publicApi: ['initAutofill', 'teardownAutofill', 'forceScan', 'getLastScan', 'openQuickSelectForElement'],
    dependsOn: [
      'fieldScanner', 'overlayManager', 'committer', 'domFingerprint',
      'submitWatcher', 'saveBar', 'credentialStore',
      'quickSelect', 'vaultIndex', 'toggleSync', 'tierConfig',
      'hardening', 'microcopy',
    ],
    layer: 'L4_orchestrator',
    status: 'needs_refactor',
    refactorNotes:
      'Resolve AutofillTierConfig at init and pass it down to sub-modules.  ' +
      'Replace scattered magic numbers with config lookups.  ' +
      'Add initAutofill(options: { tier: VaultTier, overrides?: AutofillConfigOverrides }).  ' +
      'Extract SPA handling callback into a named module-private function.  ' +
      'Move save-password orchestration into a private _runSavePipeline() to reduce init() size.',
  },

  // ── Barrel ──

  {
    id: 'index',
    name: 'Public Barrel',
    responsibility: 'Re-exports the public API surface.  No logic.  No state.',
    publicApi: ['(re-exports from all modules)'],
    dependsOn: [
      'autofillOrchestrator', 'toggleSync', 'fieldScanner', 'overlayManager',
      'overlayStyles', 'domFingerprint', 'committer', 'submitWatcher', 'saveBar',
      'credentialStore', 'quickSelect', 'vaultIndex', 'hardening',
      'microcopy', 'securityPosture', 'tierConfig',
    ],
    layer: 'barrel',
    status: 'needs_refactor',
    refactorNotes:
      'Add exports for microcopy, securityPosture, and tierConfig modules.',
  },
]

// ============================================================================
// §3  DEPENDENCY VALIDATION RULES
// ============================================================================

/**
 * Layer import constraints.  Each entry says "modules in layer X may NOT
 * import from modules in layers Y".
 *
 * This can be enforced by an ESLint rule, a custom script, or a CI check.
 */
export const IMPORT_RULES: readonly ImportRule[] = [
  {
    layer: 'L1_foundation',
    mayNotImportFrom: ['L2_core', 'L3_feature', 'L4_orchestrator'],
    reason: 'Foundation modules must be dependency-free (except L0 shared).',
  },
  {
    layer: 'L2_core',
    mayNotImportFrom: ['L3_feature', 'L4_orchestrator'],
    reason: 'Core pipeline must not depend on feature UI or orchestration.',
  },
  {
    layer: 'L3_feature',
    mayNotImportFrom: ['L4_orchestrator'],
    reason: 'Feature modules must not import from the orchestrator.  ' +
            'Communication uses callbacks and return values, not direct imports.',
  },
]

export interface ImportRule {
  layer: ModuleLayer
  mayNotImportFrom: ModuleLayer[]
  reason: string
}

// ============================================================================
// §4  REFACTOR EXECUTION PLAN
// ============================================================================
//
// Phase 1 — Foundation wiring (no behavior change)
//   1a. Wire microcopy.ts: update overlayManager, quickSelect, saveBar to import
//       OVERLAY, QUICK_SELECT, SAVE_BAR constants instead of inline strings.
//   1b. Wire tierConfig.ts: update autofillOrchestrator.initAutofill() to accept
//       { tier: VaultTier } and resolve config.  Pass config down.
//   1c. Update index.ts barrel with new module exports.
//
// Phase 2 — Hardening decomposition
//   2a. Extract hardening/guards.ts (guardElement, evaluateSafeMode, domain utils).
//   2b. Extract hardening/auditLog.ts (ring buffer, flush, listeners).
//   2c. Extract hardening/telemetry.ts (ring buffer, event types, listeners).
//   2d. Create hardening/index.ts barrel that re-exports everything.
//   2e. Verify all imports resolve.  No public API change.
//
// Phase 3 — Core pipeline cleanup
//   3a. Extract committer/safetyChecks.ts from committer.ts.
//   3b. Parameterize fieldScanner with maxScanElements, confidenceThreshold.
//   3c. Parameterize committer with sessionTimeoutMs.
//   3d. Move MutationObserver lifecycle from fieldScanner to orchestrator.
//
// Phase 4 — Feature module polish
//   4a. Parameterize overlayManager with sessionTimeoutMs, clipboardClearMs,
//       trustDomainToggleVisible from tier config.
//   4b. Parameterize submitWatcher with interceptNetworkRequests.
//   4c. Parameterize quickSelect with quickSelectMaxResults.
//   4d. Parameterize saveBar with saveBarTimeoutMs.
//
// Phase 5 — Orchestrator finalization
//   5a. Add initAutofill(options: { tier, overrides? }) signature.
//   5b. Replace all magic numbers with config lookups.
//   5c. Extract _runSavePipeline() from initAutofill().
//   5d. Extract _handleSPANavigation() as a named private function.
//   5e. Full integration test with all three tier profiles.
//
// ============================================================================

export interface RefactorPhase {
  id: string
  title: string
  steps: string[]
  dependencies: string[]
  breakingChanges: boolean
}

export const REFACTOR_PHASES: readonly RefactorPhase[] = [
  {
    id: 'P1',
    title: 'Foundation wiring',
    steps: [
      'Wire microcopy imports into UI modules',
      'Wire tierConfig into orchestrator',
      'Update barrel exports',
    ],
    dependencies: [],
    breakingChanges: false,
  },
  {
    id: 'P2',
    title: 'Hardening decomposition',
    steps: [
      'Extract hardening/guards.ts',
      'Extract hardening/auditLog.ts',
      'Extract hardening/telemetry.ts',
      'Create hardening/index.ts barrel',
    ],
    dependencies: ['P1'],
    breakingChanges: false,
  },
  {
    id: 'P3',
    title: 'Core pipeline cleanup',
    steps: [
      'Extract committer/safetyChecks.ts',
      'Parameterize fieldScanner',
      'Parameterize committer',
      'Move MutationObserver to orchestrator',
    ],
    dependencies: ['P2'],
    breakingChanges: false,
  },
  {
    id: 'P4',
    title: 'Feature module polish',
    steps: [
      'Parameterize overlayManager',
      'Parameterize submitWatcher',
      'Parameterize quickSelect',
      'Parameterize saveBar',
    ],
    dependencies: ['P3'],
    breakingChanges: false,
  },
  {
    id: 'P5',
    title: 'Orchestrator finalization',
    steps: [
      'New initAutofill signature with tier + overrides',
      'Replace magic numbers with config',
      'Extract save pipeline helper',
      'Extract SPA navigation handler',
      'Integration test all three tiers',
    ],
    dependencies: ['P4'],
    breakingChanges: true,
  },
]

// ============================================================================
// §5  VALIDATION HELPERS
// ============================================================================

/** Check that no module violates the layer import rules. */
export function validateDependencies(): string[] {
  const errors: string[] = []
  const moduleById = new Map(MODULE_MANIFEST.map(m => [m.id, m]))

  for (const mod of MODULE_MANIFEST) {
    const rule = IMPORT_RULES.find(r => r.layer === mod.layer)
    if (!rule) continue

    for (const dep of mod.dependsOn) {
      const depMod = moduleById.get(dep)
      if (!depMod) continue
      if (rule.mayNotImportFrom.includes(depMod.layer)) {
        errors.push(
          `${mod.id} (${mod.layer}) imports ${dep} (${depMod.layer}) — ` +
          `violates rule: ${rule.reason}`,
        )
      }
    }
  }

  return errors
}

/** Return modules that need refactoring, ordered by layer (foundation first). */
export function getRefactorTargets(): ModuleDescriptor[] {
  const layerOrder: ModuleLayer[] = [
    'L1_foundation', 'L2_core', 'L3_feature', 'L4_orchestrator', 'barrel',
  ]
  return MODULE_MANIFEST
    .filter(m => m.status === 'needs_refactor')
    .sort((a, b) => layerOrder.indexOf(a.layer) - layerOrder.indexOf(b.layer))
}
