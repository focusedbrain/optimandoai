/**
 * WRVault — High Assurance Mode (HA Mode)
 * =========================================
 *
 * HA Mode is a security profile that sits ABOVE the tier configuration
 * system.  When active, it overrides every subsystem with the most
 * restrictive settings.  It is designed for environments where security
 * is paramount and convenience trade-offs are unacceptable (regulated
 * industries, classified workloads, enterprise compliance).
 *
 * HA Mode is NOT just "enterprise config".  It is a separate enforcement
 * layer that:
 *
 *   1. Cannot be weakened by tier config overrides.
 *   2. Cannot be silently disabled — requires explicit multi-step deactivation.
 *   3. Defaults to ON if the stored state is missing or corrupted (fail-closed).
 *   4. Logs every enforcement decision to the local audit log.
 *
 * ┌──────────────────────────────────────────────────────────┐
 * │                  HA Mode Enforcement                     │
 * ├──────────────────────────────────────────────────────────┤
 * │  • Overlay mandatory — no silent insert                  │
 * │  • No auto-save — credential capture requires consent    │
 * │  • Strict origin matching — exact scheme+host+port       │
 * │  • Mutation guard required — abort on DOM tampering      │
 * │  • All insert attempts logged locally                    │
 * │  • Proxy endpoints disabled — no generic API forwarding  │
 * │  • IPC restricted to minimal allowlist                   │
 * │  • Network interception disabled                         │
 * │  • Domain trust toggle hidden                            │
 * │  • Public suffix domains blocked                         │
 * │  • Clipboard cleared aggressively (5s)                   │
 * │  • Session timeout shortened (30s)                       │
 * │  • QuickSelect hides cross-domain by default             │
 * └──────────────────────────────────────────────────────────┘
 *
 * ZERO external dependencies.  Import from any runtime.
 */

// ============================================================================
// §1  HA Configuration Schema
// ============================================================================

/**
 * The immutable set of rules enforced when HA Mode is active.
 * Every field is readonly — these values cannot be overridden.
 */
export interface HAConfig {
  // ── Identity ──
  /** Whether HA mode is active. */
  readonly active: boolean

  // ── Overlay / Consent ──
  /** Overlay is mandatory for every insert. No silent/auto-insert. */
  readonly overlayMandatory: true
  /** Auto-insert is never allowed. */
  readonly autoInsertBlocked: true
  /** Session timeout (ms) — shortened for HA. */
  readonly sessionTimeoutMs: number
  /** Domain trust toggle is hidden. */
  readonly trustDomainToggleHidden: true

  // ── Save Password ──
  /** Auto-save is disabled — no automatic credential capture. */
  readonly autoSaveBlocked: true
  /** Network interception (fetch/XHR hooking) is disabled. */
  readonly networkInterceptionBlocked: true

  // ── Origin Matching ──
  /** Strict origin matching (scheme+host+port) only. */
  readonly strictOriginOnly: true
  /** Public suffix domains are blocked entirely. */
  readonly publicSuffixBlocked: true
  /** QuickSelect cross-domain expansion requires explicit action. */
  readonly crossDomainBlocked: true

  // ── Pipeline Integrity ──
  /** Mutation guard is required for every overlay session. */
  readonly mutationGuardRequired: true
  /** All insert attempts are logged to local audit. */
  readonly allInsertsLogged: true
  /** Strict safe mode is always active. */
  readonly strictSafeModeForced: true

  // ── IPC / Proxy ──
  /** Generic proxy endpoints are disabled. */
  readonly proxyEndpointsDisabled: true
  /** IPC channels restricted to minimal allowlist. */
  readonly ipcRestricted: true

  // ── Clipboard ──
  /** Clipboard auto-clear delay (ms) — aggressive. */
  readonly clipboardClearMs: number

  // ── Logging ──
  /** Audit log is always persisted. */
  readonly persistAuditLog: true
  /** All security events are logged regardless of other settings. */
  readonly alwaysLogSecurity: true
}

