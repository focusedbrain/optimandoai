/**
 * RETIRED LANE: Sandbox→Host plaintext `ollama_direct` embeddings (`POST {base}/api/embed`).
 *
 * Option A seals chat inference only; there is no sealed embedding transport, so cross-device
 * Sandbox→Host embeddings fail closed rather than send input over plaintext LAN. This module is a
 * fail-closed stub. See `.cursor/rules/internal-inference-p2p-invariants.mdc`.
 */

import { InternalInferenceErrorCode } from './errors'

export async function executeSandboxHostAiOllamaDirectEmbed(_p: {
  handshakeId: string
  currentDeviceId: string
  peerHostDeviceId: string
  model: string
  input: string
  timeoutMs: number
  _ollamaDirectRetryConsumed?: boolean
}): Promise<{ ok: true; embedding: number[] } | { ok: false; code: string; message: string }> {
  return {
    ok: false,
    code: InternalInferenceErrorCode.POLICY_FORBIDDEN,
    message: 'ollama_direct LAN embedding is retired; no plaintext LAN transport',
  }
}
