/**
 * Sandbox-only: coordination `p2p_host_ai_direct_beap_ad_request` to the paired Host.
 * - Legacy path: republish when direct-LAN BEAP map entry is missing.
 * - WebRTC path: after sealed-relay BEAP ad accepted, request Host offer (81ffe55a reactive trigger).
 * Does not publish Host AI from sandbox.
 */

import { getAccessToken } from '../../../src/auth/session'
import { listHandshakeRecords } from '../handshake/db'
import { HandshakeState, type HandshakeRecord } from '../handshake/types'
import { getInstanceId, getOrchestratorMode } from '../orchestrator/orchestratorModeStore'
import { getP2PConfig } from '../p2p/p2pConfig'
import { getHostAiLedgerRoleSummaryFromDb } from './hostAiEffectiveRole'
import { InternalInferenceErrorCode } from './errors'
import {
  ingestUrlMatchesThisDevicesMvpDirectBeap,
  peekHostAdvertisedMvpDirectEntry,
  requestBeapAdRefreshIfMapMiss,
  resolveSandboxToHostHttpDirectIngest,
} from './p2pEndpointRepair'
import { getP2pInferenceFlags } from './p2pInferenceFlags'
import { deriveInternalHostAiPeerRoles } from './policy'
import { postHostAiDirectBeapAdRequestToCoordination } from './p2pSignalRelayPost'

const lastRepublishRequestAtByHandshake = new Map<string, number>()
const SANDBOX_REPUBLISH_MIN_INTERVAL_MS = 15_000

/** One in-flight offer-request gate per handshake (debounced until DC/connecting or dc_wait timeout). */
const lastP2pOfferRequestByHandshake = new Map<string, { sentAt: number; adSeq: number }>()

/** @internal */
export function resetSandboxHostAiDirectBeapAdRequestStateForTests(): void {
  lastRepublishRequestAtByHandshake.clear()
  lastP2pOfferRequestByHandshake.clear()
}

async function p2pTransportAlreadyAdvancing(hid: string): Promise<boolean> {
  const { getSessionState, P2pSessionPhase } = await import('./p2pSession/p2pInferenceSessionManager')
  const { isP2pDataChannelUpForHandshake } = await import('./p2pSession/p2pSessionWait')
  if (isP2pDataChannelUpForHandshake(hid)) {
    return true
  }
  const st = getSessionState(hid)
  if (!st) {
    return false
  }
  return (
    st.phase === P2pSessionPhase.connecting ||
    st.phase === P2pSessionPhase.datachannel_open ||
    st.phase === P2pSessionPhase.ready ||
    st.phase === P2pSessionPhase.starting
  )
}

async function maySendP2pOfferRequest(hid: string, adSeq: number): Promise<{ send: boolean; reason: string }> {
  const { getSessionState, P2pSessionPhase } = await import('./p2pSession/p2pInferenceSessionManager')
  const { HOST_AI_CAPABILITY_DC_WAIT_MS } = await import('./p2pSession/p2pSessionWait')
  if (await p2pTransportAlreadyAdvancing(hid)) {
    lastP2pOfferRequestByHandshake.delete(hid)
    return { send: false, reason: 'dc_or_connecting' }
  }
  const prev = lastP2pOfferRequestByHandshake.get(hid)
  if (!prev) {
    return { send: true, reason: 'first_after_ad' }
  }
  if (adSeq > prev.adSeq) {
    return { send: true, reason: 'newer_ad_seq' }
  }
  const elapsed = Date.now() - prev.sentAt
  if (elapsed >= HOST_AI_CAPABILITY_DC_WAIT_MS) {
    const st = getSessionState(hid)
    if (st?.phase === P2pSessionPhase.signaling) {
      return { send: true, reason: 'dc_wait_elapsed_retry' }
    }
  }
  return { send: false, reason: 'debounced_inflight' }
}

/**
 * After sandbox accepts a Host BEAP ad: ask the Host (via coordination) to ensure its WebRTC offer.
 * Host remains passive — `relayP2pSignalHandler` calls `ensureHostAiP2pSession` on this request.
 */
