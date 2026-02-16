// ============================================================================
// WRVault Autofill — Tier Configuration Defaults
// ============================================================================
//
// Three configuration profiles aligned with subscription tiers:
//
//   consumer    — free / private / private_lifetime
//   pro         — pro / publisher / publisher_lifetime
//   enterprise  — enterprise
//
// Each profile sets tuning knobs for the autofill pipeline.  Stricter tiers
// reduce attack surface at the cost of more explicit user interaction.
//
// The orchestrator reads the effective config at init time.
// Settings can be overridden per-vault through VaultSettings.
//
// ZERO external dependencies.  Import from any runtime.
//
// ============================================================================

import type { VaultTier } from '../../../../../packages/shared/src/vault/vaultCapabilities'

// ============================================================================
// §1  CONFIG SHAPE
// ============================================================================

export interface AutofillTierConfig {
  /** Human-readable tier band name. */
  band: TierBand

  // ── Matching ──

  /** Minimum confidence threshold to attempt auto-insert (0.0–1.0). */
  confidenceThreshold: number
  /** Max input elements to scan per page (perf budget). */
  maxScanElements: number
  /** Scan throttle interval in ms. */
  scanThrottleMs: number
  /** Whether form-context boosts (login/signup) are applied. */
  formContextBoostEnabled: boolean

  // ── Overlay / Consent ──

  /** Session timeout before overlay auto-dismisses (ms). */
  sessionTimeoutMs: number
  /** Whether "Always allow on this domain" is visible in the overlay. */
  trustDomainToggleVisible: boolean
  /** Whether auto-insert is ever allowed (false = always show overlay). */
  autoInsertAllowed: boolean
  /** Clipboard auto-clear delay for copied passwords (ms). */
  clipboardClearMs: number

  // ── Save Password ──

  /** Whether the save-password disk icon is enabled. */
  savePasswordEnabled: boolean
  /** Whether fetch/XHR interception is enabled for SPA credential capture. */
  interceptNetworkRequests: boolean
  /** Timeout before the save-password icon auto-dismisses (ms). */
  saveBarTimeoutMs: number

  // ── QuickSelect ──

  /** Whether QuickSelect keyboard shortcut is registered. */
  quickSelectShortcutEnabled: boolean
  /** Max items shown in QuickSelect dropdown. */
  quickSelectMaxResults: number
  /** Whether the trigger icon appears on unmatched fields. */
  triggerIconEnabled: boolean

  // ── Hardening ──

  /** Require explicit safe-mode (no auto-insert when uncertain). */
  strictSafeMode: boolean
  /** Block autofill on public-suffix domains entirely. */
  blockPublicSuffix: boolean
  /** Maximum ancestor depth for opacity chain check. */
  opacityCheckDepth: number
  /** Whether elementFromPoint cover check is enabled. */
  coverCheckEnabled: boolean
  /** Whether SPA watcher is active. */
  spaWatcherEnabled: boolean

  // ── Logging / Audit ──

  /** Max audit log entries kept in-memory. */
  auditLogMaxEntries: number
  /** Max telemetry entries kept in-memory. */
  telemetryMaxEntries: number
  /** Whether audit log is flushed to chrome.storage.local. */
  persistAuditLog: boolean
  /** Whether security-level events are always logged (even if other events are not). */
  alwaysLogSecurity: boolean
}

export type TierBand = 'consumer' | 'pro' | 'enterprise'

// ============================================================================
// §2  CONSUMER DEFAULTS (free / private / private_lifetime)
// ============================================================================

export const CONSUMER_CONFIG: Readonly<AutofillTierConfig> = {
  band: 'consumer',

  // Matching
  confidenceThreshold: 0.55,
  maxScanElements: 80,
  scanThrottleMs: 400,
  formContextBoostEnabled: true,

  // Overlay / Consent
  sessionTimeoutMs: 120_000,         // 2 min
  trustDomainToggleVisible: false,   // hidden for simplicity
  autoInsertAllowed: true,           // auto-insert when safe
  clipboardClearMs: 30_000,

  // Save Password
  savePasswordEnabled: true,
  interceptNetworkRequests: true,
  saveBarTimeoutMs: 60_000,

  // QuickSelect
  quickSelectShortcutEnabled: true,
  quickSelectMaxResults: 8,
  triggerIconEnabled: true,

  // Hardening
  strictSafeMode: false,             // allow auto-insert on high confidence
  blockPublicSuffix: false,          // warn but don't block
  opacityCheckDepth: 3,
  coverCheckEnabled: true,
  spaWatcherEnabled: true,

  // Logging
  auditLogMaxEntries: 200,
  telemetryMaxEntries: 100,
  persistAuditLog: false,
  alwaysLogSecurity: true,
}

