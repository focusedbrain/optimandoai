/**
 * Host chat routing: each selector row is either BEAP/top-chat or LAN `ollama_direct`.
 * Never resolve by `handshake_id` alone when multiple rows exist for the same pair.
 */

import type { HostInferenceTargetRow } from '../hooks/useSandboxHostInference'
import { parseAnyHostInferenceModelId } from './hostInferenceModelIds'

export type HostModelRemoteLane = 'beap' | 'ollama_direct'

/** BEAP path: WebRTC / top-chat; ODL: `execution_transport === 'ollama_direct'`. */
export function inferHostModelRemoteLane(t: HostInferenceTargetRow): HostModelRemoteLane {
  return t.execution_transport === 'ollama_direct' ? 'ollama_direct' : 'beap'
}

/**
 * Prefer exact `id` match, then handshake + model name, else first row for handshake (legacy `host-inference:`).
 */
export function findHostInferenceTargetRowForChatSelection(
  targets: HostInferenceTargetRow[],
  selectedModelId: string,
): HostInferenceTargetRow | undefined {
  const exact = targets.find((x) => x.id === selectedModelId)
  if (exact) return exact
  const parsed = parseAnyHostInferenceModelId(selectedModelId)
  if (!parsed) return undefined
  const hid = parsed.handshakeId
  const want = parsed.model?.trim()
  if (want) {
    const byModel = targets.find(
      (x) =>
        x.handshake_id === hid &&
        (String(x.model ?? '').trim() === want || String(x.model_id ?? '').trim() === want),
    )
    if (byModel) return byModel
  }
  return targets.find((x) => x.handshake_id === hid)
}
