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
  classifyFormIntent,
} from './fieldScanner'
export type { ScanResult, ElementScore, FieldMapping, ScanConfig } from './fieldScanner'

// ── Overlay (preview UI) ──
export { showOverlay, hideOverlay, isOverlayVisible, getActiveSessionId, checkMutationGuard, applyTheme, getTokens } from './overlayManager'
export type { UserDecision } from './overlayManager'
export { CSS_TOKENS, buildOverlayCSS, createOverlayStyleSheet } from './overlayStyles'
export type { CSSToken } from './overlayStyles'

// Mutation Guard (C-PIPE-01 defense)
export { attachGuard } from './mutationGuard'
export type { MutationGuardHandle, GuardStatus, GuardViolation } from './mutationGuard'

// ── DOM Fingerprint (tamper detection) ──
export { takeFingerprint, validateFingerprint, captureProperties } from './domFingerprint'

// ── Committer (value injection — via writeBoundary guard) ──
// NOTE: setValueSafely is intentionally NOT re-exported here.
// Only committer.ts (internal) and inlinePopover.ts may import it directly.
// See writeBoundary.ts and scripts/check-write-boundary.sh for enforcement.
export { commitInsert, runSafetyChecks, setTelemetryHook } from './writeBoundary'
export type { SetValueResult, CommitTelemetryEvent } from './writeBoundary'

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
  remapItemDomain,
  findMatchingItemsForDomain,
  detectSubmitButtonSelector,
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

// ── Field Icons (inline input field icons) ──
export {
  syncFieldIcons,
  clearAllFieldIcons,
  getFieldIconCount,
  setFieldIconMatchState,
  setQsoButtonVisible,
  hasVaultMatch,
  setQsoClickHandler,
} from './fieldIcons'
export type { FieldIconHandle, IconClickHandler, QsoClickHandler } from './fieldIcons'

// ── QSO State Machine ──
export {
  QsoMatchStatus,
  QsoAutoMode,
  QsoUiState,
  resolveQsoUiState,
  shouldShowQsoButton,
  shouldAutoSubmit,
} from './qsoState'

// ── Inline Popover (Auto/Manual fill dropdown) ──
export {
  showPopover,
  hidePopover,
  isPopoverVisible,
  fillFieldsFromVaultItem,
  autoSubmitAfterFill,
  loadQsoAutoConsent,
  saveQsoAutoConsentPublic,
} from './inlinePopover'
export type { PopoverOptions, PopoverResult } from './inlinePopover'

// ── Fill Preview (Secure overlay previews for Manual mode) ──
export {
  showFillPreview,
  clearFillPreview,
  isFillPreviewActive,
} from './fillPreview'

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

// ── WebMCP Preview Adapter (leaf module — no reverse dependencies) ──
export { handleWebMcpFillPreviewRequest } from './webMcpAdapter'
export type { WebMcpFillPreviewParams, WebMcpAdapterResult } from './webMcpAdapter'

// ── DataVault PII Autofill (identity/company field detection + fill) ──
export {
  initDataVault,
  processScanForDataVault,
  teardownDataVault,
  handleDvSPANavigation,
  cacheDvCandidates,
} from './dataVaultOrchestrator'

export {
  listDataVaultProfiles,
  getDataVaultProfile,
  buildFieldMap,
  getLastUsedProfileId,
  setLastUsedProfileId,
  isDvDenylisted,
  addToDvDenylist,
  removeFromDvDenylist,
} from './dataVaultAdapter'
export type {
  DataVaultProfileType,
  DataVaultProfileSummary,
  DataVaultProfile,
} from './dataVaultAdapter'

export {
  syncDvFieldIcons,
  clearAllDvIcons,
  getDvIconCount,
  setDvProfileDataAvailable,
  setDvIconMatchData,
} from './dataVaultIcons'

export {
  showDvPopup,
  hideDvPopup,
  isDvPopupVisible,
} from './dataVaultPopup'
export type { DvPopupOptions, DvPopupResult } from './dataVaultPopup'

