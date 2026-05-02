/**
 * Host-only: push authenticated `p2p_host_ai_direct_beap_ad` over coordination so the peer sandbox
 * learns the host LAN BEAP ingest **before** the first HTTP capability probe (bootstrap).
 *
 * Gating matches {@link buildHostAiProviderAdvertisementPayload}: ledger `effective_host_ai_role === 'host'`,
 * policy, local Ollama models, MVP LAN listener URL, and outbound `X-BEAP-*` advertisement headers — never publishes
 * from a sandbox-derived ledger identity.
 */

import { listHandshakeRecords } from '../handshake/db'
import { HandshakeState } from '../handshake/types'
import { getInstanceId, getOrchestratorMode } from '../orchestrator/orchestratorModeStore'
import { getP2PConfig } from '../p2p/p2pConfig'
import { getHostInternalInferencePolicy } from './hostInferencePolicyStore'
import { getHostAiLedgerRoleSummaryFromDb } from './hostAiEffectiveRole'
import { isHostAiLedgerAsymmetricTerminal } from './hostAiPairingStateStore'
import { hostAiBeapAdLocalOllamaModelCount } from './hostAiBeapAdOllamaModelCount'
import { postHostAiDirectBeapAdToCoordination } from './p2pSignalRelayPost'
import {
  assertRecordForServiceRpc,
  coordinationDeviceIdForHandshakeDeviceRole,
  deriveInternalHostAiPeerRoles,
} from './policy'

let lastHostBeapAdPublishAllAt = 0
const publishCooldownMs = 2_000
const adSeqByHandshake = new Map<string, number>()

const REPUBLISH_RETRY_MS = 2_800
const MAX_REPUBLISH_RETRIES = 64
let republishRetryAttempts = 0
let republishTimer: ReturnType<typeof setTimeout> | null = null
let republishDbRef: any = null

function nextAdSeq(handshakeId: string): number {
  const hid = handshakeId.trim()
  const n = (adSeqByHandshake.get(hid) ?? 0) + 1
  adSeqByHandshake.set(hid, n)
  return n
}

function clearHostAiBeapRepublishTimer(): void {
  if (republishTimer) {
    clearTimeout(republishTimer)
    republishTimer = null
  }
}

function scheduleHostAiBeapAdRepublishRetry(db: any, skipReason: string): void {
  republishDbRef = db
  if (republishRetryAttempts >= MAX_REPUBLISH_RETRIES) {
    console.log(
      `[HOST_AI_HOST_BEAP_AD_PUBLISH] republish_retry_exhausted attempts=${MAX_REPUBLISH_RETRIES} last_reason=${skipReason}`,
    )
    return
  }
  if (republishTimer) {
    return
  }
  republishTimer = setTimeout(() => {
    republishTimer = null
    republishRetryAttempts += 1
    void publishHostAiDirectBeapAdvertisementsForEligibleHost(republishDbRef, {
      context: `republish_after_${skipReason}`,
    })
  }, REPUBLISH_RETRY_MS)
}

/** @internal */
export function resetHostAiDirectBeapAdPublishStateForTests(): void {
  lastHostBeapAdPublishAllAt = 0
  adSeqByHandshake.clear()
  republishRetryAttempts = 0
  clearHostAiBeapRepublishTimer()
  republishDbRef = null
}

/**
 * Ledger-exclusive host device: coordination + MVP URL + sandbox-inference policy + Ollama models + outbound BEAP headers.
 */
