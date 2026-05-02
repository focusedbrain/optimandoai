/**
 * Sandbox-only: when a valid internal sandbox→Host handshake exists but the peer Host LAN BEAP
 * advertisement is missing in-process, POST a coordination `p2p_host_ai_direct_beap_ad_request`
 * so the paired Host republishes `p2p_host_ai_direct_beap_ad`. Does not publish Host AI from sandbox.
 */

import { getAccessToken } from '../../../src/auth/session'
import { listHandshakeRecords } from '../handshake/db'
import { HandshakeState } from '../handshake/types'
import { getInstanceId, getOrchestratorMode } from '../orchestrator/orchestratorModeStore'
import { getP2PConfig } from '../p2p/p2pConfig'
import { getHostAiLedgerRoleSummaryFromDb } from './hostAiEffectiveRole'
import { InternalInferenceErrorCode } from './errors'
import {
  ingestUrlMatchesThisDevicesMvpDirectBeap,
  peekHostAdvertisedMvpDirectEntry,
  resolveSandboxToHostHttpDirectIngest,
} from './p2pEndpointRepair'
import { deriveInternalHostAiPeerRoles } from './policy'
import { postHostAiDirectBeapAdRequestToCoordination } from './p2pSignalRelayPost'

const lastRepublishRequestAtByHandshake = new Map<string, number>()
const SANDBOX_REPUBLISH_MIN_INTERVAL_MS = 15_000

/** @internal */
export function resetSandboxHostAiDirectBeapAdRequestStateForTests(): void {
  lastRepublishRequestAtByHandshake.clear()
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

    const postRes = await postHostAiDirectBeapAdRequestToCoordination({
      db,
      handshakeId: hid,
      senderDeviceId: dr.localCoordinationDeviceId,
      receiverDeviceId: dr.peerCoordinationDeviceId,
    })
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