export {
  fillSingleField as dvFillSingleField,
  fillAllMatchedFields as dvFillAllMatchedFields,
} from './dataVaultFillEngine'
export type {
  FillFieldResult as DvFillFieldResult,
  FillAllResult as DvFillAllResult,
  FillOptions as DvFillOptions,
} from './dataVaultFillEngine'

// ── DataVault Site Learning (per-origin fingerprint→vaultKey persistence) ──
export {
  buildFieldFingerprint,
  lookupLearnedMapping,
  lookupLearnedMappingsBatch,
  saveLearned,
  removeLearned,
  getLearnedMappings,
  clearLearnedMappings,
  fingerprintMatchScore,
  LEARNED_CONFIDENCE_BOOST,
} from './dvSiteLearning'
export type {
  FieldFingerprint,
  LearnedMapping,
} from './dvSiteLearning'

// ── DataVault NLP Booster (optional pluggable interface) ──
export {
  semanticClassify,
  extractTextFeatures,
  registerNlpBackend,
  unregisterNlpBackend,
  setNlpBoosterEnabled,
  isNlpBoosterEnabled,
  NLP_BOOSTER_WEIGHT,
} from './dvNlpBooster'
export type {
  TextFeatures,
  NlpClassifyResult,
  NlpBackend,
} from './dvNlpBooster'

// ── Writes Kill-Switch (global DOM write disable) ──
export {
  areWritesDisabled,
  initWritesKillSwitch,
  setWritesDisabled,
  onWritesDisabledChange,
} from './writesKillSwitch'

// ── QSO (Quick Sign-On) — leaf module for password-manager sign-in ──
export {
  resolveQsoState, executeQsoFill,
  QSO_RESULT_VERSION, QSO_STATUSES, QSO_ERROR_CODES,
  isQsoResultV1, buildQsoStateResult, buildQsoFillActionResult,
} from './qso/qsoEngine'
export type {
  QsoState, QsoStatus, QsoCandidate, QsoFillResult, QsoBlockReason,
  QsoErrorCode, QsoActionResult,
} from './qso/qsoEngine'
export { showQsoIcon, hideQsoIcon, isQsoIconVisible, qsoStateToVisual } from './qso/qsoIcon'
export type { QsoIconHandle, QsoIconVisualState } from './qso/qsoIcon'
export { showQsoPicker, hideQsoPicker, isQsoPickerVisible } from './qso/qsoPicker'

// ── Submit Guard (safe form submission after fill) ──
export { resolveSubmitTarget, safeSubmitAfterFill, SUBMIT_BLOCK_REASONS } from './submitGuard'
export type { SubmitSafetyInput, SubmitResult, SubmitBlockReason, SubmitCode } from './submitGuard'

// ── QSO Remap (Add & Map + Remap flows) ──
export { updateRemapState, teardownRemap, getRemapState, forgetMapping } from './qso/remapManager'
export type { RemapState, RemapDetectionResult } from './qso/remapManager'
export { showRemapIcon, hideRemapIcon, isRemapIconVisible } from './qso/remapIcon'
export type { RemapIconMode, RemapIconHandle } from './qso/remapIcon'
export { showMappingWizard, hideMappingWizard, isMappingWizardVisible } from './qso/mappingWizard'
export type { WizardResult, WizardHandle } from './qso/mappingWizard'
export {
  saveMapping, loadMapping, deleteMapping,
  createCredentialFromPageInput, findCredentialsForOrigin,
} from './qso/mappingStore'
export type { OriginCredential } from './qso/mappingStore'
export {
  buildSelector, buildSignature, buildElementMapping,
  validateMapping, effectiveOrigin, scoreSignatureMatch,
} from './qso/selectorStrategy'
export type {
  ElementMapping, ElementSignature, LoginFormMapping,
  MappingValidationResult, ElementResolution,
} from './qso/selectorStrategy'
