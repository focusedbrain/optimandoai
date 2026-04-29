/**
 * Vault / IPC embedding service: in Sandbox + Ollama uses resolver (active handshake heuristic when no scope).
 * Host mode uses {@link getOrCreateEmbeddingService} directly.
 */

import { OllamaProvider } from '../handshake/aiProviders'
import type { LocalEmbeddingService } from '../handshake/embeddings'
import { getOrCreateEmbeddingService } from '../handshake/embeddings'
import { isSandboxMode } from '../orchestrator/orchestratorModeStore'
import { wrapOllamaEmbeddingServiceForSandbox } from './chatWithContextRagOllamaGeneration'

let _sandboxRouted: LocalEmbeddingService | null = null

const defaultOllamaEmbeddingProvider = (): OllamaProvider => new OllamaProvider()

/**
 * Same role as `getOrCreateEmbeddingService`, but sandbox orchestrator routes `/api/embed` through
 * {@link resolveSandboxInferenceTarget} when the default profile is Ollama.
 */
export function getOrCreateOrchestratorEmbeddingService(): LocalEmbeddingService {
  if (!isSandboxMode()) {
    return getOrCreateEmbeddingService()
  }
  if (!_sandboxRouted) {
    _sandboxRouted = wrapOllamaEmbeddingServiceForSandbox(defaultOllamaEmbeddingProvider(), () => ({}))
  }
  return _sandboxRouted
}
