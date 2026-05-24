/**
 * Edge tier settings — Phase 3 (P3.8).
 *
 * Persisted under Electron userData as edge-tier-settings.json.
 * Phase 4 wizard reads/writes the same shape.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

export type EdgeFallbackPolicy = 'reject' | 'local_only'

/** One REMOTE_EDGE replica the user trusts for LOCAL_VERIFY. */
export interface EdgeReplica {
  host: string
  port: number
  edge_pod_id: string
  /** Ed25519 public key: `ed25519:<hex>` */
  edge_public_key: string
  /** Keycloak attestation JWT binding edge_pod_id + edge_public_key to user sub. */
  sso_attestation_jwt: string
}

export interface EdgeTierSettings {
  enabled: boolean
  replicas: EdgeReplica[]
  fallback_policy: EdgeFallbackPolicy
  /** Preloaded JWKS for LOCAL_VERIFY verifier (no runtime Keycloak egress). */
  cached_jwks_json?: string
  cached_jwks_fetched_at?: string
}

export const DEFAULT_EDGE_TIER_SETTINGS: EdgeTierSettings = {
  enabled: false,
  replicas: [],
  fallback_policy: 'reject',
}

const SETTINGS_FILENAME = 'edge-tier-settings.json'

let _settingsPathOverride: string | null = null
let _userDataDirOverride: string | null = null

/** Tests inject a temp path. */
export function _setSettingsPathForTest(path: string | null): void {
  _settingsPathOverride = path
}

export function _setUserDataDirForTest(path: string | null): void {
  _userDataDirOverride = path
}

function getUserDataDir(): string {
  if (_userDataDirOverride) return _userDataDirOverride
  if (process.env['WR_DESK_USER_DATA']) return process.env['WR_DESK_USER_DATA']
  try {
    // Dynamic import keeps edge-cli usable outside the Electron runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron')
    return app.getPath('userData')
  } catch {
    return join(homedir(), '.config', 'wr-desk')
  }
}

export function getEdgeTierSettingsPath(): string {
  if (_settingsPathOverride) return _settingsPathOverride
  return join(getUserDataDir(), SETTINGS_FILENAME)
}

function normalizeReplica(raw: unknown): EdgeReplica | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (
    typeof r.host !== 'string' ||
    typeof r.port !== 'number' ||
    typeof r.edge_pod_id !== 'string' ||
    typeof r.edge_public_key !== 'string' ||
    typeof r.sso_attestation_jwt !== 'string'
  ) {
    return null
  }
  return {
    host: r.host,
    port: r.port,
    edge_pod_id: r.edge_pod_id,
    edge_public_key: r.edge_public_key,
    sso_attestation_jwt: r.sso_attestation_jwt,
  }
}

export function normalizeEdgeTierSettings(raw: unknown): EdgeTierSettings {
  if (typeof raw !== 'object' || raw === null) {
    return { ...DEFAULT_EDGE_TIER_SETTINGS }
  }
  const o = raw as Record<string, unknown>
  const replicas = Array.isArray(o.replicas)
    ? o.replicas.map(normalizeReplica).filter((r): r is EdgeReplica => r !== null)
    : []
  const fallback =
    o.fallback_policy === 'local_only' ? 'local_only' : 'reject'
  return {
    enabled: o.enabled === true,
    replicas,
    fallback_policy: fallback,
    cached_jwks_json:
      typeof o.cached_jwks_json === 'string' ? o.cached_jwks_json : undefined,
    cached_jwks_fetched_at:
      typeof o.cached_jwks_fetched_at === 'string' ? o.cached_jwks_fetched_at : undefined,
  }
}

export function loadEdgeTierSettings(): EdgeTierSettings {
  const path = getEdgeTierSettingsPath()
  if (!existsSync(path)) {
    return { ...DEFAULT_EDGE_TIER_SETTINGS }
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return normalizeEdgeTierSettings(raw)
  } catch {
    return { ...DEFAULT_EDGE_TIER_SETTINGS }
  }
}

export function saveEdgeTierSettings(settings: EdgeTierSettings): void {
  const path = getEdgeTierSettingsPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(settings, null, 2), { mode: 0o600 })
}

export function getEdgeTierEnabled(): boolean {
  return loadEdgeTierSettings().enabled
}

export function setEdgeTierEnabled(enabled: boolean): EdgeTierSettings {
  const current = loadEdgeTierSettings()
  const next = { ...current, enabled }
  saveEdgeTierSettings(next)
  return next
}

export function upsertEdgeReplica(replica: EdgeReplica): EdgeTierSettings {
  const current = loadEdgeTierSettings()
  const replicas = current.replicas.filter((r) => r.edge_pod_id !== replica.edge_pod_id)
  replicas.push(replica)
  const next = { ...current, replicas }
  saveEdgeTierSettings(next)
  return next
}

export function removeEdgeReplica(edgePodId: string): {
  settings: EdgeTierSettings
  wasLast: boolean
} {
  const current = loadEdgeTierSettings()
  const replicas = current.replicas.filter(
    (r) => r.edge_pod_id.toLowerCase() !== edgePodId.toLowerCase(),
  )
  const wasLast = current.replicas.length === 1 && replicas.length === 0
  const next = { ...current, replicas }
  saveEdgeTierSettings(next)
  return { settings: next, wasLast }
}

export function replaceEdgeReplica(oldPodId: string, replica: EdgeReplica): EdgeTierSettings {
  const current = loadEdgeTierSettings()
  const replicas = current.replicas.filter(
    (r) => r.edge_pod_id.toLowerCase() !== oldPodId.toLowerCase(),
  )
  replicas.push(replica)
  const next = { ...current, replicas }
  saveEdgeTierSettings(next)
  return next
}

/** Comma-separated edge pod UUIDs for TRUSTED_EDGE_POD_IDS env injection. */
export function formatTrustedEdgePodIds(settings: EdgeTierSettings): string {
  return settings.replicas.map((r) => r.edge_pod_id).join(',')
}

export function edgeTierRequiresPodRestart(before: EdgeTierSettings, after: EdgeTierSettings): boolean {
  if (before.enabled !== after.enabled) return true
  if (formatTrustedEdgePodIds(before) !== formatTrustedEdgePodIds(after)) return true
  if (before.cached_jwks_json !== after.cached_jwks_json) return true
  return false
}