/**
 * The canonical HA Mode configuration.  Frozen and immutable.
 */
export const HA_CONFIG: Readonly<HAConfig> = Object.freeze({
  active: true,

  // Overlay / Consent
  overlayMandatory: true as const,
  autoInsertBlocked: true as const,
  sessionTimeoutMs: 30_000,               // 30 seconds
  trustDomainToggleHidden: true as const,

  // Save Password
  autoSaveBlocked: true as const,
  networkInterceptionBlocked: true as const,

  // Origin Matching
  strictOriginOnly: true as const,
  publicSuffixBlocked: true as const,
  crossDomainBlocked: true as const,

  // Pipeline Integrity
  mutationGuardRequired: true as const,
  allInsertsLogged: true as const,
  strictSafeModeForced: true as const,

  // IPC / Proxy
  proxyEndpointsDisabled: true as const,
  ipcRestricted: true as const,

  // Clipboard
  clipboardClearMs: 5_000,               // 5 seconds

  // Logging
  persistAuditLog: true as const,
  alwaysLogSecurity: true as const,
})

// ============================================================================
// §2  HA State Machine
// ============================================================================

/**
 * HA Mode lifecycle states:
 *
 *   ┌──────┐   activate()    ┌────────┐   lock()   ┌────────┐
 *   │ OFF  │ ───────────────→│ ACTIVE │ ──────────→│ LOCKED │
 *   └──────┘                 └────────┘            └────────┘
 *       ↑                        │                      │
 *       │    deactivate()        │                      │
 *       │  (requires confirm)    │                      │
 *       └────────────────────────┘                      │
 *                                                       │
 *       ↑              unlock(confirmCode)              │
 *       └───────────────────────────────────────────────┘
 *
 *   - `off`:     HA mode is not active.  Normal operation.
 *   - `active`:  HA mode is enforced.  Can be deactivated with confirmation.
 *   - `locked`:  HA mode is enforced AND cannot be deactivated without
 *                an administrator-provided unlock code.  Used for
 *                enterprise-managed deployments.
 */
export type HAState = 'off' | 'active' | 'locked'

/**
 * Persistent HA mode state stored in vault settings.
 */
export interface HAModeState {
  /** Current HA state. */
  state: HAState
  /** Timestamp when HA was activated (ms since epoch). */
  activatedAt: number | null
  /** Who activated HA mode (user ID or 'admin' for managed). */
  activatedBy: string | null
  /**
   * SHA-256 hash of the admin unlock code (hex).
   * Only set when state === 'locked'.
   * The unlock code itself is NEVER stored.
   */
  lockCodeHash: string | null
  /** Number of consecutive failed unlock attempts. */
  failedUnlockAttempts: number
  /** Timestamp of last failed unlock attempt. */
  lastFailedUnlockAt: number | null
}

/**
 * Default HA state — used when settings are missing or corrupted.
 *
 * CRITICAL: Defaults to 'active' (fail-closed).
 * If we cannot determine whether HA is supposed to be on, we assume it is.
 */
export const DEFAULT_HA_STATE: Readonly<HAModeState> = Object.freeze({
  state: 'active',
  activatedAt: null,
  activatedBy: null,
  lockCodeHash: null,
  failedUnlockAttempts: 0,
  lastFailedUnlockAt: null,
})

/**
 * An explicitly-off HA state — used when initializing a NEW vault.
 * Existing vaults that are missing the HA field get DEFAULT_HA_STATE (active).
 */
export const INITIAL_HA_STATE_OFF: Readonly<HAModeState> = Object.freeze({
  state: 'off',
  activatedAt: null,
  activatedBy: null,
  lockCodeHash: null,
  failedUnlockAttempts: 0,
  lastFailedUnlockAt: null,
})

// ============================================================================
// §3  State Queries
// ============================================================================

/** Whether HA mode is currently enforced (active or locked). */
export function isHAActive(haState: HAModeState | null | undefined): boolean {
  if (!haState) return true  // Fail-closed: missing state → HA is ON
  return haState.state === 'active' || haState.state === 'locked'
}

