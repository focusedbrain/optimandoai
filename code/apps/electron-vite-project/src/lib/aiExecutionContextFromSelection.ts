/**
 * Build the payload for `llm:setAiExecutionContext` from the unified model selector row + Host inference targets.
 */

import type { HostInferenceTargetRow } from '../hooks/useSandboxHostInference'
import {
  findHostInferenceTargetRowForChatSelection,
  inferHostModelRemoteLane,
} from './hostAiRemoteChatLane'
import { isHostInferenceModelId, parseAnyHostInferenceModelId } from './hostInferenceModelIds'

export type AiExecutionContextIpcPayload = {
  lane: 'local' | 'ollama_direct' | 'beap'
  model: string
  baseUrl?: string
  handshakeId?: string
  peerDeviceId?: string
  beapReady?: boolean
  ollamaDirectReady?: boolean
  models?: string[]
}

function normalizeModelName(row: HostInferenceTargetRow, parsedModel?: string): string | null {
  const m =
    (parsedModel?.trim() ||
      String(row.model ?? '').trim() ||
      String(row.model_id ?? '').trim()).trim()
  if (!m || m === 'checking' || m === 'unavailable' || m === 'offline' || m === 'unreachable') return null
  return m
}

export function buildAiExecutionContextIpcPayload(
  selectedModelId: string,
  targets: HostInferenceTargetRow[],
): AiExecutionContextIpcPayload | null {
  const id = String(selectedModelId ?? '').trim()
  if (!id) return null

  if (!isHostInferenceModelId(id)) {
    return {
      lane: 'local',
      model: id,
      ollamaDirectReady: false,
      beapReady: false,
    }
  }

  const row = findHostInferenceTargetRowForChatSelection(targets, id)
  if (!row) return null

  const parsed = parseAnyHostInferenceModelId(id)
  const model = normalizeModelName(row, parsed?.model)
  if (!model) return null

  const laneGuess = inferHostModelRemoteLane(row)
  const lane: AiExecutionContextIpcPayload['lane'] =
    laneGuess === 'ollama_direct' ? 'ollama_direct' : 'beap'

  const models = [
    ...new Set(
      targets
        .filter((t) => t.handshake_id === row.handshake_id)
        .map((t) => normalizeModelName(t))
        .filter((m): m is string => m != null),
    ),
  ]

  return {
    lane,
    model,
    handshakeId: row.handshake_id,
    peerDeviceId: row.host_device_id,
    beapReady: row.beapReady,
    ollamaDirectReady: row.ollamaDirectReady,
    models: models.length ? models : undefined,
  }
}
