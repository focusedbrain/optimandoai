/** Legacy virtual chat model id for Host-side Ollama via direct P2P (non-streaming). */
export const HOST_INFERENCE_PREFIX = 'host-inference:'

/** Preferred id: includes model for stable routing (`host-internal:<encHid>:<encModel>`). */
export const HOST_INTERNAL_PREFIX = 'host-internal:'

export function hostInferenceModelId(handshakeId: string): string {
  return `${HOST_INFERENCE_PREFIX}${handshakeId.trim()}`
}

/** Build canonical Host internal id (use in new UI). */
export function hostInternalInferenceModelId(handshakeId: string, model: string): string {
  return `${HOST_INTERNAL_PREFIX}${encodeURIComponent(handshakeId.trim())}:${encodeURIComponent(model.trim())}`
}

export function parseHostInferenceModelId(
  id: string | null | undefined,
): { handshakeId: string } | null {
  if (typeof id !== 'string' || !id.startsWith(HOST_INFERENCE_PREFIX)) {
    return null
  }
  const handshakeId = id.slice(HOST_INFERENCE_PREFIX.length).trim()
  return handshakeId ? { handshakeId } : null
}

export function parseHostInternalInferenceModelId(
  id: string | null | undefined,
): { handshakeId: string; model: string } | null {
  if (typeof id !== 'string' || !id.startsWith(HOST_INTERNAL_PREFIX)) {
    return null
  }
  const body = id.slice(HOST_INTERNAL_PREFIX.length)
  const col = body.indexOf(':')
  if (col < 0) return null
  const encH = body.slice(0, col)
  const encM = body.slice(col + 1)
  try {
    const handshakeId = decodeURIComponent(encH)
    const model = decodeURIComponent(encM)
    if (!handshakeId) return null
    return { handshakeId, model }
  } catch {
    return null
  }
}

/**
 * Resolves Host routing from any supported id (legacy or canonical).
 * When legacy `host-inference:<hid>`, model is undefined (Host picks default).
 */
export function parseAnyHostInferenceModelId(
  id: string | null | undefined,
): { handshakeId: string; model: string | undefined } | null {
  const v2 = parseHostInternalInferenceModelId(id)
  if (v2) {
    const m = v2.model.trim()
    if (!m || m === '—' || m === 'offline' || m === 'unreachable' || m === 'unconfigured' || m === 'inactive') {
      return { handshakeId: v2.handshakeId, model: undefined }
    }
    return { handshakeId: v2.handshakeId, model: v2.model }
  }
  const legacy = parseHostInferenceModelId(id)
  if (legacy) {
    return { handshakeId: legacy.handshakeId, model: undefined }
  }
  return null
}

export function isHostInferenceModelId(id: string | null | undefined): boolean {
  return parseAnyHostInferenceModelId(id) != null
}

/**
 * Ollama `/api/chat` and `/api/embed` expect a registry model name (e.g. `gemma3:12b`).
 * Chat selectors may use opaque ids (`host-internal:<encHid>:<encModel>`); strip to the bare name.
 * Plain local/cloud ids pass through unchanged.
 */
export function bareOllamaModelNameForApi(chatModelId: string | undefined): string {
  const raw = typeof chatModelId === 'string' ? chatModelId.trim() : ''
  if (!raw) return ''
  const parsed = parseAnyHostInferenceModelId(raw)
  if (parsed?.model && parsed.model.trim()) {
    return parsed.model.trim()
  }
  return raw
}
