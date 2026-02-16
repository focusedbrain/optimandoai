// ============================================================================
// WRVault Autofill — Public API Barrel
// ============================================================================

// ── Pipeline Orchestrator (top-level init/teardown) ──
export { initAutofill, teardownAutofill, forceScan, getLastScan, openQuickSelectForElement } from './autofillOrchestrator'

// ── Toggle Sync (vault settings ↔ content script) ──
export {
  initContentToggleSync,
  getToggles,
  getEffectiveToggles,
  isAutofillActive,
  onToggleChange,
  syncTogglesFromVault,
  pushToggleUpdate,
  markVaultLocked,
  handleToggleRequest,
  MSG_TOGGLES_CHANGED,
  MSG_TOGGLES_REQUEST,
  MSG_VAULT_LOCK_STATE,
  DEFAULT_TOGGLE_STATE,
} from './toggleSync'
export type { AutofillToggleState, ToggleSyncMessage } from './toggleSync'

// ── Field Scanner (matching engine) ──
export {
  collectCandidates,
  scoreCandidate,
  pickBestMapping,
  invalidateScanCache,
  startWatching,
  stopWatching,
} from './fieldScanner'
export type { ScanResult, ElementScore, FieldMapping, ScanConfig } from './fieldScanner'

// ── Overlay (preview UI) ──
export { showOverlay, hideOverlay, isOverlayVisible, checkMutationGuard, applyTheme, getTokens } from './overlayManager'
export type { UserDecision } from './overlayManager'
export { CSS_TOKENS, buildOverlayCSS, createOverlayStyleSheet } from './overlayStyles'
export type { CSSToken } from './overlayStyles'

// Mutation Guard (C-PIPE-01 defense)
export { attachGuard } from './mutationGuard'
export type { MutationGuardHandle, GuardStatus, GuardViolation } from './mutationGuard'

// ── DOM Fingerprint (tamper detection) ──
export { takeFingerprint, validateFingerprint, captureProperties } from './domFingerprint'

// ── Committer (value injection) ──
export { commitInsert, setValueSafely, runSafetyChecks, setTelemetryHook } from './committer'
export type { SetValueResult, CommitTelemetryEvent } from './committer'

// ── Submit Watcher (credential capture) ──
export { startSubmitWatcher, stopSubmitWatcher, onCredentialSubmit, SAVE_BAR_TIMEOUT_MS } from './submitWatcher'

// ── Save Bar (disk icon + store dialog) ──
export { showSaveBar, hideSaveBar, isSaveBarVisible } from './saveBar'
export type { SaveDecision, ExistingMatch, SaveBarOptions } from './saveBar'

// ── Credential Store (vault handoff + duplicate detection) ──
export {
  findExistingCredentials,
  executeCredentialSave,
  isNeverSaveDomain,
  addToNeverSaveList,
  removeFromNeverSaveList,
} from './credentialStore'
export type { CredentialSaveResult } from './credentialStore'

// ── QuickSelect (manual vault search dropdown) ──
export {
  quickSelectOpen,
  quickSelectClose,
  quickSelectIsOpen,
  showTriggerIcon,
  hideTriggerIcon,
  registerShortcut,
  unregisterShortcut,
} from './quickSelect'
export type { QuickSelectResult, QuickSelectOptions } from './quickSelect'

// ── Vault Index (in-memory search for QuickSelect) ──
export {
  buildIndex,
  searchIndex,
  searchIndexFiltered,
  hasOriginMatches,
  hasEntries,
  clearIndex,
  invalidateIndex,
  indexSize,
  isIndexStale,
} from './vaultIndex'
export type { IndexEntry, SearchResult } from './vaultIndex'

// ── Hardening (error resistance, safe-mode, audit log, telemetry) ──
export {
  // Failure modes
  FAILURE_MODES,
  // Error codes + user messages
  ERROR_MESSAGES,
  getUserMessage,
  // Safe-mode policy
  evaluateSafeMode,
  // Element guards
  guardElement,
  // SPA navigation watcher
  startSPAWatcher,
  stopSPAWatcher,
  // Multi-account / subdomain
  isPublicSuffixDomain,
  domainRelated,
  countDomainMatches,
  // Data minimization
  redactSecrets,
  redactError,
  maskValue,
  // Audit log
  auditLog,
  onAuditEvent,
  getAuditLog,
  clearAuditLog,
  flushAuditLog,
  // Telemetry
  emitTelemetryEvent,
  onTelemetryEvent,
  getTelemetryLog,
  clearTelemetry,
} from './hardening'
export type {
  FailureMode,
  FailureCategory,
  HardenedErrorCode,
  SafeModeDecision,
  SafeModeReason,
  ElementGuardResult,
  AuditLevel,
  AuditEntry,
  TelemetryEvent,
  TelemetryEventType,
} from './hardening'

// ── High Assurance Mode Guard (content script enforcement) ──
export {
  isHAEnforced,
  getHAConfig,
  getHAState,
  haCheck,
  haCheckSilent,
  initHASync,
  updateHAState,
  onHAChange,
  handleHARequest,
  MSG_HA_STATE_CHANGED,
  MSG_HA_STATE_REQUEST,
} from './haGuard'

// ── UX Microcopy (centralized strings) ──
export { OVERLAY, QUICK_SELECT, SAVE_BAR, ERRORS, SETTINGS, CONSENT_EXPLAINER } from './microcopy'

// ── Security Posture (audit + compliance) ──
export { SECURITY_PROPERTIES, getPostureSummary } from './securityPosture'
export type { SecurityProperty, SecurityCategory, PostureSummary } from './securityPosture'

// ── Tier Configuration (consumer / pro / enterprise) ──
export {
  getConfigForTier,
  mergeConfig,
  diffConfig,
  tierToBand,
  CONSUMER_CONFIG,
  PRO_CONFIG,
  ENTERPRISE_CONFIG,
  TIER_CONFIGS,
} from './tierConfig'
export type { AutofillTierConfig, TierBand, AutofillConfigOverrides, ConfigDiff } from './tierConfig'

// ── Module Manifest (architecture + refactor plan) ──
export {
  MODULE_MANIFEST,
  IMPORT_RULES,
  REFACTOR_PHASES,
  validateDependencies,
  getRefactorTargets,
} from './moduleManifest'
export type { ModuleDescriptor, ModuleId, ModuleLayer, ImportRule, RefactorPhase } from './moduleManifest'