export async function publishHostAiDirectBeapAdvertisementsForEligibleHost(
  db: any,
  input: { context: string },
): Promise<void> {
  if (!db) {
    return
  }
  const localId = getInstanceId().trim()
  const modeHint = String(getOrchestratorMode().mode)
  const cfg = getP2PConfig(db)
  const coordinationReady = Boolean(cfg.use_coordination && cfg.coordination_url?.trim())
  const pol = getHostInternalInferencePolicy()
  const endpointRepair = await import('./p2pEndpointRepair')
  const directUrl = endpointRepair.getHostPublishedMvpDirectP2pIngestUrl(db)
  const p2pEndpointReady = Boolean(directUrl?.trim())
  const ledger = getHostAiLedgerRoleSummaryFromDb(db, localId, modeHint)
  const effectiveRole = ledger.effective_host_ai_role
  const canPublish = ledger.can_publish_host_endpoint === true

  const logAttemptBase = (extra: Record<string, unknown>) =>
    console.log(`[HOST_AI_HOST_BEAP_AD_PUBLISH] ${JSON.stringify(extra)}`)

  if (!pol?.allowSandboxInference) {
    logAttemptBase({
      handshakeId: null,
      localDeviceId: localId,
      peerDeviceId: null as string | null,
      effectiveHostAiRole: effectiveRole,
      can_publish_host_endpoint: canPublish,
      p2pEndpointReady,
      directBeapUrlPresent: p2pEndpointReady,
      coordinationReady,
      ollamaOk: null,
      modelsCount: null,
      skipReason: 'host_inference_policy_denies_remote',
      published: false,
      context: input.context,
    })
    scheduleHostAiBeapAdRepublishRetry(db, 'policy_off')
    return
  }
  if (!coordinationReady) {
    logAttemptBase({
      handshakeId: null,
      localDeviceId: localId,
      peerDeviceId: null,
      effectiveHostAiRole: effectiveRole,
      can_publish_host_endpoint: canPublish,
      p2pEndpointReady,
      directBeapUrlPresent: p2pEndpointReady,
      coordinationReady: false,
      ollamaOk: null,
      modelsCount: null,
      skipReason: 'coordination_unavailable',
      published: false,
      context: input.context,
    })
    scheduleHostAiBeapAdRepublishRetry(db, 'no_coordination')
    return
  }

  if (!directUrl) {
    console.log(
      `[HOST_AI_HOST_BEAP_AD_PUBLISH] ${JSON.stringify({
        handshakeId: null,
        localDeviceId: localId,
        peerDeviceId: null,
        effectiveHostAiRole: effectiveRole,
        can_publish_host_endpoint: canPublish,
        p2pEndpointReady: false,
        directBeapUrlPresent: false,
        coordinationReady,
        ollamaOk: null,
        modelsCount: null,
        skipReason: 'no_mvp_direct_endpoint',
        published: false,
        context: input.context,
      })}`,
    )
    scheduleHostAiBeapAdRepublishRetry(db, 'no_mvp_direct_endpoint')
    return
  }

  if (effectiveRole !== 'host') {
    console.log(
      `[HOST_AI_HOST_BEAP_AD_PUBLISH] ${JSON.stringify({
        handshakeId: null,
        localDeviceId: localId,
        peerDeviceId: null,
        effectiveHostAiRole: effectiveRole,
        can_publish_host_endpoint: canPublish,
        p2pEndpointReady,
        directBeapUrlPresent: true,
        coordinationReady,
        ollamaOk: null,
        modelsCount: null,
        skipReason: 'effective_role_not_exclusive_host',
        published: false,
        context: input.context,
      })}`,
    )
    return
  }

  if (!canPublish) {
    console.log(
      `[HOST_AI_HOST_BEAP_AD_PUBLISH] ${JSON.stringify({
        handshakeId: null,
        localDeviceId: localId,
        peerDeviceId: null,
        effectiveHostAiRole: effectiveRole,
        can_publish_host_endpoint: false,
        p2pEndpointReady,
        directBeapUrlPresent: true,
        coordinationReady,
        ollamaOk: null,
        modelsCount: null,
        skipReason: 'cannot_publish_host_endpoint',
        published: false,
        context: input.context,
      })}`,
    )
    return
  }

  const hdrs = endpointRepair.hostDirectP2pAdvertisementHeaders(db)
  const headerVal = hdrs[endpointRepair.P2P_DIRECT_P2P_ENDPOINT_HEADER]
  const hasHeader = typeof headerVal === 'string' && headerVal.trim().length > 0
  if (!hasHeader) {
    console.log(
      `[HOST_AI_HOST_BEAP_AD_PUBLISH] ${JSON.stringify({
        handshakeId: null,
        localDeviceId: localId,
        peerDeviceId: null,
        effectiveHostAiRole: effectiveRole,
        can_publish_host_endpoint: canPublish,
        p2pEndpointReady,
        directBeapUrlPresent: true,
        coordinationReady,
        ollamaOk: null,
        modelsCount: null,
        skipReason: 'no_beap_endpoint_header',
        published: false,
        context: input.context,
      })}`,
    )
    scheduleHostAiBeapAdRepublishRetry(db, 'no_beap_endpoint_header')
    return
  }

  const ollama = await hostAiBeapAdLocalOllamaModelCount()
  if (!ollama.ollama_ok || ollama.models_count < 1) {
    console.log(
      `[HOST_AI_HOST_BEAP_AD_PUBLISH] ${JSON.stringify({
        handshakeId: null,
        localDeviceId: localId,
        peerDeviceId: null,
        effectiveHostAiRole: effectiveRole,
        can_publish_host_endpoint: canPublish,
        p2pEndpointReady,
        directBeapUrlPresent: true,
        coordinationReady,
        ollamaOk: ollama.ollama_ok,
        modelsCount: ollama.models_count,
        skipReason: 'ollama_models_gate',
        published: false,
        context: input.context,
      })}`,
    )
    scheduleHostAiBeapAdRepublishRetry(db, 'ollama_models_gate')
    return
  }

  const now = Date.now()
  if (now - lastHostBeapAdPublishAllAt < publishCooldownMs) {
    scheduleHostAiBeapAdRepublishRetry(db, 'publish_cooldown')
    return
  }
  lastHostBeapAdPublishAllAt = now
  if (ledger.any_orchestrator_mismatch) {
    console.log(
      `[HOST_AI_HOST_BEAP_AD_PUBLISH] orchestrator_mode_hint_mismatch ` +
        `(ledger is authoritative; publish still allowed when can_publish_host_endpoint) ` +
        JSON.stringify({ configured_mode: modeHint, effective_host_ai_role: ledger.effective_host_ai_role, context: input.context }),
    )
  }
  const rows = listHandshakeRecords(db, { state: HandshakeState.ACTIVE, handshake_type: 'internal' })
  let published = 0
  let attemptedPost = 0
  for (const r of rows) {
    const ar = assertRecordForServiceRpc(r)
    if (!ar.ok) {
      continue
    }
    const dr = deriveInternalHostAiPeerRoles(ar.record, localId)
    if (!dr.ok || dr.localRole !== 'host' || dr.peerRole !== 'sandbox') {
      continue
    }
    const hid = ar.record.handshake_id
    const hostCoord = (coordinationDeviceIdForHandshakeDeviceRole(ar.record, 'host') ?? '').trim()
    const peerCoord = (coordinationDeviceIdForHandshakeDeviceRole(ar.record, 'sandbox') ?? '').trim()
    if (hostCoord && isHostAiLedgerAsymmetricTerminal(hid, hostCoord)) {
      continue
    }
    const seq = nextAdSeq(hid)
    console.log(
      `[HOST_AI_HOST_BEAP_AD_PUBLISH] ${JSON.stringify({
        handshakeId: hid,
        localDeviceId: localId,
        peerDeviceId: peerCoord || null,
        effectiveHostAiRole: effectiveRole,
        can_publish_host_endpoint: canPublish,
        p2pEndpointReady,
        directBeapUrlPresent: true,
        coordinationReady,
        ollamaOk: ollama.ollama_ok,
        modelsCount: ollama.models_count,
        skipReason: null,
        published: null,
        relayPostPending: true,
        context: input.context,
      })}`,
    )
    const res = await postHostAiDirectBeapAdToCoordination({
      db,
      handshakeId: hid,
      endpointUrl: directUrl,
      senderDeviceId: dr.localCoordinationDeviceId,
      receiverDeviceId: dr.peerCoordinationDeviceId,
      adSeq: seq,
      modelsCount: ollama.models_count,
    })
    attemptedPost += 1
    const relayOk = res.ok
    console.log(
      `[HOST_AI_HOST_BEAP_AD_PUBLISH] ${JSON.stringify({
        handshakeId: hid,
        localDeviceId: localId,
        peerDeviceId: peerCoord || null,
        effectiveHostAiRole: effectiveRole,
        can_publish_host_endpoint: canPublish,
        p2pEndpointReady,
        directBeapUrlPresent: true,
        coordinationReady,
        ollamaOk: ollama.ollama_ok,
        modelsCount: ollama.models_count,
        skipReason: relayOk ? null : `relay_post_${res.status}`,
        published: relayOk,
        relayStatus: res.status,
        context: input.context,
      })}`,
    )
    if (relayOk) {
      published += 1
      const ttlMs = 300_000
      console.log(
        `[HOST_AI_HOST_BEAP_AD_PUBLISHED] ${JSON.stringify({
          handshakeId: hid,
          endpointOwnerDeviceId: dr.localCoordinationDeviceId,
          endpointKind: 'direct_lan',
          modelsCount: ollama.models_count,
          ttlMs,
          context: input.context,
          ad_seq: seq,
        })}`,
      )
      console.log(
        `[HOST_AI_PROVIDER_ADVERTISEMENT] published host_direct_beap_ad ${JSON.stringify({
          handshake_id: hid,
          ad_seq: seq,
          endpoint_url: directUrl,
          context: input.context,
          relay_status: res.status,
          models_count: ollama.models_count,
        })}`,
      )
    }
  }
  if (published > 0) {
    republishRetryAttempts = 0
    clearHostAiBeapRepublishTimer()
    console.log(
      `[HOST_AI_HOST_BEAP_AD_PUBLISH] done count=${published} context=${input.context} endpoint=${directUrl}`,
    )
  } else if (attemptedPost > 0 && republishTimer == null) {
    scheduleHostAiBeapAdRepublishRetry(db, 'all_relay_posts_failed')
  }
}
