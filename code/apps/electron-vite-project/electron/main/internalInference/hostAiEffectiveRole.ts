/**
 * Host AI: separate orchestrator `orchestrator-mode.json` (hint) from **handshake+coordination-ledger**
 * roles. Discovery, probes, and endpoint ownership must use {@link getEffectiveHostAiRoleForHandshake}.
 */

import { listHandshakeRecords } from '../handshake/db'
import { HandshakeState, type HandshakeRecord } from '../handshake/types'
import { assertRecordForServiceRpc, deriveInternalHostAiPeerRoles } from './policy'

export type HostAiEffectiveRoleSource = 'handshake' | 'config_hint' | 'unknown'

export type HostAiEffectiveRoleResult = {
  /** Role of this instance for this row from {@link deriveInternalHostAiPeerRoles} (authoritative for Host AI). */
  effective_role: 'sandbox' | 'host' | 'unknown'
  /** `handshake` when ledger row yields roles; `unknown` when the row is unusable. */
  source: HostAiEffectiveRoleSource
  /**
   * `true` when persisted `configuredMode` (host|sandbox) disagrees with `effective_role`.
   * For diagnostics / UI; does **not** override handshake authority.
   */
  mismatch: boolean
  /** This device is the **host** side and may push direct-BEAP endpoint to the peer sandbox. */
  can_publish_host_endpoint: boolean
  /** This device is the **sandbox** side and may probe the peer host’s endpoint. */
  can_probe_host_endpoint: boolean
}

/**
 * @param configuredMode – value from `getOrchestratorMode().mode` (hint only, not an authority for Host AI).
 */
export function getEffectiveHostAiRoleForHandshake(
  record: HandshakeRecord,
  currentDeviceId: string,
  configuredMode: string,
): HostAiEffectiveRoleResult {
  const ar = assertRecordForServiceRpc(record)
  if (!ar.ok) {
    return {
      effective_role: 'unknown',
      source: 'unknown',
      mismatch: false,
      can_publish_host_endpoint: false,
      can_probe_host_endpoint: false,
    }
  }
  return getEffectiveFromActiveInternalRow(ar.record, currentDeviceId, configuredMode)
}

function getEffectiveFromActiveInternalRow(
  record: HandshakeRecord,
  currentDeviceId: string,
  configuredMode: string,
): HostAiEffectiveRoleResult {
  const dr = deriveInternalHostAiPeerRoles(record, currentDeviceId)
  if (!dr.ok) {
    return {
      effective_role: 'unknown',
      source: 'unknown',
      mismatch: false,
      can_publish_host_endpoint: false,
      can_probe_host_endpoint: false,
    }
  }
  const eff = dr.localRole
  const norm = String(configuredMode ?? '')
    .toLowerCase()
    .trim()
  const cfgHost = norm === 'host'
  const cfgSand = norm === 'sandbox'
  const mismatch = (cfgHost && eff === 'sandbox') || (cfgSand && eff === 'host')
  return {
    effective_role: eff,
    source: 'handshake',
    mismatch,
    can_publish_host_endpoint: dr.localRole === 'host' && dr.peerRole === 'sandbox',
    can_probe_host_endpoint: dr.localRole === 'sandbox' && dr.peerRole === 'host',
  }
}

/**
 * Scans ACTIVE internal handshakes and ORs per-row capabilities. Use for top-level logging / gating
 * (orchestrator file must not be used as a substitute for this).
 */
export function getHostAiLedgerRoleSummaryFromDb(
  db: unknown,
  currentDeviceId: string,
  configuredMode: string,
): {
  can_publish_host_endpoint: boolean
  can_probe_host_endpoint: boolean
  any_orchestrator_mismatch: boolean
  /** Single aggregate label when multiple internal rows exist (should not normally be `mixed`). */
  effective_host_ai_role: 'host' | 'sandbox' | 'none' | 'mixed'
} {
  if (!db) {
    return {
      can_publish_host_endpoint: false,
      can_probe_host_endpoint: false,
      any_orchestrator_mismatch: false,
      effective_host_ai_role: 'none',
    }
  }
  const rows = listHandshakeRecords(db as any, { state: HandshakeState.ACTIVE, handshake_type: 'internal' })
  let canPublish = false
  let canProbe = false
  let anyMismatch = false
  let sawHost = false
  let sawSand = false
  for (const r0 of rows) {
    const o = getEffectiveHostAiRoleForHandshake(r0, currentDeviceId, configuredMode)
    if (o.effective_role === 'host') sawHost = true
    if (o.effective_role === 'sandbox') sawSand = true
    if (o.mismatch) anyMismatch = true
    if (o.can_publish_host_endpoint) canPublish = true
    if (o.can_probe_host_endpoint) canProbe = true
  }
  let eff: 'host' | 'sandbox' | 'none' | 'mixed'
  if (sawHost && sawSand) {
    eff = 'mixed'
  } else if (sawHost) {
    eff = 'host'
  } else if (sawSand) {
    eff = 'sandbox'
  } else {
    eff = 'none'
  }
  return {
    can_publish_host_endpoint: canPublish,
    can_probe_host_endpoint: canProbe,
    any_orchestrator_mismatch: anyMismatch,
    effective_host_ai_role: eff,
  }
}
