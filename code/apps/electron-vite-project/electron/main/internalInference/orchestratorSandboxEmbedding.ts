/**
 * Vault / IPC embedding: optional async resolver (tag probe) — use only when explicitly needed.
 * Default vault unlock path uses {@link getOrCreateOrchestratorEmbeddingService} so OIDC/session
 * startup does not wait on Ollama / Host AI.
 */

import { OllamaProvider } from '../handshake/aiProviders'
import type { LocalEmbeddingService } from '../handshake/embeddings'
import { getOrCreateEmbeddingService, OllamaEmbeddingService } from '../handshake/embeddings'
import { readStoredAiExecutionContext } from '../llm/aiExecutionContextStore'
import { ollamaManager } from '../llm/ollama-manager'
import { resolveOllamaEmbeddingAtBaseUrl } from '../llm/ollamaEmbeddingCapability'
import { isSandboxMode } from '../orchestrator/orchestratorModeStore'
import { getSandboxOllamaDirectRouteCandidate } from './sandboxHostAiOllamaDirectCandidate'
import { wrapOllamaEmbeddingServiceForSandbox, createOllamaProviderForSandboxEmbedding } from './chatWithContextRagOllamaGeneration'

let _sandboxOrchestratorEmbedding: LocalEmbeddingService | null = null

const defaultOllamaEmbeddingProvider = (): OllamaProvider => new OllamaProvider()

/**
 * Vault unlock / IPC hot path: synchronous factory — no Ollama tag probe, no Host-AI execution context.
 * Same behavior as pre-build128 orchestrator embedding wiring.
 */
export function getOrCreateOrchestratorEmbeddingService(): LocalEmbeddingService {
  if (!isSandboxMode()) {
    return getOrCreateEmbeddingService()
  }
  if (!_sandboxOrchestratorEmbedding) {
    _sandboxOrchestratorEmbedding = wrapOllamaEmbeddingServiceForSandbox(
      defaultOllamaEmbeddingProvider(),
      () => ({}),
    )
  }
  return _sandboxOrchestratorEmbedding
}

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