/** Whether HA mode is locked (cannot be deactivated without code). */
export function isHALocked(haState: HAModeState | null | undefined): boolean {
  if (!haState) return false  // Missing state → active but not locked
  return haState.state === 'locked'
}

/** Whether HA can be deactivated (active but not locked). */
export function canDeactivateHA(haState: HAModeState | null | undefined): boolean {
  if (!haState) return false
  return haState.state === 'active'
}

// ============================================================================
// §4  State Transitions
// ============================================================================

/** Result of an HA state transition attempt. */
export interface HATransitionResult {
  success: boolean
  newState: HAModeState
  error?: string
}

/** Maximum consecutive failed unlock attempts before lockout. */
const MAX_FAILED_UNLOCKS = 5
/** Lockout duration after max failed attempts (ms). */
const UNLOCK_LOCKOUT_MS = 300_000 // 5 minutes

/**
 * Activate HA mode.
 *
 * Can only be called when state is 'off'.
 */
export function activateHA(
  current: HAModeState,
  activatedBy: string,
): HATransitionResult {
  if (current.state !== 'off') {
    return { success: false, newState: current, error: 'HA mode is already active' }
  }
  return {
    success: true,
    newState: {
      state: 'active',
      activatedAt: Date.now(),
      activatedBy,
      lockCodeHash: null,
      failedUnlockAttempts: 0,
      lastFailedUnlockAt: null,
    },
  }
}

/**
 * Deactivate HA mode.
 *
 * Only allowed when state is 'active' (not 'locked').
 * Requires a confirmation string to prevent accidental deactivation.
 */
export function deactivateHA(
  current: HAModeState,
  confirmPhrase: string,
): HATransitionResult {
  if (current.state === 'off') {
    return { success: false, newState: current, error: 'HA mode is not active' }
  }
  if (current.state === 'locked') {
    return { success: false, newState: current, error: 'HA mode is locked — unlock first' }
  }
  if (confirmPhrase !== 'DISABLE HIGH ASSURANCE') {
    return {
      success: false,
      newState: current,
      error: 'Confirmation phrase does not match.  Type exactly: DISABLE HIGH ASSURANCE',
    }
  }
  return {
    success: true,
    newState: { ...INITIAL_HA_STATE_OFF },
  }
}

/**
 * Lock HA mode with an administrator code.
 *
 * Once locked, HA cannot be deactivated without the unlock code.
 * The code itself is not stored — only its SHA-256 hash.
 *
 * @param lockCodeHash — SHA-256 hex hash of the admin unlock code
 *                        (the caller is responsible for hashing).
 */
export function lockHA(
  current: HAModeState,
  lockCodeHash: string,
): HATransitionResult {
  if (current.state !== 'active') {
    return { success: false, newState: current, error: 'HA mode must be active to lock' }
  }
  if (!lockCodeHash || lockCodeHash.length < 64) {
    return { success: false, newState: current, error: 'Invalid lock code hash' }
  }
  return {
    success: true,
    newState: {
      ...current,
      state: 'locked',
      lockCodeHash,
      failedUnlockAttempts: 0,
      lastFailedUnlockAt: null,
    },
  }
}

/**
 * Unlock HA mode (transition from 'locked' to 'active').
 *
 * Compares the provided code hash against the stored hash.
 * Enforces rate limiting on failed attempts.
 *
 * @param codeHash — SHA-256 hex hash of the attempted unlock code
 */
