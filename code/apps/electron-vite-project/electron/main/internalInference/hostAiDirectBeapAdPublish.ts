/**
 * Host-only: push authenticated `p2p_host_ai_direct_beap_ad` over coordination so the peer sandbox
 * learns Host llama.cpp capabilities (model roster, `gpu_inference_available`) via the sealed-relay plane.
 *
 * Direct-LAN ingest is retired; publish is gated on coordination + ledger host role + policy + llama.cpp
 * models (`serverRunning && modelsInstalled >= 1`, see `getLocalLlmProviderStatus`) — not on a local
 * MVP direct BEAP listener URL.
 */

import { listHandshakeRecords } from '../handshake/db'
import { HandshakeState } from '../handshake/types'
import { getInstanceId, getOrchestratorMode } from '../orchestrator/orchestratorModeStore'
import { getP2PConfig } from '../p2p/p2pConfig'
import {
  hostAiBeapAdPublishShouldRetryAfterPolicyDenial,
  logHostAiRemotePolicyDecision,
  resolveHostAiRemoteInferencePolicy,
} from './hostAiRemoteInferencePolicyResolve'
import { getHostAiLedgerRoleSummaryFromDb } from './hostAiEffectiveRole'
import { isHostAiLedgerAsymmetricTerminal } from './hostAiPairingStateStore'
import { hostAiBeapAdLocalOllamaModelRoster } from './hostAiBeapAdOllamaModelCount'
import { postHostAiDirectBeapAdToCoordination, type HostAiBeapAdSignalOllamaCapabilities } from './p2pSignalRelayPost'
import {
  assertRecordForServiceRpc,
  coordinationDeviceIdForHandshakeDeviceRole,
  deriveInternalHostAiPeerRoles,
} from './policy'
import {
  assertHostMachineSessionMatchesHandshakeHostParty,
  partyIdentityFromSession,
} from './hostAiPeerLivePresence'
import { getCurrentSession } from '../handshake/ipc'

let lastHostBeapAdPublishAllAt = 0
const publishCooldownMs = 2_000
const adSeqByHandshake = new Map<string, number>()

// B2: backoff instead of a fixed-interval retry loop while gated (e.g. waiting on
// llamacpp_models_gate / no_coordination) — starts at the old 2.8s cadence and doubles
// up to a 30s cap so a long-gated host does not keep firing ~64 fixed-interval attempts.
const REPUBLISH_RETRY_BASE_MS = 2_800
const REPUBLISH_RETRY_MAX_MS = 30_000
const MAX_REPUBLISH_RETRIES = 64
let republishRetryAttempts = 0
let republishTimer: ReturnType<typeof setTimeout> | null = null
let republishDbRef: any = null

