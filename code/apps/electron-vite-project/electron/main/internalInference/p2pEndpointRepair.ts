/**
 * STEP 4: When the Host’s LAN P2P URL changes, Sandbox can repair the stored counterparty
 * `p2p_endpoint` from the `X-BEAP-Direct-P2P-Endpoint` header on direct Host responses (MVP: no relay).
 */

import { getHandshakeRecord, listHandshakeRecords, updateHandshakeRecord } from '../handshake/db'
import { getInstanceId, getOrchestratorMode } from '../orchestrator/orchestratorModeStore'
import { getAccessToken } from '../../../src/auth/session'
import { getHostAiLedgerRoleSummaryFromDb } from './hostAiEffectiveRole'
import { HandshakeState, type HandshakeRecord } from '../handshake/types'
import { getP2PConfig, computeLocalP2PEndpoint } from '../p2p/p2pConfig'
import { InternalInferenceErrorCode } from './errors'
import {
  type HostAiEndpointCandidate,
  type HostAiEndpointResolutionCategory,
  type HostAiSelectedEndpointProvenance,
} from './hostAiEndpointCandidate'
import { isHostAiLedgerAsymmetricTerminal } from './hostAiPairingStateStore'
import {
  assertLedgerRolesSandboxToHost,
  assertRecordForServiceRpc,
  coordinationDeviceIdForHandshakeDeviceRole,
  deriveInternalHostAiPeerRoles,
  p2pEndpointKind,
  p2pEndpointMvpClass,
  type P2pMvpEndpointClass,
} from './policy'
import type { HostAiBeapAdOllamaModelWireEntry } from './hostAiBeapAdOllamaModelCount'

export const P2P_DIRECT_P2P_ENDPOINT_HEADER = 'X-BEAP-Direct-P2P-Endpoint'

/**
 * In-memory only (process lifetime).
 * `relay` = authenticated coordination `p2p_host_ai_direct_beap_ad`.
 * `ledger_hydration` = seeded from persisted `p2p_endpoint` on startup / list (see `hydrateHostAdvertisedMapFromLedger`).
 */
export type HostAiPeerBeapAdSource = 'http_header' | 'relay' | 'ledger_hydration'

/** Sandbox: Ollama roster from Host `host_ai_route.capabilities` on relay BEAP ad (same principal / verified owner). */
export type HostAiPeerAdvertisedOllamaRoster = {
  models: HostAiBeapAdOllamaModelWireEntry[]
  active_model_id: string | null
  active_model_name: string | null
  model_source: string | null
  max_concurrent_local_models: number
}

type PeerHeaderEntry = {
  url: string
  ownerDeviceId: string | null
  adSource: HostAiPeerBeapAdSource
  ollamaRoster?: HostAiPeerAdvertisedOllamaRoster | null
  /** Set when this entry came from {@link hydrateHostAdvertisedMapFromLedger}. */
  hydratedAt?: number
  /** ISO timestamp string used for hydration bookkeeping (`activated_at` or `created_at`). */
  ledgerLastSeenAt?: string | null
}

let appP2pLedgerStartupPassDone = false

/** Last Host-advertised MVP direct ingest per handshake (Sandbox; from relay first, or HTTP response header). */
const hostAdvertisedMvpDirectByHandshake = new Map<string, PeerHeaderEntry>()

/** Monotonic ad_seq for relay push only (rejects stale). */
const hostAiRelayBeapAdLastSeq = new Map<string, number>()

/** Layer 3: throttle coordination republish requests when map miss + ledger fallback (per handshake). */
const lastBeapAdRefreshOnMapMissAtByHandshake = new Map<string, number>()
const MAP_MISS_BEAP_AD_REFRESH_MIN_INTERVAL_MS = 30_000

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
  hostAiRelayBeapAdLastSeq.clear()
  lastBeapAdRefreshOnMapMissAtByHandshake.clear()
}

/** @internal — vitest: seed the in-memory map as if the peer Host advertised a header. */
export function setHostAdvertisedMvpDirectForTests(
  handshakeId: string,
  url: string | null | undefined,
  meta?: { ownerDeviceId?: string | null; adSource?: HostAiPeerBeapAdSource; ollamaRoster?: HostAiPeerAdvertisedOllamaRoster | null },
): void {
  const hid = String(handshakeId ?? '').trim()
  if (!hid) return
  const t = typeof url === 'string' ? url.trim() : ''
  if (!t) {
    hostAdvertisedMvpDirectByHandshake.delete(hid)
    return
  }
  const owner =
    meta && 'ownerDeviceId' in meta
      ? meta.ownerDeviceId == null
        ? null
        : String(meta.ownerDeviceId).trim() || null
      : null
  const adSource: HostAiPeerBeapAdSource =
    meta?.adSource === 'relay' ? 'relay' : meta?.adSource === 'ledger_hydration' ? 'ledger_hydration' : 'http_header'
  hostAdvertisedMvpDirectByHandshake.set(hid, {
    url: normalizeP2pIngestUrl(t),
    ownerDeviceId: owner,
    adSource,
    ollamaRoster: meta?.ollamaRoster,
  })
}

