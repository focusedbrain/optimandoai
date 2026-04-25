/**
 * Mirror of electron-vite-project `hostInferenceModelIds` for WR Chat (PopupChatView) routing.
 */

const HOST_INFERENCE_PREFIX = 'host-inference:'
const HOST_INTERNAL_PREFIX = 'host-internal:'

function parseHostInferenceModelId(id: string | null | undefined): { handshakeId: string } | null {
  if (typeof id !== 'string' || !id.startsWith(HOST_INFERENCE_PREFIX)) {
    return null
  }
  const handshakeId = id.slice(HOST_INFERENCE_PREFIX.length).trim()
  return handshakeId ? { handshakeId } : null
}

function parseHostInternalInferenceModelId(id: string | null | undefined): { handshakeId: string; model: string } | null {
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

export function isHostInferenceRouteId(id: string | null | undefined): boolean {
  return parseAnyHostInferenceModelId(id) != null
}
