/**
 * One-line Host orchestrator health for bug reports ([HOST_AI_HEALTH]).
 * Runs once shortly after app ready (relay WebSocket may still be connecting).
 */

import { getCoordinationWsClient } from '../p2p/coordinationWsHolder'
import { getOrchestratorMode } from '../orchestrator/orchestratorModeStore'
import { getAccessToken } from '../../../src/auth/session'
import { ollamaManager } from '../llm/ollama-manager'
import { logP2pSignalWireSchemaStartupLine } from './p2pSignalWireSchemaVersion'

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
    logP2pSignalWireSchemaStartupLine()
    console.log(
      `[HOST_AI_HEALTH] ollama=${ollamaLabel} models=${modelCount} relay_ws=${relayLabel} device_id=${deviceId} account=${account}`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.log(`[HOST_AI_HEALTH] mode=host error=${JSON.stringify(msg.slice(0, 200))}`)
  }
}