/** Drop poisoned peer “advertisement” (e.g. this sandbox’s own BEAP URL) from the in-memory map. */
export function clearHostAdvertisedMvpDirectForHandshake(handshakeId: string): void {
  const hid = String(handshakeId ?? '').trim()
  if (!hid) return
  hostAdvertisedMvpDirectByHandshake.delete(hid)
}

export function peekHostAdvertisedMvpDirectEntry(handshakeId: string): PeerHeaderEntry | null {
  const hid = String(handshakeId ?? '').trim()
  if (!hid) return null
  return hostAdvertisedMvpDirectByHandshake.get(hid) ?? null
}

/**
 * Hydrate the in-memory peer Host BEAP advertisement map from persisted handshake rows.
 * Call once early in a Sandbox session (e.g. first `listSandboxHostInternalInferenceTargets`) so
 * `resolveHostAiRoute` sees a `peerDirectAdvertisement` when the DB already holds a verified LAN ingest
 * but no relay/header ad has arrived in this process yet.
 *
 * **Freshness:** `HandshakeRecord` has no `last_seen_at`. We do not apply a wall-clock age cut-off on
 * `activated_at` / `created_at` because long-lived ACTIVE pairs would never hydrate. Rows are still
 * gated by ACTIVE, internal, `assertRecordForServiceRpc`, sandbox→host roles, and MVP direct_lan class.
 */
export async function hydrateHostAdvertisedMapFromLedger(
  db: any,
  getActiveHandshakes: () => Promise<HandshakeRecord[]>,
  logTag: string = 'hydrate',
): Promise<{ hydrated: number; skipped: number }> {
  let hydrated = 0
  let skipped = 0
  if (!db) {
    console.log(`[HOST_AI_MAP_HYDRATION] ${JSON.stringify({ tag: logTag, hydrated: 0, skipped: 0, reason: 'no_db' })}`)
    return { hydrated: 0, skipped: 0 }
  }

  const records = await getActiveHandshakes()
  const localId = getInstanceId().trim()

  for (const rec of records) {
    const hid = String(rec.handshake_id ?? '').trim()
    if (!hid) {
      skipped++
      continue
    }
    if (peekHostAdvertisedMvpDirectEntry(hid)) {
      skipped++
      continue
    }
    if (rec.handshake_type !== 'internal' || rec.state !== HandshakeState.ACTIVE) {
      skipped++
      continue
    }
    if (!assertLedgerRolesSandboxToHost(rec).ok) {
      skipped++
      continue
    }
    const roles = deriveInternalHostAiPeerRoles(rec, localId)
    if (!roles.ok || roles.localRole !== 'sandbox' || roles.peerRole !== 'host') {
      skipped++
      continue
    }
    const ar = assertRecordForServiceRpc(rec)
    if (!ar.ok) {
      skipped++
      continue
    }
    const urlRaw = (ar.record.p2p_endpoint ?? '').trim()
    if (!urlRaw) {
      skipped++
      continue
    }
    if (p2pEndpointMvpClass(db, urlRaw) !== 'direct_lan') {
      skipped++
      continue
    }
    if (ingestUrlMatchesThisDevicesMvpDirectBeap(db, urlRaw)) {
      skipped++
      continue
    }
    const owner = (coordinationDeviceIdForHandshakeDeviceRole(ar.record, 'host') ?? '').trim()
    if (!owner) {
      skipped++
      continue
    }

    const ledgerLastSeenAt =
      (typeof ar.record.activated_at === 'string' && ar.record.activated_at.trim()) ||
      (typeof ar.record.created_at === 'string' && ar.record.created_at.trim()) ||
      null

    const url = normalizeP2pIngestUrl(urlRaw)
    hostAdvertisedMvpDirectByHandshake.set(hid, {
      url,
      ownerDeviceId: owner,
      adSource: 'ledger_hydration',
      ollamaRoster: null,
      hydratedAt: Date.now(),
      ledgerLastSeenAt,
    })
    hydrated++
  }

  console.log(
    `[HOST_AI_MAP_HYDRATION] ${JSON.stringify({ tag: logTag, hydrated, skipped, total: records.length })}`,
  )
  return { hydrated, skipped }
}

