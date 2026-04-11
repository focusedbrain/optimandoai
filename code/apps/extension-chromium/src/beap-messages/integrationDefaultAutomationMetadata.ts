/**
 * Integration-level default automation metadata (BEAP inbox).
 *
 * Persisted separately from:
 * - `mode_trigger` rows
 * - `CustomModeDefinition.triggerBarIcon` / custom mode chrome
 * - `agent.icon` and per-agent UI
 *
 * Used to remember, per verified sender (+ optional handshake relationship), which working-copy
 * session is the default automation target and which icon to show for that integration default.
 */

import type { BeapMessage } from './beapInboxTypes'

// =============================================================================
// Storage
// =============================================================================

export const BEAP_INTEGRATION_DEFAULT_AUTOMATION_STORAGE_KEY = 'beap_integration_default_automation_v1'

// =============================================================================
// Identity (stable key from BEAP domain model)
// =============================================================================

export interface BeapIntegrationIdentityV1 {
  schemaVersion: 1
  /**
   * Sender fingerprint from verified capsule header (`BeapMessage.senderFingerprint`).
   * Normalized to lowercase trimmed hex for stable comparison.
   */
  senderFingerprint: string
  /**
   * Established handshake relationship when present; `null` for depackaged / email path.
   * Included in the key so the same device fingerprint can map to different integrations.
   */
  handshakeId: string | null
}

/**
 * Canonical stable string for persistence lookups.
 * Prefer this over inventing ad-hoc keys from email display names.
 */
export function validateBeapIntegrationIdentity(
  identity: BeapIntegrationIdentityV1,
): { ok: true } | { ok: false; reason: string } {
  if (!String(identity.senderFingerprint ?? '').trim()) {
    return {
      ok: false,
      reason: 'Integration metadata requires a verified sender fingerprint on the BEAP message.',
    }
  }
  return { ok: true }
}

export function beapIntegrationStableKey(identity: BeapIntegrationIdentityV1): string {
  const fp = identity.senderFingerprint.trim().toLowerCase()
  if (!fp) {
    throw new Error('beapIntegrationStableKey: senderFingerprint must be non-empty')
  }
  const hs = identity.handshakeId
  if (hs != null && String(hs).trim() !== '') {
    return `v1|hs:${String(hs).trim()}|fp:${fp}`
  }
  return `v1|fp:${fp}`
}

export function beapIntegrationIdentityFromMessage(
  m: Pick<BeapMessage, 'senderFingerprint' | 'handshakeId'>,
): BeapIntegrationIdentityV1 {
  return {
    schemaVersion: 1,
    senderFingerprint: m.senderFingerprint.trim().toLowerCase(),
    handshakeId: m.handshakeId,
  }
}

// =============================================================================
// Records (additive, v1)
// =============================================================================

export interface BeapIntegrationDefaultAutomationEntryV1 {
  schemaVersion: 1
  /** Redundant copy of `beapIntegrationStableKey(identity)` for validation. */
  integrationKey: string
  identity: BeapIntegrationIdentityV1
  /**
   * Working-copy session storage key (`session_…`) designated as the default automation
   * for messages from this integration.
   */
  defaultSessionKey: string | null
  /** Optional human-readable label captured when the user saves (not a mode name). */
  defaultAutomationLabel: string | null
  /**
   * Integration-scoped icon for the default automation affordance only.
   * Emoji, short text glyph, or `https:` / `data:` URL — not wired to agent or custom mode icons.
   */
  defaultAutomationIcon: string | null
  updatedAt: number
}

export interface BeapIntegrationDefaultAutomationRootV1 {
  schemaVersion: 1
  byIntegrationKey: Record<string, BeapIntegrationDefaultAutomationEntryV1>
}

export function emptyBeapIntegrationDefaultAutomationRoot(): BeapIntegrationDefaultAutomationRootV1 {
  return { schemaVersion: 1, byIntegrationKey: {} }
}

/** Normalize unknown chrome.storage payload — backward compatible (missing → empty root). */
export function parseBeapIntegrationDefaultAutomationRoot(
  raw: unknown,
): BeapIntegrationDefaultAutomationRootV1 {
  if (raw === null || raw === undefined || typeof raw !== 'object') {
    return emptyBeapIntegrationDefaultAutomationRoot()
  }
  const o = raw as Record<string, unknown>
  if (o.schemaVersion !== 1 || typeof o.byIntegrationKey !== 'object' || o.byIntegrationKey === null) {
    return emptyBeapIntegrationDefaultAutomationRoot()
  }
  return {
    schemaVersion: 1,
    byIntegrationKey: { ...(o.byIntegrationKey as Record<string, BeapIntegrationDefaultAutomationEntryV1>) },
  }
}

export function serializeBeapIntegrationDefaultAutomationRoot(
  root: BeapIntegrationDefaultAutomationRootV1,
): string {
  return JSON.stringify(root)
}

// =============================================================================
// chrome.storage.local I/O (sidepanel / extension pages)
// =============================================================================

export function loadBeapIntegrationDefaultAutomationRoot(): Promise<BeapIntegrationDefaultAutomationRootV1> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([BEAP_INTEGRATION_DEFAULT_AUTOMATION_STORAGE_KEY], (items) => {
        if (chrome.runtime.lastError) {
          resolve(emptyBeapIntegrationDefaultAutomationRoot())
          return
        }
        resolve(parseBeapIntegrationDefaultAutomationRoot(items[BEAP_INTEGRATION_DEFAULT_AUTOMATION_STORAGE_KEY]))
      })
    } catch {
      resolve(emptyBeapIntegrationDefaultAutomationRoot())
    }
  })
}

export function saveBeapIntegrationDefaultAutomationRoot(
  root: BeapIntegrationDefaultAutomationRootV1,
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set({ [BEAP_INTEGRATION_DEFAULT_AUTOMATION_STORAGE_KEY]: root }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        resolve()
      })
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })
}

export async function getBeapIntegrationDefaultAutomationEntry(
  integrationKey: string,
): Promise<BeapIntegrationDefaultAutomationEntryV1 | null> {
  const root = await loadBeapIntegrationDefaultAutomationRoot()
  const e = root.byIntegrationKey[integrationKey]
  if (!e || e.schemaVersion !== 1) return null
  if (e.integrationKey !== integrationKey) return null
  return e
}

export async function upsertBeapIntegrationDefaultAutomationEntry(
  entry: Omit<BeapIntegrationDefaultAutomationEntryV1, 'schemaVersion' | 'updatedAt'> & {
    updatedAt?: number
  },
): Promise<void> {
  const idCheck = validateBeapIntegrationIdentity(entry.identity)
  if (!idCheck.ok) {
    throw new Error(idCheck.reason)
  }
  const expectedKey = beapIntegrationStableKey(entry.identity)
  if (entry.integrationKey !== expectedKey) {
    throw new Error('integrationKey does not match identity (possible caller bug).')
  }
  const root = await loadBeapIntegrationDefaultAutomationRoot()
  const full: BeapIntegrationDefaultAutomationEntryV1 = {
    schemaVersion: 1,
    integrationKey: entry.integrationKey,
    identity: entry.identity,
    defaultSessionKey: entry.defaultSessionKey,
    defaultAutomationLabel: entry.defaultAutomationLabel,
    defaultAutomationIcon: entry.defaultAutomationIcon,
    updatedAt: entry.updatedAt ?? Date.now(),
  }
  root.byIntegrationKey[entry.integrationKey] = full
  await saveBeapIntegrationDefaultAutomationRoot(root)
}