// ============================================================================
// §3  PRO DEFAULTS (pro / publisher / publisher_lifetime)
// ============================================================================

export const PRO_CONFIG: Readonly<AutofillTierConfig> = {
  band: 'pro',

  // Matching
  confidenceThreshold: 0.55,
  maxScanElements: 120,
  scanThrottleMs: 300,
  formContextBoostEnabled: true,

  // Overlay / Consent
  sessionTimeoutMs: 120_000,
  trustDomainToggleVisible: true,    // pro users can enable domain trust
  autoInsertAllowed: true,
  clipboardClearMs: 15_000,          // shorter clipboard retention

  // Save Password
  savePasswordEnabled: true,
  interceptNetworkRequests: true,
  saveBarTimeoutMs: 90_000,

  // QuickSelect
  quickSelectShortcutEnabled: true,
  quickSelectMaxResults: 15,
  triggerIconEnabled: true,

  // Hardening
  strictSafeMode: false,
  blockPublicSuffix: false,
  opacityCheckDepth: 4,
  coverCheckEnabled: true,
  spaWatcherEnabled: true,

  // Logging
  auditLogMaxEntries: 500,
  telemetryMaxEntries: 200,
  persistAuditLog: true,             // pro users get persistent audit
  alwaysLogSecurity: true,
}

// ============================================================================
// §4  ENTERPRISE DEFAULTS (enterprise)
// ============================================================================

export const ENTERPRISE_CONFIG: Readonly<AutofillTierConfig> = {
  band: 'enterprise',

  // Matching — tighter threshold, fewer candidates reduces surface area
  confidenceThreshold: 0.70,         // higher bar
  maxScanElements: 100,
  scanThrottleMs: 300,
  formContextBoostEnabled: true,

  // Overlay / Consent — always require explicit overlay consent
  sessionTimeoutMs: 60_000,          // shorter sessions
  trustDomainToggleVisible: false,   // enterprise: no trusting domains
  autoInsertAllowed: false,          // ALWAYS show overlay, never auto-insert
  clipboardClearMs: 10_000,          // aggressive clear

  // Save Password
  savePasswordEnabled: true,
  interceptNetworkRequests: false,   // no fetch/XHR hooking (compliance)
  saveBarTimeoutMs: 30_000,          // shorter save bar

  // QuickSelect
  quickSelectShortcutEnabled: true,
  quickSelectMaxResults: 10,
  triggerIconEnabled: true,

  // Hardening — strictest settings
  strictSafeMode: true,              // always require explicit selection
  blockPublicSuffix: true,           // block autofill on shared hosting
  opacityCheckDepth: 5,              // deeper ancestor chain check
  coverCheckEnabled: true,
  spaWatcherEnabled: true,

  // Logging — full audit trail
  auditLogMaxEntries: 2000,
  telemetryMaxEntries: 1000,
  persistAuditLog: true,
  alwaysLogSecurity: true,
}

// ============================================================================
// §5  TIER → CONFIG RESOLVER
// ============================================================================

/** Map a VaultTier to the appropriate tier band. */
export function tierToBand(tier: VaultTier): TierBand {
  switch (tier) {
    case 'free':
    case 'private':
    case 'private_lifetime':
      return 'consumer'
    case 'pro':
    case 'publisher':
    case 'publisher_lifetime':
      return 'pro'
    case 'enterprise':
      return 'enterprise'
    default: {
      const _exhaustive: never = tier
      return 'consumer'
    }
  }
}

/** Resolve the canonical config for a given vault tier. */
export function getConfigForTier(tier: VaultTier): Readonly<AutofillTierConfig> {
  const band = tierToBand(tier)
  switch (band) {
    case 'consumer':
      return CONSUMER_CONFIG
    case 'pro':
      return PRO_CONFIG
    case 'enterprise':
      return ENTERPRISE_CONFIG
  }
}