/** Sandbox: last Host-advertised MVP direct ingest URL seen for this handshake (response header), if any. */
export function peekHostAdvertisedMvpDirectP2pEndpoint(handshakeId: string): string | null {
  return peekHostAdvertisedMvpDirectEntry(handshakeId)?.url ?? null
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

function ledgerRowHasViableDirectBeapForMapRefresh(db: any, record: HandshakeRecord): boolean {
  const ledgerRaw = (record.p2p_endpoint ?? '').trim()
  if (!ledgerRaw || !db) return false
  const lower = ledgerRaw.toLowerCase()
  if (!lower.startsWith('http://') && !lower.startsWith('https://')) return false
  if (!ledgerRaw.includes('/beap/')) return false
  if (p2pEndpointKind(db, ledgerRaw) === 'relay') return false
  if (p2pEndpointMvpClass(db, ledgerRaw) !== 'direct_lan') return false
  if (ingestUrlMatchesThisDevicesMvpDirectBeap(db, ledgerRaw)) return false
  return Boolean((coordinationDeviceIdForHandshakeDeviceRole(record, 'host') ?? '').trim())
}

/**
 * When the in-memory BEAP advertisement map is empty but the ledger already holds a usable LAN ingest,
 * POST `p2p_host_ai_direct_beap_ad_request` to coordination (non-blocking). The inbound ad handler
 * repopulates the map for the next selector/probe cycle.
 */
export function requestBeapAdRefreshIfMapMiss(db: any, hid: string, record: HandshakeRecord, context: string): void {
  void runRequestBeapAdRefreshIfMapMiss(db, hid, record, context).catch((err: unknown) => {
    console.log(
      `[HOST_AI_MAP_REFRESH] ${JSON.stringify({
        hid: String(hid ?? '').trim(),
        err: String(err),
        context,
        stage: 'unhandled',
      })}`,
    )
  })
}

async function runRequestBeapAdRefreshIfMapMiss(
  db: any,
  hid: string,
  record: HandshakeRecord,
  context: string,
): Promise<void> {
  const hidT = String(hid ?? '').trim()
  if (!db || !hidT || !record) return
  if (peekHostAdvertisedMvpDirectEntry(hidT)?.url?.trim()) return
  if (!ledgerRowHasViableDirectBeapForMapRefresh(db, record)) return

  const localId = getInstanceId().trim()
  const modeHint = String(getOrchestratorMode().mode)
  const ledgerSum = getHostAiLedgerRoleSummaryFromDb(db, localId, modeHint)
  if (!ledgerSum.can_probe_host_endpoint || ledgerSum.effective_host_ai_role !== 'sandbox') return

  const cfg = getP2PConfig(db)
  if (!cfg.use_coordination || !cfg.coordination_url?.trim()) return

  const dr = deriveInternalHostAiPeerRoles(record, localId)
  if (!dr.ok || dr.localRole !== 'sandbox' || dr.peerRole !== 'host') return

  const now = Date.now()
  const last = lastBeapAdRefreshOnMapMissAtByHandshake.get(hidT) ?? 0
  if (now - last < MAP_MISS_BEAP_AD_REFRESH_MIN_INTERVAL_MS) return
  lastBeapAdRefreshOnMapMissAtByHandshake.set(hidT, now)

  const token = getAccessToken()
  if (!token?.trim()) {
    console.log(`[HOST_AI_MAP_REFRESH] ${JSON.stringify({ hid: hidT, reason: 'no_bearer', context })}`)
    return
  }

  console.log(
    `[HOST_AI_MAP_REFRESH] ${JSON.stringify({
      hid: hidT,
      peer: dr.peerCoordinationDeviceId,
      context,
      action: 'p2p_host_ai_direct_beap_ad_request',
    })}`,
  )

  const { postHostAiDirectBeapAdRequestToCoordination } = await import('./p2pSignalRelayPost')
  const postRes = await postHostAiDirectBeapAdRequestToCoordination({
    db,
    handshakeId: hidT,
    senderDeviceId: dr.localCoordinationDeviceId,
    receiverDeviceId: dr.peerCoordinationDeviceId,
  })

  if (!postRes.ok) {
    console.log(
      `[HOST_AI_MAP_REFRESH] ${JSON.stringify({ hid: hidT, context, status: postRes.status, ok: false })}`,
    )
  }
}

type DenyCode =
  | typeof InternalInferenceErrorCode.HOST_AI_ENDPOINT_OWNER_MISMATCH
  | typeof InternalInferenceErrorCode.HOST_DIRECT_ENDPOINT_MISSING
  | typeof InternalInferenceErrorCode.HOST_AI_ENDPOINT_PROVENANCE_MISSING
  | typeof InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING

export type SandboxToHostHttpDirectIngestResult =
  | {
      ok: true
      url: string
      selected_endpoint_source: 'peer_advertised_header' | 'relay_control_plane' | 'internal_handshake_ledger'
      /** Same as `selected_endpoint_source` — explicit provenance; never "none" for a successful select. */
      selected_endpoint_provenance: HostAiSelectedEndpointProvenance
      local_beap_endpoint: string | null
      peer_advertised_beap_endpoint: string | null
      ledger_p2p_endpoint: string
      repaired_from_local_endpoint: boolean
      resolutionCategory: 'accepted_peer_header' | 'accepted_relay_ad' | 'accepted_ledger'
      hostDeviceId: string
      /** Optional: bound candidate (accepted) for logs/diagnostics. */
      acceptedCandidate: HostAiEndpointCandidate | null
    }
  | {
      ok: false
      code: DenyCode
      local_beap_endpoint: string | null
      peer_advertised_beap_endpoint: string | null
      ledger_p2p_endpoint: string
      selected_endpoint_provenance: HostAiSelectedEndpointProvenance
      resolutionCategory: HostAiEndpointResolutionCategory
      /** Rejected or partial candidate, if a URL was in play. */
      rejectedCandidate: HostAiEndpointCandidate | null
      /** For logs: distinguish missing peer ad vs self vs owner mismatch vs provenance. */
      host_ai_endpoint_deny_detail:
        | 'missing_peer_advertisement'
        | 'self_local_beap_selected'
        | 'host_owner_mismatch'
        | 'peer_ad_owner_sandbox'
        | 'provenance_incomplete'
        | 'no_endpoint'
        | 'stale'
        | 'peer_host_beap_not_advertised'
      hostDeviceId: string
    }

function newIso(): string {
  return new Date().toISOString()
}

function buildEndpointCandidate(
  ttlMs: number | null,
  p: {
    url: string
    source: HostAiEndpointCandidate['source']
    hostDeviceId: string
    handshakeId: string
    observedBy: string
    trust: HostAiEndpointCandidate['trust_level']
    ownerRole: 'host' | 'sandbox' | 'unknown'
    reject: string | null
  },
): HostAiEndpointCandidate {
  return {
    url: p.url,
    source: p.source,
    owner_device_id: p.hostDeviceId,
    owner_role: p.ownerRole,
    handshake_id: p.handshakeId,
    observed_by_device_id: p.observedBy,
    created_at: newIso(),
    expires_at: null,
    ttl_ms: ttlMs,
    trust_level: p.trust,
    rejection_reason: p.reject,
  }
}

/**
 * Sandbox → host **HTTP direct** only: pick the POST base URL that is *not* this process’s own MVP direct
 * BEAP, preferring a peer-issued advertisement (response header) over the internal handshake `p2p_endpoint`
 * row, which can be corrupt or conflate local BEAP with the host peer.
 */
export function resolveSandboxToHostHttpDirectIngest(
  db: any,
  handshakeId: string,
  record: HandshakeRecord,
  callerIngestUrl: string,
): SandboxToHostHttpDirectIngestResult {
  const hid = String(handshakeId ?? '').trim()
  const observedBy = getInstanceId().trim()
  const localPub = getHostPublishedMvpDirectP2pIngestUrl(db)
  const hostDeviceId = (coordinationDeviceIdForHandshakeDeviceRole(record, 'host') ?? '').trim()
  const peerEnt = peekHostAdvertisedMvpDirectEntry(hid)
  const peerAd = peerEnt?.url ?? null
  const peerAdOwner = peerEnt?.ownerDeviceId ?? null
  const ledger = typeof record.p2p_endpoint === 'string' ? record.p2p_endpoint.trim() : ''
  /** Policy TTL is surfaced on host inference policy elsewhere; candidates keep ttl null here. */
  const policyTtlMs: number | null = null
  const fromCaller = typeof callerIngestUrl === 'string' ? callerIngestUrl.trim() : ''
  const candidate = fromCaller || ledger
  const repairedFromLocal = Boolean(ledger && ingestUrlMatchesThisDevicesMvpDirectBeap(db, ledger))

  const buildCand = (args: Parameters<typeof buildEndpointCandidate>[1]) => buildEndpointCandidate(policyTtlMs, args)

  const fail = (
    code: DenyCode,
    category: HostAiEndpointResolutionCategory,
    detail: SandboxToHostHttpDirectIngestResult extends { ok: false }
      ? SandboxToHostHttpDirectIngestResult['host_ai_endpoint_deny_detail']
      : never,
    prov: HostAiSelectedEndpointProvenance,
    rej: HostAiEndpointCandidate | null,
  ): SandboxToHostHttpDirectIngestResult => ({
    ok: false,
    code,
    local_beap_endpoint: localPub,
    peer_advertised_beap_endpoint: peerAd,
    ledger_p2p_endpoint: ledger,
    selected_endpoint_provenance: prov,
    resolutionCategory: category,
    rejectedCandidate: rej,
    host_ai_endpoint_deny_detail: detail,
    hostDeviceId,
  })

  if (peerAd) {
    const fromRelay = peerEnt?.adSource === 'relay'
    const peerSrc: 'peer_advertised_header' | 'relay_control_plane' = fromRelay
      ? 'relay_control_plane'
      : 'peer_advertised_header'
    const peerProv: HostAiSelectedEndpointProvenance = peerSrc

    if (ingestUrlMatchesThisDevicesMvpDirectBeap(db, peerAd)) {
      clearHostAdvertisedMvpDirectForHandshake(hid)
      return fail(
        InternalInferenceErrorCode.HOST_AI_ENDPOINT_OWNER_MISMATCH,
        'rejected_self_local_beap',
        'self_local_beap_selected',
        peerProv,
        buildCand({
          url: peerAd,
          source: peerSrc,
          hostDeviceId: hostDeviceId || 'unknown',
          handshakeId: hid,
          observedBy,
          trust: 'local_only',
          ownerRole: 'unknown',
          reject: 'peer_header_matches_local_beap',
        }),
      )
    }
    if (peerAdOwner && peerAdOwner === observedBy && peerAdOwner !== hostDeviceId) {
      return fail(
        InternalInferenceErrorCode.HOST_AI_ENDPOINT_OWNER_MISMATCH,
        'rejected_peer_ad_owner_sandbox',
        'peer_ad_owner_sandbox',
        peerProv,
        buildCand({
          url: peerAd,
          source: peerSrc,
          hostDeviceId: hostDeviceId || peerAdOwner,
          handshakeId: hid,
          observedBy,
          trust: 'local_only',
          ownerRole: 'sandbox',
          reject: 'peer_ad_owner_is_local_sandbox',
        }),
      )
    }
    if (peerAdOwner && hostDeviceId && peerAdOwner !== hostDeviceId) {
      return fail(
        InternalInferenceErrorCode.HOST_AI_ENDPOINT_OWNER_MISMATCH,
        'rejected_inconsistent_owner',
        'host_owner_mismatch',
        peerProv,
        buildCand({
          url: peerAd,
          source: peerSrc,
          hostDeviceId,
          handshakeId: hid,
          observedBy,
          trust: 'unknown',
          ownerRole: 'host',
          reject: 'peer_ad_owner_not_handshake_host',
        }),
      )
    }
    if (!hostDeviceId) {
      return fail(
        InternalInferenceErrorCode.HOST_AI_ENDPOINT_PROVENANCE_MISSING,
        'rejected_provenance_incomplete',
        'provenance_incomplete',
        peerProv,
        buildCand({
          url: peerAd,
          source: peerSrc,
          hostDeviceId: 'unknown',
          handshakeId: hid,
          observedBy,
          trust: 'unknown',
          ownerRole: 'unknown',
          reject: 'host_coordination_id_missing',
        }),
      )
    }
    const url = normalizeP2pIngestUrl(peerAd)
    if (peerEnt?.adSource === 'ledger_hydration') {
      return {
        ok: true,
        url,
        selected_endpoint_source: 'internal_handshake_ledger',
        selected_endpoint_provenance: 'internal_handshake_ledger',
        local_beap_endpoint: localPub,
        peer_advertised_beap_endpoint: peerAd,
        ledger_p2p_endpoint: ledger,
        repaired_from_local_endpoint: repairedFromLocal,
        resolutionCategory: 'accepted_ledger',
        hostDeviceId,
        acceptedCandidate: buildCand({
          url,
          source: 'internal_handshake_ledger',
          hostDeviceId,
          handshakeId: hid,
          observedBy,
          trust: 'ledger_trusted',
          ownerRole: 'host',
          reject: null,
        }),
      }
    }
    if (fromRelay) {
      return {
        ok: true,
        url,
        selected_endpoint_source: 'relay_control_plane',
        selected_endpoint_provenance: 'relay_control_plane',
        local_beap_endpoint: localPub,
        peer_advertised_beap_endpoint: peerAd,
        ledger_p2p_endpoint: ledger,
        repaired_from_local_endpoint: repairedFromLocal,
        resolutionCategory: 'accepted_relay_ad',
        hostDeviceId,
        acceptedCandidate: buildCand({
          url,
          source: 'relay_control_plane',
          hostDeviceId,
          handshakeId: hid,
          observedBy,
          trust: 'relay_authenticated',
          ownerRole: 'host',
          reject: null,
        }),
      }
    }
    return {
      ok: true,
      url,
      selected_endpoint_source: 'peer_advertised_header',
      selected_endpoint_provenance: 'peer_advertised_header',
      local_beap_endpoint: localPub,
      peer_advertised_beap_endpoint: peerAd,
      ledger_p2p_endpoint: ledger,
      repaired_from_local_endpoint: repairedFromLocal,
      resolutionCategory: 'accepted_peer_header',
      hostDeviceId,
      acceptedCandidate: buildCand({
        url,
        source: 'peer_advertised_header',
        hostDeviceId,
        handshakeId: hid,
        observedBy,
        trust: 'peer_signed',
        ownerRole: 'host',
        reject: null,
      }),
    }
  }
  if (!candidate) {
    return fail(
      InternalInferenceErrorCode.HOST_DIRECT_ENDPOINT_MISSING,
      'rejected_no_endpoint',
      'no_endpoint',
      'not_applicable',
      null,
    )
  }
  if (ingestUrlMatchesThisDevicesMvpDirectBeap(db, candidate)) {
    /**
     * No peer-issued (header/relay) host BEAP: ledger/caller only sees this device’s own ingest.
     * Do not use local BEAP as the Host path or mislabel it as a peer error — Host must advertise first.
     */
    return fail(
      InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING,
      'rejected_no_peer_host_beap',
      'peer_host_beap_not_advertised',
      'local_beap',
      buildCand({
        url: candidate,
        source: 'local_beap',
        hostDeviceId: hostDeviceId || 'unknown',
        handshakeId: hid,
        observedBy,
        trust: 'local_only',
        ownerRole: 'unknown',
        reject: 'ledger_caller_url_is_this_devices_beap',
      }),
    )
  }
  if (!hostDeviceId) {
    return fail(
      InternalInferenceErrorCode.HOST_AI_ENDPOINT_PROVENANCE_MISSING,
      'rejected_provenance_incomplete',
      'provenance_incomplete',
      'internal_handshake_ledger',
      buildCand({
        url: candidate,
        source: 'internal_handshake_ledger',
        hostDeviceId: 'unknown',
        handshakeId: hid,
        observedBy,
        trust: 'unknown',
        ownerRole: 'unknown',
        reject: 'host_coordination_id_missing',
      }),
    )
  }
  const url = normalizeP2pIngestUrl(candidate)
  return {
    ok: true,
    url,
    selected_endpoint_source: 'internal_handshake_ledger',
    selected_endpoint_provenance: 'internal_handshake_ledger',
    local_beap_endpoint: localPub,
    peer_advertised_beap_endpoint: null,
    ledger_p2p_endpoint: ledger,
    repaired_from_local_endpoint: repairedFromLocal,
    resolutionCategory: 'accepted_ledger',
    hostDeviceId,
    acceptedCandidate: buildCand({
      url,
      source: 'internal_handshake_ledger',
      hostDeviceId,
      handshakeId: hid,
      observedBy,
      trust: 'ledger_trusted',
      ownerRole: 'host',
      reject: null,
    }),
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

function parseHostAiOllamaRosterFromRelayHostAiRoute(raw: Record<string, unknown>): HostAiPeerAdvertisedOllamaRoster | null {
  const har = raw.host_ai_route
  if (!har || typeof har !== 'object' || Array.isArray(har)) return null
  const cap = (har as Record<string, unknown>).capabilities
  if (!cap || typeof cap !== 'object' || Array.isArray(cap)) return null
  const c = cap as Record<string, unknown>
  const mc =
    typeof c.models_count === 'number' && Number.isFinite(c.models_count) ? Math.max(0, Math.floor(c.models_count)) : null
  const activeIdRaw =
    typeof c.active_model_id === 'string' && c.active_model_id.trim()
      ? c.active_model_id.trim()
      : typeof c.active_model_name === 'string' && c.active_model_name.trim()
        ? c.active_model_name.trim()
        : null
  const activeNameRaw =
    typeof c.active_model_name === 'string' && c.active_model_name.trim()
      ? c.active_model_name.trim()
      : activeIdRaw
  const modelSource = typeof c.model_source === 'string' && c.model_source.trim() ? c.model_source.trim() : null
  /** Product: Host Ollama remote inference uses one loaded local model at a time (VRAM). */
  const maxConcurrentLocalModels = 1

  const modelsOut: HostAiBeapAdOllamaModelWireEntry[] = []
  if (Array.isArray(c.models)) {
    for (const m of c.models) {
      if (!m || typeof m !== 'object' || Array.isArray(m)) continue
      const mo = m as Record<string, unknown>
      const name =
        typeof mo.name === 'string' && mo.name.trim()
          ? mo.name.trim()
          : typeof mo.id === 'string' && mo.id.trim()
            ? mo.id.trim()
            : ''
      if (!name) continue
      const id = typeof mo.id === 'string' && mo.id.trim() ? mo.id.trim() : name
      const available = mo.available !== false
      const active = mo.active === true || (activeIdRaw != null && (id === activeIdRaw || name === activeIdRaw))
      modelsOut.push({ id, name, provider: 'ollama', available, active })
    }
  }

  if (modelsOut.length === 0 && !activeIdRaw && (mc == null || mc === 0)) {
    return null
  }
  let active_model_id: string | null = activeIdRaw
  let active_model_name: string | null = activeNameRaw
  if (!active_model_id && modelsOut.length > 0) {
    const one = modelsOut.find((m) => m.active)
    if (one) {
      active_model_id = one.id
      active_model_name = one.name
    }
  }

  return {
    models: modelsOut,
    active_model_id,
    active_model_name,
    model_source: modelSource,
    max_concurrent_local_models: maxConcurrentLocalModels,
  }
}

/**
 * Sandbox: apply Host AI direct-BEAP advertisement delivered on the **authenticated** coordination
 * relay (`p2p_host_ai_direct_beap_ad`) before the first successful HTTP cap probe.
 * Caller must not invoke this for WebRTC offer/ICE frames.
 */
export function applyHostAiDirectBeapAdFromRelayPayload(
  db: any,
  raw: Record<string, unknown>,
  relayMessageId: string,
): { ok: true } | { ok: false; reason: string } {
  const hid = typeof raw.handshake_id === 'string' ? raw.handshake_id.trim() : ''
  const sender = typeof raw.sender_device_id === 'string' ? raw.sender_device_id.trim() : ''
  const advRaw = typeof raw.endpoint_url === 'string' ? raw.endpoint_url.trim() : ''
  const adSeq = raw.ad_seq
  const expRaw = typeof raw.expires_at === 'string' ? raw.expires_at.trim() : ''
  const reject = (reason: string): { ok: false; reason: string } => {
    console.log(`[HOST_AI_ENDPOINT_AD_REJECTED] ${JSON.stringify({ handshakeId: hid || null, reason, relayMessageId })}`)
    return { ok: false, reason }
  }
  if (!db || !hid) {
    console.log(
      `[HOST_AI_ENDPOINT_AD_RECEIVED] ${JSON.stringify({
        handshakeId: null,
        ownerDeviceId: sender || null,
        urlPresent: Boolean(advRaw),
        source: 'relay',
        seq: adSeq,
        expiresAt: expRaw || null,
        ok: false,
        reason: 'no_db',
        relayMessageId,
      })}`,
    )
    return reject('no_db')
  }
  console.log(
    `[HOST_AI_ENDPOINT_AD_RECEIVED] ${JSON.stringify({
      handshakeId: hid,
      ownerDeviceId: sender || null,
      urlPresent: Boolean(advRaw),
      source: 'relay',
      seq: adSeq,
      expiresAt: expRaw || null,
      relayMessageId,
    })}`,
  )
  if (typeof adSeq !== 'number' || !Number.isInteger(adSeq) || adSeq < 0) {
    console.log(`[HOST_AI_ENDPOINT_AD_REJECTED] ${JSON.stringify({ handshakeId: hid, reason: 'invalid_seq', relayMessageId })}`)
    return { ok: false, reason: 'invalid_seq' }
  }
  const prevSeq = hostAiRelayBeapAdLastSeq.get(hid) ?? -1
  if (adSeq <= prevSeq) {
    console.log(
      `[HOST_AI_ENDPOINT_AD_REJECTED] ${JSON.stringify({
        handshakeId: hid,
        reason: 'stale_seq',
        seq: adSeq,
        prevSeq,
        relayMessageId,
      })}`,
    )
    return { ok: false, reason: 'stale_seq' }
  }
  if (expRaw) {
    const expMs = Date.parse(expRaw)
    if (Number.isNaN(expMs) || expMs < Date.now()) {
      console.log(`[HOST_AI_ENDPOINT_AD_REJECTED] ${JSON.stringify({ handshakeId: hid, reason: 'expired', relayMessageId })}`)
      return { ok: false, reason: 'expired' }
    }
  }
  if (!advRaw) {
    console.log(`[HOST_AI_ENDPOINT_AD_REJECTED] ${JSON.stringify({ handshakeId: hid, reason: 'no_endpoint_url', relayMessageId })}`)
    return { ok: false, reason: 'no_endpoint_url' }
  }
  if (p2pEndpointMvpClass(db, advRaw) !== 'direct_lan') {
    console.log(`[HOST_AI_ENDPOINT_AD_REJECTED] ${JSON.stringify({ handshakeId: hid, reason: 'not_mvp_direct', relayMessageId })}`)
    return { ok: false, reason: 'not_mvp_direct' }
  }
  if (ingestUrlMatchesThisDevicesMvpDirectBeap(db, advRaw)) {
    console.log(
      `[HOST_AI_ENDPOINT_AD_REJECTED] ${JSON.stringify({ handshakeId: hid, reason: 'same_as_local_sandbox_beap', relayMessageId })}`,
    )
    return { ok: false, reason: 'same_as_local_sandbox_beap' }
  }
  const r0 = getHandshakeRecord(db, hid)
  const ar = assertRecordForServiceRpc(r0)
  if (!ar.ok) {
    console.log(`[HOST_AI_ENDPOINT_AD_REJECTED] ${JSON.stringify({ handshakeId: hid, reason: 'not_active_internal', relayMessageId })}`)
    return { ok: false, reason: 'not_active_internal' }
  }
  if (!assertLedgerRolesSandboxToHost(ar.record).ok) {
    console.log(`[HOST_AI_ENDPOINT_AD_REJECTED] ${JSON.stringify({ handshakeId: hid, reason: 'not_sandbox_to_host', relayMessageId })}`)
    return { ok: false, reason: 'not_sandbox_to_host' }
  }
  const expectHost = (coordinationDeviceIdForHandshakeDeviceRole(ar.record, 'host') ?? '').trim()
  if (!expectHost || sender !== expectHost) {
    console.log(
      `[HOST_AI_ENDPOINT_AD_REJECTED] ${JSON.stringify({
        handshakeId: hid,
        reason: 'wrong_owner',
        expectedHostDeviceId: expectHost,
        senderDeviceId: sender,
        relayMessageId,
      })}`,
    )
    return { ok: false, reason: 'wrong_owner' }
  }
  if (raw.owner_role != null && raw.owner_role !== 'host') {
    console.log(`[HOST_AI_ENDPOINT_AD_REJECTED] ${JSON.stringify({ handshakeId: hid, reason: 'owner_role_not_host', relayMessageId })}`)
    return { ok: false, reason: 'owner_role' }
  }
  hostAiRelayBeapAdLastSeq.set(hid, adSeq)
  const ollamaRoster = parseHostAiOllamaRosterFromRelayHostAiRoute(raw)
  if (ollamaRoster) {
    console.log(
      `[HOST_AI_MODEL_ROSTER_RECEIVED] ${JSON.stringify({
        handshakeId: hid,
        hostDeviceId: expectHost,
        models: ollamaRoster.models.map((m) => m.name),
        activeModelId: ollamaRoster.active_model_id,
        source: 'relay_beap_ad',
      })}`,
    )
  }
  hostAdvertisedMvpDirectByHandshake.set(hid, {
    url: normalizeP2pIngestUrl(advRaw),
    ownerDeviceId: expectHost,
    adSource: 'relay',
    ollamaRoster: ollamaRoster ?? null,
  })
  const r = ar.record
  const current = (r.p2p_endpoint ?? '').trim()
  const newNorm = normalizeP2pIngestUrl(advRaw)
  const oldNorm = current ? normalizeP2pIngestUrl(current) : ''
  const dbUpdated = newNorm !== oldNorm
  if (dbUpdated) {
    const oldKind = kindForLog(db, current || null)
    const newKind = kindForLog(db, advRaw)
    console.log(
      `[HOST_INFERENCE_P2P] endpoint_relay_ad_repair_begin handshake=${hid} old=${oldKind} new=${newKind}`,
    )
    const next: HandshakeRecord = { ...r, p2p_endpoint: newNorm }
    updateHandshakeRecord(db, next)
  }
  invalidateP2pEnsureCachesForHandshake(hid)
  console.log(
    `[HOST_AI_ENDPOINT_AD_ACCEPTED] ${JSON.stringify({
      handshakeId: hid,
      ownerDeviceId: expectHost,
      endpointKind: 'direct_lan',
      dbUpdated,
      endpoint: newNorm,
      seq: adSeq,
      relayMessageId,
    })}`,
  )
  return { ok: true }
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
  const hostId = (coordinationDeviceIdForHandshakeDeviceRole(ar.record, 'host') ?? '').trim() || null
  const prev = hostAdvertisedMvpDirectByHandshake.get(hid)
  hostAdvertisedMvpDirectByHandshake.set(hid, {
    url: normalizeP2pIngestUrl(advRaw),
    ownerDeviceId: hostId,
    adSource: 'http_header',
    ollamaRoster: prev?.ollamaRoster ?? null,
  })
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
  const mode = getOrchestratorMode().mode
  const ledgerRoles = getHostAiLedgerRoleSummaryFromDb(db, getInstanceId().trim(), String(mode))

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
    const promo = hostAdvertisedMvpDirectByHandshake.get(hid)
    const promoRaw = promo?.url
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
    if (ledgerRoles.can_publish_host_endpoint) {
      console.log(
        `[HOST_INFERENCE_P2P] endpoint_repair_pass context=${context} host_publishes_mvp_direct=${hostUrl}`,
      )
    } else {
      console.log(
        `[HOST_INFERENCE_P2P] endpoint_repair_pass context=${context} role=sandbox_side local_mvp_direct_listener=${hostUrl} effective_host_ai_role=${ledgerRoles.effective_host_ai_role} can_publish_host_endpoint=false`,
      )
    }
  } else {
    console.log(`[HOST_INFERENCE_P2P] endpoint_repair_pass context=${context} host_publishes_mvp_direct=(none)`)
  }
  if (ledgerRoles.can_publish_host_endpoint) {
    void import('./hostAiDirectBeapAdPublish')
      .then((m) => m.publishHostAiDirectBeapAdvertisementsForEligibleHost(db, { context }))
      .catch(() => {
        /* no-op */
      })
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
