/**
 * STEP 4: When the Host’s LAN P2P URL changes, Sandbox can repair the stored counterparty
 * `p2p_endpoint` from the `X-BEAP-Direct-P2P-Endpoint` header on direct Host responses (MVP: no relay).
 */

import { getHandshakeRecord, listHandshakeRecords, updateHandshakeRecord } from '../handshake/db'
import { getInstanceId, getOrchestratorMode } from '../orchestrator/orchestratorModeStore'
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
  p2pEndpointKind,
  p2pEndpointMvpClass,
  type P2pMvpEndpointClass,
} from './policy'

export const P2P_DIRECT_P2P_ENDPOINT_HEADER = 'X-BEAP-Direct-P2P-Endpoint'

/** In-memory only (process lifetime). `relay` = authenticated coordination `p2p_host_ai_direct_beap_ad`. */
export type HostAiPeerBeapAdSource = 'http_header' | 'relay'

type PeerHeaderEntry = { url: string; ownerDeviceId: string | null; adSource: HostAiPeerBeapAdSource }

let appP2pLedgerStartupPassDone = false

/** Last Host-advertised MVP direct ingest per handshake (Sandbox; from relay first, or HTTP response header). */
const hostAdvertisedMvpDirectByHandshake = new Map<string, PeerHeaderEntry>()

/** Monotonic ad_seq for relay push only (rejects stale). */
const hostAiRelayBeapAdLastSeq = new Map<string, number>()

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
}

/** @internal — vitest: seed the in-memory map as if the peer Host advertised a header. */
export function setHostAdvertisedMvpDirectForTests(
  handshakeId: string,
  url: string | null | undefined,
  meta?: { ownerDeviceId?: string | null; adSource?: HostAiPeerBeapAdSource },
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
  const adSource: HostAiPeerBeapAdSource = meta?.adSource === 'relay' ? 'relay' : 'http_header'
  hostAdvertisedMvpDirectByHandshake.set(hid, {
    url: normalizeP2pIngestUrl(t),
    ownerDeviceId: owner,
    adSource,
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
  if (!db || !hid) {
    console.log(
      `[HOST_AI_ENDPOINT_AD_RECEIVED] ok=false reason=no_db relay_message_id=${relayMessageId} handshake=(n/a)`,
    )
    return { ok: false, reason: 'no_db' }
  }
  console.log(
    `[HOST_AI_ENDPOINT_AD_RECEIVED] handshake=${hid} sender=${sender} seq=${adSeq} relay_message_id=${relayMessageId}`,
  )
  if (typeof adSeq !== 'number' || !Number.isInteger(adSeq) || adSeq < 0) {
    console.log(
      `[HOST_AI_ENDPOINT_AD_ACCEPTED] ok=false reason=invalid_seq handshake=${hid} relay_message_id=${relayMessageId}`,
    )
    return { ok: false, reason: 'invalid_seq' }
  }
  const prevSeq = hostAiRelayBeapAdLastSeq.get(hid) ?? -1
  if (adSeq <= prevSeq) {
    console.log(
      `[HOST_AI_ENDPOINT_AD_ACCEPTED] ok=false reason=stale_seq handshake=${hid} seq=${adSeq} prev_seq=${prevSeq} relay_message_id=${relayMessageId}`,
    )
    return { ok: false, reason: 'stale_seq' }
  }
  if (expRaw) {
    const expMs = Date.parse(expRaw)
    if (Number.isNaN(expMs) || expMs < Date.now()) {
      console.log(
        `[HOST_AI_ENDPOINT_AD_ACCEPTED] ok=false reason=expired handshake=${hid} relay_message_id=${relayMessageId}`,
      )
      return { ok: false, reason: 'expired' }
    }
  }
  if (!advRaw) {
    console.log(
      `[HOST_AI_ENDPOINT_AD_ACCEPTED] ok=false reason=no_endpoint_url handshake=${hid} relay_message_id=${relayMessageId}`,
    )
    return { ok: false, reason: 'no_endpoint_url' }
  }
  if (p2pEndpointMvpClass(db, advRaw) !== 'direct_lan') {
    console.log(
      `[HOST_AI_ENDPOINT_AD_ACCEPTED] ok=false reason=not_mvp_direct handshake=${hid} relay_message_id=${relayMessageId}`,
    )
    return { ok: false, reason: 'not_mvp_direct' }
  }
  if (ingestUrlMatchesThisDevicesMvpDirectBeap(db, advRaw)) {
    console.log(
      `[HOST_AI_ENDPOINT_AD_ACCEPTED] ok=false reason=same_as_local_sandbox_beap handshake=${hid} relay_message_id=${relayMessageId}`,
    )
    return { ok: false, reason: 'same_as_local_sandbox_beap' }
  }
  const r0 = getHandshakeRecord(db, hid)
  const ar = assertRecordForServiceRpc(r0)
  if (!ar.ok) {
    console.log(
      `[HOST_AI_ENDPOINT_AD_ACCEPTED] ok=false reason=not_active_internal_handshake handshake=${hid} relay_message_id=${relayMessageId}`,
    )
    return { ok: false, reason: 'not_active_internal' }
  }
  if (!assertLedgerRolesSandboxToHost(ar.record).ok) {
    console.log(
      `[HOST_AI_ENDPOINT_AD_ACCEPTED] ok=false reason=not_sandbox_to_host_ledger handshake=${hid} relay_message_id=${relayMessageId}`,
    )
    return { ok: false, reason: 'not_sandbox_to_host' }
  }
  const expectHost = (coordinationDeviceIdForHandshakeDeviceRole(ar.record, 'host') ?? '').trim()
  if (!expectHost || sender !== expectHost) {
    console.log(
      `[HOST_AI_ENDPOINT_AD_ACCEPTED] ok=false reason=wrong_owner handshake=${hid} expected_host=${expectHost} sender=${sender} relay_message_id=${relayMessageId}`,
    )
    return { ok: false, reason: 'wrong_owner' }
  }
  if (raw.owner_role != null && raw.owner_role !== 'host') {
    console.log(
      `[HOST_AI_ENDPOINT_AD_ACCEPTED] ok=false reason=owner_role_not_host handshake=${hid} relay_message_id=${relayMessageId}`,
    )
    return { ok: false, reason: 'owner_role' }
  }
  hostAiRelayBeapAdLastSeq.set(hid, adSeq)
  hostAdvertisedMvpDirectByHandshake.set(hid, {
    url: normalizeP2pIngestUrl(advRaw),
    ownerDeviceId: expectHost,
    adSource: 'relay',
  })
  const r = ar.record
  const current = (r.p2p_endpoint ?? '').trim()
  const newNorm = normalizeP2pIngestUrl(advRaw)
  const oldNorm = current ? normalizeP2pIngestUrl(current) : ''
  if (newNorm !== oldNorm) {
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
    `[HOST_AI_ENDPOINT_AD_ACCEPTED] ok=true handshake=${hid} endpoint=${newNorm} seq=${adSeq} owner=${expectHost} relay_message_id=${relayMessageId}`,
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
  hostAdvertisedMvpDirectByHandshake.set(hid, {
    url: normalizeP2pIngestUrl(advRaw),
    ownerDeviceId: hostId,
    adSource: 'http_header',
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
