/**
 * One-line Host orchestrator health for bug reports ([HOST_AI_HEALTH]).
 * Runs once shortly after app ready (relay WebSocket may still be connecting).
 */

import { getCoordinationWsClient } from '../p2p/coordinationWsHolder'
import { getP2PConfig, computeLocalP2PEndpoint, type P2PConfig } from '../p2p/p2pConfig'
import { getOrchestratorMode } from '../orchestrator/orchestratorModeStore'
import { getAccessToken } from '../../../src/auth/session'
import { ollamaManager } from '../llm/ollama-manager'
import { getHandshakeDbForInternalInference } from './dbAccess'
import { redactIdForLog } from './internalInferenceLogRedact'
import { logP2pSignalWireSchemaStartupLine } from './p2pSignalWireSchemaVersion'

/** Published or computed direct LAN BEAP ingest URL for one-line health logs. */
function resolveDirectBeapIngestForHealth(cfg: P2PConfig): string {
  const pub = (cfg.local_p2p_endpoint ?? '').trim()
  if (!pub) return computeLocalP2PEndpoint(cfg)
  if (pub.includes('/beap/ingest')) return pub.replace(/\/$/, '')
  if (/^https?:\/\//i.test(pub)) return `${pub.replace(/\/$/, '')}/beap/ingest`
  return pub
}

export async function logHostAiOrchestratorHealthLine(): Promise<void> {
  try {
    if (getOrchestratorMode().mode !== 'host') {
      return
    }
    const om = getOrchestratorMode()
    const deviceId = (om.instanceId ?? '').trim() || 'unknown'
    const token = getAccessToken()
    const account = token?.trim() ? 'signed_in' : 'signed_out'

    let ollamaOk = false
    let modelCount = 0
    try {
      const models = await ollamaManager.listModels()
      ollamaOk = true
      modelCount = Array.isArray(models) ? models.length : 0
    } catch {
      ollamaOk = false
      modelCount = 0
    }

    let relayWs = false
    try {
      const c = getCoordinationWsClient()
      relayWs = Boolean(c?.isConnected?.())
    } catch {
      relayWs = false
    }

    const ollamaLabel = ollamaOk ? 'ok' : 'down'
    const relayLabel = relayWs ? 'connected' : 'disconnected'

    let directEndpoint = 'unknown'
    try {
      const db = await getHandshakeDbForInternalInference()
      if (db) {
        const cfg = getP2PConfig(db)
        directEndpoint = resolveDirectBeapIngestForHealth(cfg)
      }
    } catch {
      directEndpoint = 'unknown'
    }

    logP2pSignalWireSchemaStartupLine()
    console.log(
      `[HOST_AI_HEALTH] ollama=${ollamaLabel} models=${modelCount} relay_ws=${relayLabel} device_id=${redactIdForLog(deviceId)} direct_endpoint=${directEndpoint} account=${account}`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.log(`[HOST_AI_HEALTH] mode=host error=${JSON.stringify(msg.slice(0, 200))}`)
  }
}
