/**
 * Vault / IPC embedding service: resolves an embedding-capable Ollama model via /api/tags
 * before exposing {@link LocalEmbeddingService}. Sandbox routes `/api/embed` like chat.
 */

import { OllamaProvider } from '../handshake/aiProviders'
import type { LocalEmbeddingService } from '../handshake/embeddings'
import { OllamaEmbeddingService } from '../handshake/embeddings'
import { readStoredAiExecutionContext } from '../llm/aiExecutionContextStore'
import { ollamaManager } from '../llm/ollama-manager'
import { resolveOllamaEmbeddingAtBaseUrl } from '../llm/ollamaEmbeddingCapability'
import { isSandboxMode } from '../orchestrator/orchestratorModeStore'
import { getSandboxOllamaDirectRouteCandidate } from './sandboxHostAiOllamaDirectCandidate'
import { wrapOllamaEmbeddingServiceForSandbox, createOllamaProviderForSandboxEmbedding } from './chatWithContextRagOllamaGeneration'

/**
 * Probes the same Ollama base URL used for vault indexing, picks an installed embedding model,
 * and returns null when none exist (semantic search / queue skip — no throw).
 */
export async function createResolvedOrchestratorEmbeddingService(): Promise<LocalEmbeddingService | null> {
  if (!isSandboxMode()) {
    await ollamaManager.probeHttpTagsWithLogging().catch(() => {})
    const baseUrl = ollamaManager.getBaseUrl() || 'http://127.0.0.1:11434'
    const chatModel = (await ollamaManager.getEffectiveChatModelName()) || ''
    const cap = await resolveOllamaEmbeddingAtBaseUrl({
      baseUrl,
      lane: 'local',
      selectedChatModel: chatModel,
    })
    if (!cap.canGenerateEmbeddings || !cap.embeddingModel) return null
    return new OllamaEmbeddingService(cap.embeddingModel, baseUrl)
  }

  const stored = readStoredAiExecutionContext()
  let baseUrl = 'http://127.0.0.1:11434'
  let lane = stored?.lane ?? 'local'
  let handshakeId = stored?.handshakeId?.trim() || undefined
  let peerDeviceId = stored?.peerDeviceId?.trim() || undefined
  const chatModel = stored?.model?.trim() || 'llama3'

  if (stored?.lane === 'ollama_direct' && handshakeId) {
    const cand = getSandboxOllamaDirectRouteCandidate(handshakeId)
    const b = cand?.base_url?.trim().replace(/\/$/, '') ?? ''
    if (b) baseUrl = b
  }

  const cap = await resolveOllamaEmbeddingAtBaseUrl({
    baseUrl,
    lane: lane === 'ollama_direct' || lane === 'beap' ? lane : 'local',
    selectedChatModel: chatModel,
  })
  if (!cap.canGenerateEmbeddings || !cap.embeddingModel) return null

  const fallback = new OllamaProvider({
    baseUrl,
    model: chatModel,
    chatModel,
    embedModel: cap.embeddingModel,
    lane: lane === 'beap' || lane === 'ollama_direct' ? lane : 'local',
    handshakeId,
    peerDeviceId,
  })
  return wrapOllamaEmbeddingServiceForSandbox(createOllamaProviderForSandboxEmbedding(fallback), () => ({}))
}