/** All tier configs, keyed by band name. */
export const TIER_CONFIGS: Readonly<Record<TierBand, Readonly<AutofillTierConfig>>> = {
  consumer: CONSUMER_CONFIG,
  pro: PRO_CONFIG,
  enterprise: ENTERPRISE_CONFIG,
}

// ============================================================================
// §6  CONFIG OVERRIDE MERGE
// ============================================================================

/** Partial override — vault settings can override individual knobs. */
export type AutofillConfigOverrides = Partial<Omit<AutofillTierConfig, 'band'>>

/**
 * Merge per-vault overrides into a tier config.
 *
 * Rules:
 *   - Overrides only tighten security, never loosen.
 *   - For boolean flags: override can only set `false` (disable), not enable
 *     something the tier disables.
 *   - For numeric thresholds: override can only raise thresholds (stricter).
 *   - For timeout values: override can only lower (shorter).
 *
 * Returns a new frozen config object.
 */
export function mergeConfig(
  base: Readonly<AutofillTierConfig>,
  overrides: AutofillConfigOverrides,
): Readonly<AutofillTierConfig> {
  const merged = { ...base }

  // Boolean knobs: can only be disabled
  const booleanKeys: (keyof AutofillConfigOverrides)[] = [
    'trustDomainToggleVisible',
    'autoInsertAllowed',
    'savePasswordEnabled',
    'interceptNetworkRequests',
    'quickSelectShortcutEnabled',
    'triggerIconEnabled',
    'formContextBoostEnabled',
    'spaWatcherEnabled',
    'persistAuditLog',
  ]
  for (const key of booleanKeys) {
    if (overrides[key] === false) {
      ;(merged as Record<string, unknown>)[key] = false
    }
  }

  // Threshold knobs: can only raise
  const raiseKeys: (keyof AutofillConfigOverrides)[] = [
    'confidenceThreshold',
    'opacityCheckDepth',
  ]
  for (const key of raiseKeys) {
    const v = overrides[key]
    if (typeof v === 'number' && v > (base[key] as number)) {
      ;(merged as Record<string, unknown>)[key] = v
    }
  }

  // Timeout knobs: can only lower
  const lowerKeys: (keyof AutofillConfigOverrides)[] = [
    'sessionTimeoutMs',
    'clipboardClearMs',
    'saveBarTimeoutMs',
    'scanThrottleMs',
  ]
  for (const key of lowerKeys) {
    const v = overrides[key]
    if (typeof v === 'number' && v < (base[key] as number) && v > 0) {
      ;(merged as Record<string, unknown>)[key] = v
    }
  }

  // Count limits: can only lower
  const lowerCountKeys: (keyof AutofillConfigOverrides)[] = [
    'maxScanElements',
    'quickSelectMaxResults',
    'auditLogMaxEntries',
    'telemetryMaxEntries',
  ]
  for (const key of lowerCountKeys) {
    const v = overrides[key]
    if (typeof v === 'number' && v < (base[key] as number) && v > 0) {
      ;(merged as Record<string, unknown>)[key] = v
    }
  }

  // Strict flags: can only enable (become stricter)
  const strictKeys: (keyof AutofillConfigOverrides)[] = [
    'strictSafeMode',
    'blockPublicSuffix',
    'coverCheckEnabled',
    'alwaysLogSecurity',
  ]
  for (const key of strictKeys) {
    if (overrides[key] === true) {
      ;(merged as Record<string, unknown>)[key] = true
    }
  }

  return Object.freeze(merged)
}

// ============================================================================
// §7  DIFF UTILITY (for audit / debug)
// ============================================================================

export interface ConfigDiff {
  key: string
  baseValue: unknown
  effectiveValue: unknown
  direction: 'tightened' | 'unchanged'
}

/** Return every setting that differs between the base tier and the merged config. */
export function diffConfig(
  base: Readonly<AutofillTierConfig>,
  effective: Readonly<AutofillTierConfig>,
): ConfigDiff[] {
  const diffs: ConfigDiff[] = []
  for (const key of Object.keys(base) as (keyof AutofillTierConfig)[]) {
    if (key === 'band') continue
    if (base[key] !== effective[key]) {
      diffs.push({
        key,
        baseValue: base[key],
        effectiveValue: effective[key],
        direction: 'tightened',
      })
    }
  }
  return diffs
}
