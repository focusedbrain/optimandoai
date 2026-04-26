/**
 * STEP 4: When the Host’s LAN P2P URL changes, Sandbox can repair the stored counterparty
 * `p2p_endpoint` from the `X-BEAP-Direct-P2P-Endpoint` header on direct Host responses (MVP: no relay).
 */

import { getHandshakeRecord, listHandshakeRecords, updateHandshakeRecord } from '../handshake/db'
import { HandshakeState, type HandshakeRecord } from '../handshake/types'
import { getP2PConfig, computeLocalP2PEndpoint } from '../p2p/p2pConfig'
import { InternalInferenceErrorCode } from './errors'
import { isHostAiLedgerAsymmetricTerminal } from './hostAiPairingStateStore'
import {
  assertLedgerRolesSandboxToHost,
  assertRecordForServiceRpc,
  coordinationDeviceIdForHandshakeDeviceRole,
  p2pEndpointKind,
  p2pEndpointMvpClass,
  type P2pMvpEndpointClass,
} from './policy'

export const P2P_DIRECT_P2P_ENDPOINT_HEADER = 'X-BEAP-Direct-P2P-Endpoint'

let appP2pLedgerStartupPassDone = false

/** Last Host-advertised MVP direct ingest URL per handshake (Sandbox; from response header). */
const hostAdvertisedMvpDirectByHandshake = new Map<string, string>()

const p2pEnsureCacheInvalidators: Array<(handshakeId: string) => void> = []

/** Register `lastP2pEnsureByHandshake` invalidation (see listInferenceTargets). */
export function registerP2pEnsureCacheInvalidator(fn: (handshakeId: string) => void): void {
  p2pEnsureCacheInvalidators.push(fn)
}

function invalidateP2pEnsureCachesForHandshake(handshakeId: string): void {
  const hid = handshakeId.trim()
  if (!hid) return
  for (const fn of p2pEnsureCacheInvalidators) {
    try {
      fn(hid)
    } catch {
      /* no-op */
    }
  }
}

/** @internal */
export function resetHostAdvertisedMvpDirectForTests(): void {
  hostAdvertisedMvpDirectByHandshake.clear()
}

/** @internal — vitest: seed the in-memory map as if the peer Host advertised a header. */
export function setHostAdvertisedMvpDirectForTests(handshakeId: string, url: string | null | undefined): void {
  const hid = String(handshakeId ?? '').trim()
  if (!hid) return
  const t = typeof url === 'string' ? url.trim() : ''
  if (!t) {
    hostAdvertisedMvpDirectByHandshake.delete(hid)
    return
  }
  hostAdvertisedMvpDirectByHandshake.set(hid, normalizeP2pIngestUrl(t))
}

/** Drop poisoned peer “advertisement” (e.g. this sandbox’s own BEAP URL) from the in-memory map. */
export function clearHostAdvertisedMvpDirectForHandshake(handshakeId: string): void {
  const hid = String(handshakeId ?? '').trim()
  if (!hid) return
  hostAdvertisedMvpDirectByHandshake.delete(hid)
}

/** Sandbox: last Host-advertised MVP direct ingest URL seen for this handshake (response header), if any. */
export function peekHostAdvertisedMvpDirectP2pEndpoint(handshakeId: string): string | null {
  const hid = String(handshakeId ?? '').trim()
  if (!hid) return null
  const raw = hostAdvertisedMvpDirectByHandshake.get(hid)
  const t = typeof raw === 'string' ? raw.trim() : ''
  return t.length > 0 ? t : null
}

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

/**
 * True when `url` is the same MVP direct LAN BEAP this process would publish (this machine’s listener).
 * Used on Sandbox: if the “host” `p2p_endpoint` normalizes to this, the row points at the local sandbox, not the peer host.
 */
export function ingestUrlMatchesThisDevicesMvpDirectBeap(db: any, url: string | null | undefined): boolean {
  const pub = getHostPublishedMvpDirectP2pIngestUrl(db)
  if (!pub) return false
  const t = typeof url === 'string' ? url.trim() : ''
  if (!t) return false
  return normalizeP2pIngestUrl(t) === normalizeP2pIngestUrl(pub)
}

export type SandboxToHostHttpDirectIngestResult =
  | {
      ok: true
      url: string
      selected_endpoint_source: 'peer_advertised_header' | 'internal_handshake_ledger'
      local_beap_endpoint: string | null
      peer_advertised_beap_endpoint: string | null
      ledger_p2p_endpoint: string
      repaired_from_local_endpoint: boolean
    }
  | {
      ok: false
      code: typeof InternalInferenceErrorCode.HOST_AI_ENDPOINT_OWNER_MISMATCH | typeof InternalInferenceErrorCode.HOST_DIRECT_ENDPOINT_MISSING
      local_beap_endpoint: string | null
      peer_advertised_beap_endpoint: string | null
      ledger_p2p_endpoint: string
    }

/**
 * Sandbox → host **HTTP direct** only: pick the POST base URL that is *not* this process’s own MVP direct
 * BEAP, preferring a peer-issued advertisement (response header) over the internal handshake `p2p_endpoint`
 * row, which can be corrupt or conflate local BEAP with the host peer.
 */