export function unlockHA(
  current: HAModeState,
  codeHash: string,
): HATransitionResult {
  if (current.state !== 'locked') {
    return { success: false, newState: current, error: 'HA mode is not locked' }
  }

  // Rate limiting
  if (current.failedUnlockAttempts >= MAX_FAILED_UNLOCKS) {
    const elapsed = Date.now() - (current.lastFailedUnlockAt ?? 0)
    if (elapsed < UNLOCK_LOCKOUT_MS) {
      const remainingSec = Math.ceil((UNLOCK_LOCKOUT_MS - elapsed) / 1000)
      return {
        success: false,
        newState: current,
        error: `Too many failed attempts.  Try again in ${remainingSec}s.`,
      }
    }
    // Lockout expired — reset counter
  }

  if (codeHash !== current.lockCodeHash) {
    return {
      success: false,
      newState: {
        ...current,
        failedUnlockAttempts: current.failedUnlockAttempts + 1,
        lastFailedUnlockAt: Date.now(),
      },
      error: 'Invalid unlock code',
    }
  }

  return {
    success: true,
    newState: {
      ...current,
      state: 'active',
      lockCodeHash: null,
      failedUnlockAttempts: 0,
      lastFailedUnlockAt: null,
    },
  }
}

// ============================================================================
// §5  Enforcement Helpers
// ============================================================================

/**
 * Actions that HA mode can gate.
 * Every subsystem checks this before proceeding.
 */
export type HAGatedAction =
  | 'silent_insert'         // Auto-insert without overlay
  | 'auto_save'             // Automatic credential capture
  | 'network_intercept'     // Fetch/XHR hooking
  | 'cross_domain_expand'   // QuickSelect showing other domains
  | 'trust_domain'          // "Always allow on this domain" toggle
  | 'proxy_endpoint'        // Generic API proxy
  | 'unrestricted_ipc'      // Arbitrary IPC channel invocation
  | 'skip_mutation_guard'   // Insert without mutation guard
  | 'skip_overlay'          // Insert without overlay preview
  | 'public_suffix_insert'  // Insert on public suffix domain

/**
 * Check whether a specific action is allowed under the current HA state.
 *
 * When HA is active, ALL gated actions are blocked.
 * When HA is off, all actions are allowed (deferred to tier config).
 *
 * @returns `true` if the action is ALLOWED, `false` if BLOCKED.
 */
export function haAllows(
  haState: HAModeState | null | undefined,
  action: HAGatedAction,
): boolean {
  // HA active → block everything in the gated set
  if (isHAActive(haState)) return false
  // HA off → allow (defer to tier config / toggle system)
  return true
}

/**
 * Build a human-readable denial reason for audit logging.
 */
export function haDenyReason(action: HAGatedAction): string {
  const REASONS: Record<HAGatedAction, string> = {
    silent_insert:        'HA Mode: silent insert is not permitted — overlay consent required',
    auto_save:            'HA Mode: automatic credential save is not permitted — user must initiate',
    network_intercept:    'HA Mode: network interception (fetch/XHR) is disabled',
    cross_domain_expand:  'HA Mode: cross-domain credential listing is restricted',
    trust_domain:         'HA Mode: domain trust toggle is disabled',
    proxy_endpoint:       'HA Mode: generic proxy endpoints are disabled',
    unrestricted_ipc:     'HA Mode: IPC is restricted to the minimal allowlist',
    skip_mutation_guard:  'HA Mode: mutation guard is required for every insert',
    skip_overlay:         'HA Mode: overlay preview is required before insert',
    public_suffix_insert: 'HA Mode: insert on public suffix domains is blocked',
  }
  return REASONS[action]
}

// ============================================================================
// §6  IPC Allowlist (HA-restricted channels)
// ============================================================================

/**
 * The minimal set of IPC channels allowed when HA mode restricts IPC.
 * All other channels are rejected at the preload bridge.
 */
export const HA_IPC_ALLOWLIST: readonly string[] = Object.freeze([
  'vault.getStatus',
  'vault.unlock',
  'vault.lock',
  'vault.getItem',
  'vault.listItems',
  'vault.getSettings',
  'vault.getAutofillCandidates',
  'auth:status',
])

/**
 * Check if an IPC channel is allowed under HA restrictions.
 */
export function haAllowsIPC(
  haState: HAModeState | null | undefined,
  channel: string,
): boolean {
  if (!isHAActive(haState)) return true  // HA off → all channels allowed
  return HA_IPC_ALLOWLIST.includes(channel)
}