function nextRepublishBackoffMs(attempt: number): number {
  return Math.min(REPUBLISH_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1), REPUBLISH_RETRY_MAX_MS)
}

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
  const delayMs = nextRepublishBackoffMs(republishRetryAttempts + 1)
  republishTimer = setTimeout(() => {
    republishTimer = null
    republishRetryAttempts += 1
    void publishHostAiDirectBeapAdvertisementsForEligibleHost(republishDbRef, {
      context: `republish_after_${skipReason}`,
    })
  }, delayMs)
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
  const { getCanonHandshakeDbForHostAiPolicy } = await import('./dbAccess')
  const canonDb = await getCanonHandshakeDbForHostAiPolicy(db ?? null)
  if (!canonDb) {
    console.log(
      `[HOST_AI_HOST_BEAP_AD_PUBLISH] ${JSON.stringify({
        handshakeId: null,
        skipReason: 'no_canon_handshake_db',
        published: false,
        context: input.context,
      })}`,
    )
    return
  }
  const localId = getInstanceId().trim()
  const modeHint = String(getOrchestratorMode().mode)
  const cfg = getP2PConfig(canonDb)
  const coordinationReady = Boolean(cfg.use_coordination && cfg.coordination_url?.trim())
  const policyRes = resolveHostAiRemoteInferencePolicy(canonDb)
  const endpointRepair = await import('./p2pEndpointRepair')
  /** Retired direct-LAN ingest — omitted from relay ads; sealed relay carries capabilities. */
  const directUrl = endpointRepair.getHostPublishedMvpDirectP2pIngestUrl(canonDb)
  const directLanEndpointPresent = Boolean(directUrl?.trim())
  const sealedRelayPublishReady = coordinationReady
  logHostAiRemotePolicyDecision(canonDb, policyRes, {
    context: input.context,
    endpointPresent: directLanEndpointPresent,
    canonDbUsed: true,
  })
  const ledger = getHostAiLedgerRoleSummaryFromDb(canonDb, localId, modeHint)
  const effectiveRole = ledger.effective_host_ai_role
  const canPublish = ledger.can_publish_host_endpoint === true

  const logAttemptBase = (extra: Record<string, unknown>) =>
    console.log(`[HOST_AI_HOST_BEAP_AD_PUBLISH] ${JSON.stringify(extra)}`)

  if (!policyRes.allowRemoteInference) {
    const skipReason = policyRes.explicitUserDisabled
      ? 'explicit_user_disabled_remote_inference'
      : policyRes.denialReason
        ? `host_inference_policy_${policyRes.denialReason}`
        : 'host_inference_policy_denies_remote'
    logAttemptBase({
      handshakeId: null,
      localDeviceId: localId,
      peerDeviceId: null as string | null,
      effectiveHostAiRole: effectiveRole,
      can_publish_host_endpoint: canPublish,
      p2pEndpointReady: sealedRelayPublishReady,
      directBeapUrlPresent: directLanEndpointPresent,
      coordinationReady,
      publishPlane: 'sealed_relay',
      llamaServerOk: null,
      modelsCount: null,
      skipReason,
      published: false,
      policyDecision: policyRes.policySource,
      policyDenialReason: policyRes.denialReason ?? null,
      explicitUserDisabled: policyRes.explicitUserDisabled,
      context: input.context,
    })
    if (hostAiBeapAdPublishShouldRetryAfterPolicyDenial(policyRes)) {
      scheduleHostAiBeapAdRepublishRetry(canonDb, 'policy_off')
    }
    return
  }
  if (!coordinationReady) {
    logAttemptBase({
      handshakeId: null,
      localDeviceId: localId,
      peerDeviceId: null,
      effectiveHostAiRole: effectiveRole,
      can_publish_host_endpoint: canPublish,
      p2pEndpointReady: false,
      directBeapUrlPresent: directLanEndpointPresent,
      coordinationReady: false,
      publishPlane: 'sealed_relay',
      llamaServerOk: null,
      modelsCount: null,
      skipReason: 'coordination_unavailable',
      published: false,
      context: input.context,
    })
    scheduleHostAiBeapAdRepublishRetry(canonDb, 'no_coordination')
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
        p2pEndpointReady: sealedRelayPublishReady,
        directBeapUrlPresent: directLanEndpointPresent,
        coordinationReady,
        publishPlane: 'sealed_relay',
        llamaServerOk: null,
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
        p2pEndpointReady: sealedRelayPublishReady,
        directBeapUrlPresent: directLanEndpointPresent,
        coordinationReady,
        publishPlane: 'sealed_relay',
        llamaServerOk: null,
        modelsCount: null,
        skipReason: 'cannot_publish_host_endpoint',
        published: false,
        context: input.context,
      })}`,
    )
    return
  }

  // `providerStatus` here is the llama.cpp model roster (real reachability via
  // `hostAiBeapAdLocalOllamaModelRoster` → `getLocalLlmProviderStatus`, B1).
  const providerStatus = await hostAiBeapAdLocalOllamaModelRoster()
  const { isGpuInferenceAvailable } = await import('../inference/inferenceGate')
  const hostGpuAvailable = await isGpuInferenceAvailable()
  // WIRE-FREEZE: `HostAiBeapAdSignalOllamaCapabilities` and its field names are serialized
  // into the BEAP ad `host_ai_route.capabilities` payload sent to the peer — do not rename.
  const providerCaps: HostAiBeapAdSignalOllamaCapabilities = {
    provider: 'llamacpp',
    models_count: providerStatus.models_count,
    available: providerStatus.models_count > 0,
    models: providerStatus.models,
    active_model_id: providerStatus.active_model_id,
    active_model_name: providerStatus.active_model_name,
    model_source: providerStatus.model_source,
    max_concurrent_local_models: 1,
    gpu_inference_available: hostGpuAvailable,
  }
  if (!providerStatus.ollama_ok || providerStatus.models_count < 1) {
    console.log(
      `[HOST_AI_HOST_BEAP_AD_PUBLISH] ${JSON.stringify({
        handshakeId: null,
        localDeviceId: localId,
        peerDeviceId: null,
        effectiveHostAiRole: effectiveRole,
        can_publish_host_endpoint: canPublish,
        p2pEndpointReady: sealedRelayPublishReady,
        directBeapUrlPresent: directLanEndpointPresent,
        coordinationReady,
        publishPlane: 'sealed_relay',
        llamaServerOk: providerStatus.ollama_ok,
        modelsCount: providerStatus.models_count,
        skipReason: 'llamacpp_models_gate',
        published: false,
        context: input.context,
      })}`,
    )
    scheduleHostAiBeapAdRepublishRetry(canonDb, 'llamacpp_models_gate')
    return
  }

  const now = Date.now()
  if (now - lastHostBeapAdPublishAllAt < publishCooldownMs) {
    scheduleHostAiBeapAdRepublishRetry(canonDb, 'publish_cooldown')
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
  const rows = listHandshakeRecords(canonDb, { state: HandshakeState.ACTIVE, handshake_type: 'internal' })
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
    const hostSessionGate = assertHostMachineSessionMatchesHandshakeHostParty(ar.record)
    if (!hostSessionGate.ok) {
      console.log(
        `[HOST_AI_HOST_BEAP_AD_PUBLISH] ${JSON.stringify({
          handshakeId: hid,
          localDeviceId: localId,
          peerDeviceId: peerCoord || null,
          skipReason: 'host_session_not_handshake_party',
          published: false,
          context: input.context,
        })}`,
      )
      continue
    }
    const seq = nextAdSeq(hid)
    console.log(
      `[HOST_AI_MODEL_ROSTER_PUBLISH] ${JSON.stringify({
        handshakeId: hid,
        hostDeviceId: localId,
        models: providerStatus.models.map((m) => m.name),
        activeModelId: providerStatus.active_model_id,
        activeModelName: providerStatus.active_model_name,
        modelSource: providerStatus.model_source,
        maxConcurrentLocalModels: 1,
      })}`,
    )
    console.log(
      `[HOST_AI_HOST_BEAP_AD_PUBLISH] ${JSON.stringify({
        handshakeId: hid,
        localDeviceId: localId,
        peerDeviceId: peerCoord || null,
        effectiveHostAiRole: effectiveRole,
        can_publish_host_endpoint: canPublish,
        p2pEndpointReady: sealedRelayPublishReady,
        directBeapUrlPresent: directLanEndpointPresent,
        coordinationReady,
        publishPlane: 'sealed_relay',
        llamaServerOk: providerStatus.ollama_ok,
        modelsCount: providerStatus.models_count,
        skipReason: null,
        published: null,
        relayPostPending: true,
        context: input.context,
      })}`,
    )
    const res = await postHostAiDirectBeapAdToCoordination({
      db: canonDb,
      handshakeId: hid,
      endpointUrl: directUrl ?? undefined,
      senderDeviceId: dr.localCoordinationDeviceId,
      receiverDeviceId: dr.peerCoordinationDeviceId,
      adSeq: seq,
      ollamaCapabilities: providerCaps, // WIRE-FREEZE: param name mirrors frozen HostAiBeapAdSignalOllamaCapabilities
      publisherIdentity: (() => {
        const p = partyIdentityFromSession(getCurrentSession())
        if (!p) return undefined
        return {
          wrdesk_user_id: p.wrdesk_user_id,
          iss: p.iss,
          sub: p.sub,
        }
      })(),
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
        p2pEndpointReady: sealedRelayPublishReady,
        directBeapUrlPresent: directLanEndpointPresent,
        coordinationReady,
        publishPlane: 'sealed_relay',
        llamaServerOk: providerStatus.ollama_ok,
        modelsCount: providerStatus.models_count,
        skipReason: relayOk ? null : `relay_post_${res.status}`,
        published: relayOk,
        relayStatus: res.status,
        context: input.context,
      })}`,
    )
    if (relayOk) {
      published += 1
      const ttlMs = 300_000
      const endpointKind = directLanEndpointPresent ? 'direct_lan' : 'sealed_relay'
      console.log(
        `[HOST_AI_HOST_BEAP_AD_PUBLISHED] ${JSON.stringify({
          handshakeId: hid,
          endpointOwnerDeviceId: dr.localCoordinationDeviceId,
          endpoint: directUrl ?? null,
          endpointKind,
          gpu_inference_available: hostGpuAvailable,
          modelsCount: providerStatus.models_count,
          ttlMs,
          context: input.context,
          ad_seq: seq,
        })}`,
      )
      console.log(
        `[HOST_AI_PROVIDER_ADVERTISEMENT] published host_direct_beap_ad ${JSON.stringify({
          handshake_id: hid,
          ad_seq: seq,
          endpoint_url: directUrl ?? null,
          endpointKind,
          gpu_inference_available: hostGpuAvailable,
          context: input.context,
          relay_status: res.status,
          models_count: providerStatus.models_count,
        })}`,
      )
    }
  }
  if (published > 0) {
    republishRetryAttempts = 0
    clearHostAiBeapRepublishTimer()
    console.log(
      `[HOST_AI_HOST_BEAP_AD_PUBLISH] done count=${published} context=${input.context} plane=sealed_relay direct_lan_endpoint=${directUrl ?? 'none'}`,
    )
  } else if (attemptedPost > 0 && republishTimer == null) {
    scheduleHostAiBeapAdRepublishRetry(canonDb, 'all_relay_posts_failed')
  }
}
