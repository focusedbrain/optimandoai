/**
 * Shared execution context for Ollama-backed AI tasks (inbox, chat, BEAP tools).
 * Persists the user's model-selector choice so main never depends solely on localhost tags.
 */

export type AiExecutionLane = 'local' | 'ollama_direct' | 'beap'

export type AiExecutionContext = {
  lane: AiExecutionLane
  model: string
  baseUrl?: string
  handshakeId?: string
  peerDeviceId?: string
  beapReady?: boolean
  ollamaDirectReady?: boolean
  /** Remote model names for this Host / handshake (from selector); optional cache. */
  models?: string[]
  /** Present for model-selector writes; legacy files without this are treated as non-explicit fallbacks. */
  selectionSource?: 'user'
}

/** IPC / disk payload before normalization (renderer → main). */
export type AiExecutionContextInput = {
  lane: AiExecutionLane
  model: string
  baseUrl?: string
  handshakeId?: string
  peerDeviceId?: string
  beapReady?: boolean
  ollamaDirectReady?: boolean
  models?: string[]
  selectionSource?: 'user'
}

export type ResolveAiExecutionContextResult =
  | { ok: true; ctx: AiExecutionContext }
  | { ok: false; error: string }

export type { AiModelCapability } from './ollamaEmbeddingCapability'
