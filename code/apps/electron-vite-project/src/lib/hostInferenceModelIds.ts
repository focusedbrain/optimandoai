/** Virtual chat model id for Host-side Ollama via direct P2P (non-streaming). */
export const HOST_INFERENCE_PREFIX = 'host-inference:'

export function hostInferenceModelId(handshakeId: string): string {
  return `${HOST_INFERENCE_PREFIX}${handshakeId.trim()}`
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

export function isHostInferenceModelId(id: string | null | undefined): boolean {
  return parseHostInferenceModelId(id) != null
}