export async function sandboxRequestHostAiP2pOfferAfterBeapAdAccepted(
  db: any,
  handshakeId: string,
  record: HandshakeRecord,
  adSeq: number,
  context: string,
): Promise<void> {
  const hid = String(handshakeId ?? '').trim()
  if (!db || !hid || !record) {
    return
  }
  const f = getP2pInferenceFlags()
  if (!f.p2pInferenceEnabled || !f.p2pInferenceSignalingEnabled || !f.p2pInferenceWebrtcEnabled) {
    return
  }
  const localId = getInstanceId().trim()
  const dr = deriveInternalHostAiPeerRoles(record, localId)
  if (!dr.ok || dr.localRole !== 'sandbox' || dr.peerRole !== 'host') {
    return
  }
  const modeHint = String(getOrchestratorMode().mode)
  const ledger = getHostAiLedgerRoleSummaryFromDb(db, localId, modeHint)
  if (ledger.effective_host_ai_role !== 'sandbox' || !ledger.can_probe_host_endpoint) {
    return
  }
  const gate = await maySendP2pOfferRequest(hid, adSeq)
  if (!gate.send) {
    console.log(
      `[HOST_AI_P2P_OFFER_REQUEST] skipped handshake=${hid} reason=${gate.reason} adSeq=${adSeq} context=${context}`,
    )
    return
  }
  const cfg = getP2PConfig(db)
  if (!cfg.use_coordination || !cfg.coordination_url?.trim()) {
    return
  }
  const token = getAccessToken()
  if (!token?.trim()) {
    console.log(`[HOST_AI_P2P_OFFER_REQUEST] skipped handshake=${hid} reason=no_bearer context=${context}`)
    return
  }
  lastP2pOfferRequestByHandshake.set(hid, { sentAt: Date.now(), adSeq })
  const postRes = await postHostAiDirectBeapAdRequestToCoordination({
    db,
    handshakeId: hid,
    senderDeviceId: dr.localCoordinationDeviceId,
    receiverDeviceId: dr.peerCoordinationDeviceId,
  })
  console.log(
    `[HOST_AI_P2P_OFFER_REQUEST] ${JSON.stringify({
      handshakeId: hid,
      requesterDeviceId: dr.localCoordinationDeviceId,
      targetDeviceId: dr.peerCoordinationDeviceId,
      payloadType: 'p2p_host_ai_direct_beap_ad_request',
      adSeq,
      gateReason: gate.reason,
      status: postRes.ok ? 'ok' : `http_${postRes.status}`,
      context,
    })}`,
  )
}

/**
 * After list/repair: if ledger says sandbox can probe and peer Host BEAP is missing (not local BEAP),
 * ask Host over coordination to republish direct BEAP advertisement.
 */
