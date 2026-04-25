/**
 * STEP 4: When the Host’s LAN P2P URL changes, Sandbox can repair the stored counterparty
 * `p2p_endpoint` from the `X-BEAP-Direct-P2P-Endpoint` header on direct Host responses (MVP: no relay).
 */

import { getHandshakeRecord, listHandshakeRecords, updateHandshakeRecord } from '../handshake/db'
import { HandshakeState, type HandshakeRecord } from '../handshake/types'
import { getP2PConfig, computeLocalP2PEndpoint } from '../p2p/p2pConfig'
import {
  assertLedgerRolesSandboxToHost,
  assertRecordForServiceRpc,
  p2pEndpointMvpClass,
  type P2pMvpEndpointClass,
} from './policy'

export const P2P_DIRECT_P2P_ENDPOINT_HEADER = 'X-BEAP-Direct-P2P-Endpoint'

let appP2pLedgerStartupPassDone = false

export function resetP2pEndpointRepairSessionGates(): void {
  appP2pLedgerStartupPassDone = false
}

function kindForLog(db: any, url: string | null | undefined): P2pMvpEndpointClass {
  return p2pEndpointMvpClass(db, url)
}

/**
 * The URL this Host would publish for direct LAN ingest, only when it is valid for inference MVP
 * (non-relay, non-loopback per policy).
 */
export function getHostPublishedMvpDirectP2pIngestUrl(db: any): string | null {
  const cfg = getP2PConfig(db)
  if (!cfg.enabled) return null
  const url = computeLocalP2PEndpoint(cfg)
  if (p2pEndpointMvpClass(db, url) !== 'direct_lan') return null
  return url
}

export function hostDirectP2pAdvertisementHeaders(db: any): Record<string, string> {
  const u = getHostPublishedMvpDirectP2pIngestUrl(db)
  return u ? { [P2P_DIRECT_P2P_ENDPOINT_HEADER]: u } : {}
}

function normalizeP2pIngestUrl(s: string): string {
  const t = s.trim()
  try {
    const u = new URL(t)
    u.hash = ''
    let p = u.pathname
    if (p.length > 1 && p.endsWith('/')) {
      p = p.slice(0, -1)
    }
    u.pathname = p
    return u.toString()
  } catch {
    return t
  }
}

/**
 * Sandbox: apply Host-advertised direct ingest URL to the active internal handshake row when the
 * header is present, MVP-direct, and different from the stored `p2p_endpoint`.
 */
export function tryRepairP2pEndpointFromHostAdvertisement(
  db: any,
  handshakeId: string,
  headerValue: string | null | undefined,
): void {
  const hid = String(handshakeId ?? '').trim()
  if (!db || !hid) {
    console.log(`[HOST_INFERENCE_P2P] endpoint_repair_skipped reason=no_db`)
    return
  }
  const advRaw = typeof headerValue === 'string' ? headerValue.trim() : ''
  if (!advRaw) {
    return
  }
  if (p2pEndpointMvpClass(db, advRaw) !== 'direct_lan') {
    console.log(
      `[HOST_INFERENCE_P2P] endpoint_repair_skipped reason=advertised_not_mvp_direct handshake=${hid}`,
    )
    return
  }
  const r0 = getHandshakeRecord(db, hid)
  const ar = assertRecordForServiceRpc(r0)
  if (!ar.ok) {
    console.log(
      `[HOST_INFERENCE_P2P] endpoint_repair_skipped reason=not_active_internal_handshake handshake=${hid}`,
    )
    return
  }
  if (!assertLedgerRolesSandboxToHost(ar.record).ok) {
    console.log(
      `[HOST_INFERENCE_P2P] endpoint_repair_skipped reason=not_sandbox_to_host_ledger handshake=${hid}`,
    )
    return
  }
  const r = ar.record
  const current = (r.p2p_endpoint ?? '').trim()
  const newNorm = normalizeP2pIngestUrl(advRaw)
  const oldNorm = current ? normalizeP2pIngestUrl(current) : ''
  if (newNorm === oldNorm) {
    console.log(`[HOST_INFERENCE_P2P] endpoint_repair_skipped reason=unchanged handshake=${hid}`)
    return
  }
  const oldKind = kindForLog(db, current || null)
  const newKind = kindForLog(db, advRaw)
  console.log(
    `[HOST_INFERENCE_P2P] endpoint_repair_begin handshake=${hid} old=${oldKind} new=${newKind}`,
  )
  const next: HandshakeRecord = { ...r, p2p_endpoint: newNorm }
  updateHandshakeRecord(db, next)
  console.log(`[HOST_INFERENCE_P2P] endpoint_repair_done handshake=${hid}`)
}

/**
 * Triggers: app + P2P startup (gated once per session until {@link resetP2pEndpointRepairSessionGates}),
 * list selector refresh, mode change, internal handshake → ACTIVE. Host-side: logs which URL would be
 * advertised; Sandbox-side: logs rows whose stored counterparty URL is not MVP-direct.
 */
export function runP2pEndpointRepairPass(db: any, context: string): void {
  if (!db) {
    console.log(`[HOST_INFERENCE_P2P] endpoint_repair_skipped reason=no_db context=${context}`)
    return
  }
  if (context === 'app_p2p_ledger_ready') {
    if (appP2pLedgerStartupPassDone) {
      return
    }
    appP2pLedgerStartupPassDone = true
  }

  const rows = listHandshakeRecords(db, { state: HandshakeState.ACTIVE, handshake_type: 'internal' })
  for (const r of rows) {
    const ar = assertRecordForServiceRpc(r)
    if (!ar.ok) continue
    if (!assertLedgerRolesSandboxToHost(ar.record).ok) continue
    const k = p2pEndpointMvpClass(db, ar.record.p2p_endpoint)
    if (k !== 'direct_lan') {
      console.log(
        `[HOST_INFERENCE_P2P] endpoint_repair_skipped reason=stale_or_non_direct_stored handshake=${r.handshake_id} stored_kind=${k} context=${context}`,
      )
    }
  }
  const hostUrl = getHostPublishedMvpDirectP2pIngestUrl(db)
  if (hostUrl) {
    console.log(
      `[HOST_INFERENCE_P2P] endpoint_repair_pass context=${context} host_publishes_mvp_direct=${hostUrl}`,
    )
  } else {
    console.log(`[HOST_INFERENCE_P2P] endpoint_repair_pass context=${context} host_publishes_mvp_direct=(none)`)
  }
}

export function runP2pEndpointRepairAfterInternalHandshakeActive(db: any, handshakeId: string): void {
  const hid = String(handshakeId ?? '').trim()
  if (!db || !hid) {
    console.log(
      `[HOST_INFERENCE_P2P] endpoint_repair_skipped reason=no_db context=internal_handshake_active`,
    )
    return
  }
  console.log(`[HOST_INFERENCE_P2P] endpoint_repair_pass handshake=${hid} context=internal_handshake_active`)
  runP2pEndpointRepairPass(db, 'internal_handshake_active_transition')
}