export function resolveSandboxToHostHttpDirectIngest(
  db: any,
  handshakeId: string,
  row: { p2p_endpoint: string | null | undefined },
  callerIngestUrl: string,
): SandboxToHostHttpDirectIngestResult {
  const hid = String(handshakeId ?? '').trim()
  const localPub = getHostPublishedMvpDirectP2pIngestUrl(db)
  const peerAd = peekHostAdvertisedMvpDirectP2pEndpoint(hid)
  const ledger = typeof row.p2p_endpoint === 'string' ? row.p2p_endpoint.trim() : ''
  const fromCaller = typeof callerIngestUrl === 'string' ? callerIngestUrl.trim() : ''
  const candidate = fromCaller || ledger
  const repairedFromLocal = Boolean(ledger && ingestUrlMatchesThisDevicesMvpDirectBeap(db, ledger))

  if (peerAd) {
    if (ingestUrlMatchesThisDevicesMvpDirectBeap(db, peerAd)) {
      clearHostAdvertisedMvpDirectForHandshake(hid)
      return {
        ok: false,
        code: InternalInferenceErrorCode.HOST_AI_ENDPOINT_OWNER_MISMATCH,
        local_beap_endpoint: localPub,
        peer_advertised_beap_endpoint: peerAd,
        ledger_p2p_endpoint: ledger,
      }
    }
    return {
      ok: true,
      url: normalizeP2pIngestUrl(peerAd),
      selected_endpoint_source: 'peer_advertised_header',
      local_beap_endpoint: localPub,
      peer_advertised_beap_endpoint: peerAd,
      ledger_p2p_endpoint: ledger,
      repaired_from_local_endpoint: repairedFromLocal,
    }
  }
  if (!candidate) {
    return {
      ok: false,
      code: InternalInferenceErrorCode.HOST_DIRECT_ENDPOINT_MISSING,
      local_beap_endpoint: localPub,
      peer_advertised_beap_endpoint: null,
      ledger_p2p_endpoint: ledger,
    }
  }
  if (ingestUrlMatchesThisDevicesMvpDirectBeap(db, candidate)) {
    return {
      ok: false,
      code: InternalInferenceErrorCode.HOST_AI_ENDPOINT_OWNER_MISMATCH,
      local_beap_endpoint: localPub,
      peer_advertised_beap_endpoint: null,
      ledger_p2p_endpoint: ledger,
    }
  }
  return {
    ok: true,
    url: normalizeP2pIngestUrl(candidate),
    selected_endpoint_source: 'internal_handshake_ledger',
    local_beap_endpoint: localPub,
    peer_advertised_beap_endpoint: null,
    ledger_p2p_endpoint: ledger,
    repaired_from_local_endpoint: repairedFromLocal,
  }
}

export function hostDirectP2pAdvertisementHeaders(db: any): Record<string, string> {
  const u = getHostPublishedMvpDirectP2pIngestUrl(db)
  return u ? { [P2P_DIRECT_P2P_ENDPOINT_HEADER]: u } : {}
}

export function normalizeP2pIngestUrl(s: string): string {
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
  if (ingestUrlMatchesThisDevicesMvpDirectBeap(db, advRaw)) {
    clearHostAdvertisedMvpDirectForHandshake(hid)
    console.log(
      `[HOST_INFERENCE_P2P] endpoint_repair_skipped reason=advertised_is_local_sandbox_beaP handshake=${hid}`,
    )
    return
  }
  hostAdvertisedMvpDirectByHandshake.set(hid, normalizeP2pIngestUrl(advRaw))
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
  invalidateP2pEnsureCachesForHandshake(hid)
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

  const hostUrl = getHostPublishedMvpDirectP2pIngestUrl(db)

  const rows = listHandshakeRecords(db, { state: HandshakeState.ACTIVE, handshake_type: 'internal' })
  for (const r of rows) {
    const ar = assertRecordForServiceRpc(r)
    if (!ar.ok) continue
    if (!assertLedgerRolesSandboxToHost(ar.record).ok) continue
    const hid = r.handshake_id
    const hostCoord = (coordinationDeviceIdForHandshakeDeviceRole(ar.record, 'host') ?? '').trim()
    if (hostCoord && isHostAiLedgerAsymmetricTerminal(hid, hostCoord)) {
      console.log(
        `[HOST_INFERENCE_P2P] endpoint_repair_skipped reason=ledger_asymmetric_terminal handshake=${hid} context=${context}`,
      )
      continue
    }
    const storedEp = ar.record.p2p_endpoint
    const storedRelayKind = p2pEndpointKind(db, storedEp) === 'relay'
    const k = p2pEndpointMvpClass(db, storedEp)

    // Never fall back to `hostUrl` (this process’s published direct URL) on a sandbox row: that can be
    // the local sandbox’s LAN BEAP, not the peer host’s. Promote only from Host-advertised header.
    const promoRaw = hostAdvertisedMvpDirectByHandshake.get(hid)
    if (
      storedRelayKind &&
      promoRaw &&
      p2pEndpointMvpClass(db, promoRaw) === 'direct_lan'
    ) {
      const newNorm = normalizeP2pIngestUrl(promoRaw)
      const oldNorm = storedEp ? normalizeP2pIngestUrl(storedEp) : ''
      if (newNorm !== oldNorm) {
        const next: HandshakeRecord = { ...ar.record, p2p_endpoint: newNorm }
        updateHandshakeRecord(db, next)
        invalidateP2pEnsureCachesForHandshake(hid)
        const toKind = p2pEndpointKind(db, newNorm)
        console.log(
          `[HOST_INFERENCE_P2P] endpoint_repair_promoted handshake=${hid} from_kind=relay to_kind=${toKind} new_endpoint=${newNorm} context=${context}`,
        )
        continue
      }
    }

    if (k !== 'direct_lan') {
      console.log(
        `[HOST_INFERENCE_P2P] endpoint_repair_skipped reason=stale_or_non_direct_stored handshake=${hid} stored_kind=${k} context=${context}`,
      )
    }
  }
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