export async function sandboxMaybeRequestHostDirectBeapAdvertisement(
  db: any,
  context: string,
): Promise<void> {
  if (!db) return
  const localId = getInstanceId().trim()
  const modeHint = String(getOrchestratorMode().mode)
  const ledger = getHostAiLedgerRoleSummaryFromDb(db, localId, modeHint)
  if (!ledger.can_probe_host_endpoint || ledger.effective_host_ai_role !== 'sandbox') {
    return
  }
  const cfg = getP2PConfig(db)
  const coordinationReady = Boolean(cfg.use_coordination && cfg.coordination_url?.trim())
  if (!coordinationReady) {
    return
  }

  const rows = listHandshakeRecords(db, { state: HandshakeState.ACTIVE, handshake_type: 'internal' })
  for (const r of rows) {
    const hid = String(r.handshake_id ?? '').trim()
    if (!hid) continue
    const dr = deriveInternalHostAiPeerRoles(r, localId)
    if (!dr.ok || dr.localRole !== 'sandbox' || dr.peerRole !== 'host') {
      continue
    }
    const peek = peekHostAdvertisedMvpDirectEntry(hid)
    if (peek?.url?.trim()) {
      continue
    }
    const ingestRes = resolveSandboxToHostHttpDirectIngest(db, hid, r, '')
    if (ingestRes.ok) {
      if (ingestRes.resolutionCategory === 'accepted_ledger') {
        requestBeapAdRefreshIfMapMiss(db, hid, r, context)
      }
      continue
    }
    const missingPeerAd =
      ingestRes.host_ai_endpoint_deny_detail === 'peer_host_beap_not_advertised' ||
      ingestRes.code === InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING
    if (!missingPeerAd) {
      continue
    }
    const candidateWasLocalSandboxBeap = ingestUrlMatchesThisDevicesMvpDirectBeap(db, r.p2p_endpoint)

    const now = Date.now()
    const last = lastRepublishRequestAtByHandshake.get(hid) ?? 0
    if (now - last < SANDBOX_REPUBLISH_MIN_INTERVAL_MS) {
      console.log(
        `[HOST_AI_PEER_ENDPOINT_MISSING] ${JSON.stringify({
          handshakeId: hid,
          can_probe_host_endpoint: ledger.can_probe_host_endpoint,
          localRole: 'sandbox',
          peerRole: 'host',
          peekAdvertisedPresent: false,
          candidateWasLocalSandboxBeap,
          requestedRepublish: false,
          reason: 'rate_limited',
          context,
        })}`,
      )
      continue
    }

    const token = getAccessToken()
    if (!token?.trim()) {
      console.log(
        `[HOST_AI_PEER_ENDPOINT_MISSING] ${JSON.stringify({
          handshakeId: hid,
          can_probe_host_endpoint: ledger.can_probe_host_endpoint,
          localRole: 'sandbox',
          peerRole: 'host',
          peekAdvertisedPresent: false,
          candidateWasLocalSandboxBeap,
          requestedRepublish: false,
          reason: 'no_bearer',
          context,
        })}`,
      )
      continue
    }

    lastRepublishRequestAtByHandshake.set(hid, now)
    console.log(
      `[HOST_AI_PEER_ENDPOINT_MISSING] ${JSON.stringify({
        handshakeId: hid,
        can_probe_host_endpoint: ledger.can_probe_host_endpoint,
        localRole: 'sandbox',
        peerRole: 'host',
        peekAdvertisedPresent: false,
        candidateWasLocalSandboxBeap,
        requestedRepublish: true,
        reason: 'peer_host_beap_not_advertised',
        context,
      })}`,
    )

    const relayBase = cfg.coordination_url?.trim() ?? ''
    const relayEndpoint = relayBase ? `${relayBase.replace(/\/$/, '')}/beap/p2p-signal` : ''

    const postRes = await postHostAiDirectBeapAdRequestToCoordination({
      db,
      handshakeId: hid,
      senderDeviceId: dr.localCoordinationDeviceId,
      receiverDeviceId: dr.peerCoordinationDeviceId,
    })

    console.log(
      `[HOST_AI_ENDPOINT_REPUBLISH_REQUEST] ${JSON.stringify({
        handshakeId: hid,
        requesterDeviceId: dr.localCoordinationDeviceId,
        targetDeviceId: dr.peerCoordinationDeviceId,
        relayEndpoint,
        payloadType: 'p2p_host_ai_direct_beap_ad_request',
        status: postRes.ok ? 'ok' : `http_${postRes.status}`,
        errorBodyCode: postRes.errorBodyCode ?? null,
      })}`,
    )

    if (!postRes.ok) {
      console.log(
        `[HOST_AI_PEER_ENDPOINT_MISSING] ${JSON.stringify({
          handshakeId: hid,
          can_probe_host_endpoint: ledger.can_probe_host_endpoint,
          localRole: 'sandbox',
          peerRole: 'host',
          peekAdvertisedPresent: false,
          candidateWasLocalSandboxBeap,
          requestedRepublish: true,
          reason: `relay_post_status_${postRes.status}`,
          context,
        })}`,
      )
    }
  }
}
