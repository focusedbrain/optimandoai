/**
 * Serializable IPC payloads for {@link InferenceRoutingUnavailableError} — single message source for
 * chatWithContextRag, inbox, and any other sandbox inference surface.
 */

import {
  isInferenceRoutingUnavailableError,
  type InferenceRoutingUnavailableError,
} from './chatWithContextRagOllamaGeneration'

export type InferenceRoutingReason = InferenceRoutingUnavailableError['reason']

export function inferenceRoutingUnavailableUserMessage(reason: InferenceRoutingReason, detail?: string): string {
  if (reason === 'cross_device_caps_not_accepted') {
    return detail?.trim()
      ? `Connection to host AI is incomplete. ${detail}`
      : 'Connection to host AI is incomplete. Try reconnecting from the host.'
  }
  if (reason === 'no_local_ollama_no_cross_device_host') {
    return 'No AI available. Either install Ollama on this device, or connect to a host running Ollama.'
  }
  return detail?.trim() || 'Inference is not available on this device.'
}

/**
 * Returns a plain IPC-serializable failure object, or `null` when `err` is not routing-unavailable.
 */
export function mapInferenceRoutingErrorToIPC(err: unknown): {
  success: false
  error: 'inference_routing_unavailable'
  inferenceRoutingReason: InferenceRoutingReason
  message: string
} | null {
  if (!isInferenceRoutingUnavailableError(err)) return null
  const reason = err.reason
  return {
    success: false,
    error: 'inference_routing_unavailable',
    inferenceRoutingReason: reason,
    message: inferenceRoutingUnavailableUserMessage(reason, err.detail),
  }
}
