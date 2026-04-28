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
import { postHostAiDirectBeapAdToCoordination } from './p2pSignalRelayPost'
import {
  assertRecordForServiceRpc,
  coordinationDeviceIdForHandshakeDeviceRole,
  deriveInternalHostAiPeerRoles,
} from './policy'

let lastHostBeapAdPublishAllAt = 0
const publishCooldownMs = 2_000
const adSeqByHandshake = new Map<string, number>()

function nextAdSeq(handshakeId: string): number {
  const hid = handshakeId.trim()
  const n = (adSeqByHandshake.get(hid) ?? 0) + 1
  adSeqByHandshake.set(hid, n)
  return n
}

/** @internal */
export function resetHostAiDirectBeapAdPublishStateForTests(): void {
  lastHostBeapAdPublishAllAt = 0
  adSeqByHandshake.clear()
}

async function sandboxLocalOllamaModelCountGate(): Promise<{ ollama_ok: boolean; models_count: number }> {
  try {
    const { ollamaManager } = await import('../llm/ollama-manager')
    const installed = await ollamaManager.listModels()
    const n = Array.isArray(installed) ? installed.length : 0
    return { ollama_ok: true, models_count: n }
  } catch {
    return { ollama_ok: false, models_count: 0 }
  }
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
  const pol = getHostInternalInferencePolicy()
  if (!pol?.allowSandboxInference) {
    return
  }
  const cfg = getP2PConfig(db)
  if (!cfg.use_coordination || !cfg.coordination_url?.trim()) {
    return
  }

  const endpointRepair = await import('./p2pEndpointRepair')
  const directUrl = endpointRepair.getHostPublishedMvpDirectP2pIngestUrl(db)
  if (!directUrl) {
    /**
     * Do **not** consume publish cooldown when the MVP direct BEAP URL is not ready yet. Early callers
     * (`app_p2p_ledger_ready`, `coordination_ws_open`) can run before `p2p_server_listen` persists
     * `local_p2p_endpoint`; a premature cooldown was blocking the first real publish to the relay.
     */
    console.log(
      `[HOST_AI_HOST_BEAP_AD_PUBLISH] skip reason=no_mvp_direct_endpoint context=${input.context} ` +
        '(waiting for local LAN BEAP; retry on p2p_server_listen / p2p repair / list / ws)',
    )
    return
  }

  const localId = getInstanceId().trim()
  const modeHint = String(getOrchestratorMode().mode)
  const ledger = getHostAiLedgerRoleSummaryFromDb(db, localId, modeHint)

  if (ledger.effective_host_ai_role !== 'host') {
    console.log(
      `[HOST_AI_HOST_BEAP_AD_PUBLISH] skip reason=effective_role_not_exclusive_host role=${ledger.effective_host_ai_role} context=${input.context}`,
    )
    return
  }

  if (!ledger.can_publish_host_endpoint) {
    return
  }

  const hdrs = endpointRepair.hostDirectP2pAdvertisementHeaders(db)
  const headerVal = hdrs[endpointRepair.P2P_DIRECT_P2P_ENDPOINT_HEADER]
  if (typeof headerVal !== 'string' || !headerVal.trim()) {
    console.log(`[HOST_AI_HOST_BEAP_AD_PUBLISH] skip reason=no_beap_endpoint_header context=${input.context}`)
    return
  }

  const ollama = await sandboxLocalOllamaModelCountGate()
  if (!ollama.ollama_ok || ollama.models_count < 1) {
    console.log(
      `[HOST_AI_HOST_BEAP_AD_PUBLISH] skip reason=ollama_models_gate ollama_ok=${ollama.ollama_ok} models_count=${ollama.models_count} context=${input.context}`,
    )
    return
  }

  const now = Date.now()
  if (now - lastHostBeapAdPublishAllAt < publishCooldownMs) {
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
    if (hostCoord && isHostAiLedgerAsymmetricTerminal(hid, hostCoord)) {
      continue
    }
    const seq = nextAdSeq(hid)
    const res = await postHostAiDirectBeapAdToCoordination({
      db,
      handshakeId: hid,
      endpointUrl: directUrl,
      senderDeviceId: dr.localCoordinationDeviceId,
      receiverDeviceId: dr.peerCoordinationDeviceId,
      adSeq: seq,
    })
    if (res.ok) {
      published += 1
      console.log(
        `[HOST_AI_PROVIDER_ADVERTISEMENT] published host_direct_beap_ad ${JSON.stringify({
          handshake_id: hid,
          ad_seq: seq,
          endpoint_url: directUrl,
          context: input.context,
          relay_status: res.status,
        })}`,
      )
    }
  }
  if (published > 0) {
    console.log(
      `[HOST_AI_HOST_BEAP_AD_PUBLISH] done count=${published} context=${input.context} endpoint=${directUrl}`,
    )
  }
}
