/**
 * Build `llm.setAiExecutionContext` body for extension WR Chat (sidebar/popup).
 * Mirrors electron `buildAiExecutionContextIpcPayload` semantics without importing the app package.
 */

import { isHostInferenceRouteId, parseAnyHostInferenceModelId } from './hostInferenceRouteIds'
import type { WrChatSelectorRow } from './wrChatModelsFromLlmStatus'

export type WrChatExtensionAiExecutionPayload = {
  lane: 'local' | 'ollama_direct' | 'beap'
  model: string
  baseUrl?: string
  handshakeId?: string
  peerDeviceId?: string
  beapReady?: boolean
  ollamaDirectReady?: boolean
  models?: string[]
}

function normalizeHostModelFromRow(row: WrChatSelectorRow | undefined, parsedModel?: string): string | null {
  const m = (parsedModel?.trim() || row?.name || '').trim()
  if (!m || m === 'checking' || m === 'unavailable' || m === 'offline' || m === 'unreachable') return null
  return m
}

/**
 * Returns null if a snapshot cannot be built (e.g. host row missing); callers should skip RPC in that case.
 */
export function buildWrChatExtensionAiExecutionPayload(
  selectedModelId: string,
  rows: readonly WrChatSelectorRow[],
): WrChatExtensionAiExecutionPayload | null {
  const id = String(selectedModelId ?? '').trim()
  if (!id) return null

  if (!isHostInferenceRouteId(id)) {
    return {
      lane: 'local',
      model: id,
      ollamaDirectReady: false,
      beapReady: false,
    }
  }

  const row = rows.find((r) => r.name === id)
  const parsed = parseAnyHostInferenceModelId(id)
  if (!parsed) return null

  const model = normalizeHostModelFromRow(row, parsed.model)
  if (!model) return null

  const lane: WrChatExtensionAiExecutionPayload['lane'] =
    row?.execution_transport === 'ollama_direct' ? 'ollama_direct' : 'beap'

  return {
    lane,
    model,
    handshakeId: parsed.handshakeId,
    beapReady: lane === 'beap' ? true : false,
    ollamaDirectReady: lane === 'ollama_direct' ? true : false,
  }
}