// ============================================================================
// §7  Tier Config Override (HA → AutofillTierConfig)
// ============================================================================

/**
 * Partial config overrides that HA mode forces onto the tier config.
 * These are applied AFTER `mergeConfig` — HA always wins.
 *
 * This object is typed as a plain record so it can be consumed by
 * `mergeConfig()` in `tierConfig.ts`.
 */
export const HA_TIER_OVERRIDES = Object.freeze({
  // Matching — raise confidence bar
  confidenceThreshold: 0.80,
  // Overlay — mandatory
  autoInsertAllowed: false,
  trustDomainToggleVisible: false,
  sessionTimeoutMs: 30_000,
  clipboardClearMs: 5_000,
  // Save password — consent only
  savePasswordEnabled: false,
  interceptNetworkRequests: false,
  saveBarTimeoutMs: 0,
  // Hardening — max
  strictSafeMode: true,
  blockPublicSuffix: true,
  opacityCheckDepth: 5,
  coverCheckEnabled: true,
  // Logging — full audit
  persistAuditLog: true,
  alwaysLogSecurity: true,
} as const)

// ============================================================================
// §8  Verification Checklist
// ============================================================================

/**
 * Runtime verification: check that every HA invariant holds.
 *
 * Call this after applying HA overrides to confirm enforcement.
 * Returns a list of violations (empty = all OK).
 *
 * This is a defense-in-depth check — if any subsystem accidentally
 * weakened a setting, this will catch it.
 */
export interface HAVerificationItem {
  id: string
  label: string
  pass: boolean
  detail: string
}

export function verifyHAEnforcement(
  haState: HAModeState | null | undefined,
  effectiveConfig: {
    autoInsertAllowed?: boolean
    trustDomainToggleVisible?: boolean
    savePasswordEnabled?: boolean
    interceptNetworkRequests?: boolean
    strictSafeMode?: boolean
    blockPublicSuffix?: boolean
    persistAuditLog?: boolean
    clipboardClearMs?: number
    sessionTimeoutMs?: number
  },
): HAVerificationItem[] {
  if (!isHAActive(haState)) return []

  const items: HAVerificationItem[] = [
    {
      id: 'HA-01',
      label: 'Overlay mandatory',
      pass: effectiveConfig.autoInsertAllowed === false,
      detail: 'autoInsertAllowed must be false',
    },
    {
      id: 'HA-02',
      label: 'No silent insert',
      pass: effectiveConfig.strictSafeMode === true,
      detail: 'strictSafeMode must be true',
    },
    {
      id: 'HA-03',
      label: 'No auto-save',
      pass: effectiveConfig.savePasswordEnabled === false,
      detail: 'savePasswordEnabled must be false',
    },
    {
      id: 'HA-04',
      label: 'No network interception',
      pass: effectiveConfig.interceptNetworkRequests === false,
      detail: 'interceptNetworkRequests must be false',
    },
    {
      id: 'HA-05',
      label: 'Domain trust hidden',
      pass: effectiveConfig.trustDomainToggleVisible === false,
      detail: 'trustDomainToggleVisible must be false',
    },
    {
      id: 'HA-06',
      label: 'Public suffix blocked',
      pass: effectiveConfig.blockPublicSuffix === true,
      detail: 'blockPublicSuffix must be true',
    },
    {
      id: 'HA-07',
      label: 'Audit log persisted',
      pass: effectiveConfig.persistAuditLog === true,
      detail: 'persistAuditLog must be true',
    },
    {
      id: 'HA-08',
      label: 'Clipboard clear <= 5s',
      pass: (effectiveConfig.clipboardClearMs ?? Infinity) <= 5_000,
      detail: 'clipboardClearMs must be <= 5000',
    },
    {
      id: 'HA-09',
      label: 'Session timeout <= 30s',
      pass: (effectiveConfig.sessionTimeoutMs ?? Infinity) <= 30_000,
      detail: 'sessionTimeoutMs must be <= 30000',
    },
  ]

  return items
}
