/**
 * RETIRED LANE: Sandbox→Host plaintext `ollama_direct` chat (`POST {base}/api/chat`).
 *
 * Sandbox→Host inference now rides the **sealed relay** transport
 * (`runSandboxHostInferenceChat` → `sendSealedHostAiInferenceRequest`). This module is a
 * fail-closed stub so no caller can emit plaintext LAN inference to a `192.168.x:11434` endpoint.
 * See `.cursor/rules/internal-inference-p2p-invariants.mdc`.
 */

import { InternalInferenceErrorCode } from './errors'

export async function executeSandboxHostAiOllamaDirectChat(_p: {
  handshakeId: string
  currentDeviceId: string
  peerHostDeviceId: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  model: string | undefined
  timeoutMs: number
  temperature?: number
  max_tokens?: number
  responseFormat?: 'json'
  _ollamaDirectRetryConsumed?: boolean
}): Promise<
  | { ok: true; output: string; model: string; duration_ms: number }
  | { ok: false; code: string; message: string }
> {
  return {
    ok: false,
    code: InternalInferenceErrorCode.POLICY_FORBIDDEN,
    message: 'ollama_direct LAN inference is retired; use the sealed relay transport',
  }
}
