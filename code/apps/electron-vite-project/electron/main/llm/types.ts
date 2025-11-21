/**
 * LLM Integration Types
 * Core type definitions for LLM services, hardware detection, and configuration
 */

export type ModelProvider = 'ollama' | 'openai' | 'anthropic' | 'gemini'
export type RamTier = 'insufficient' | 'minimal' | 'recommended' | 'excellent'

/**
 * Hardware information detected from the system
 */
export interface HardwareInfo {
  totalRamGb: number
  cpuCores: number
  osType: 'windows' | 'macos' | 'linux'
  recommendedTier: RamTier
  canRunMistral7B: boolean
  warnings?: string[]
}

/**
 * Configuration for a specific LLM model
 */
export interface LlmModelConfig {
  id: string              // e.g., "mistral:7b"
  displayName: string     // e.g., "Mistral 7B"
  provider: ModelProvider
  minRamGb: number
  recommendedRamGb: number
  diskSizeGb: number
  contextWindow: number
}

/**
 * Runtime status of the LLM system
 */
export interface LlmRuntimeStatus {
  ollamaInstalled: boolean
  ollamaVersion?: string
  modelAvailable: boolean
  modelName?: string
  endpointUrl: string
  isReady: boolean
  error?: string
}

/**
 * Chat message format (compatible with OpenAI-style APIs)
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Request to perform a chat completion
 */
export interface ChatCompletionRequest {
  modelId?: string        // defaults to config default
  messages: ChatMessage[]
  maxTokens?: number
  temperature?: number
  stream?: boolean
}

/**
 * Response from a chat completion
 */
export interface ChatCompletionResponse {
  content: string
  tokensUsed?: number
  model: string
  raw?: unknown
}

/**
 * User configuration for LLM
 * Basic config stored in JSON, secrets (apiKey) in encrypted SQLite
 */
export interface LlmConfig {
  provider: ModelProvider
  modelId: string
  endpointUrl: string
  ramTier: RamTier
  autoStartOllama: boolean
  apiKey?: string         // For remote providers (stored encrypted)
}

/**
 * Model download progress event
 */
export interface ModelDownloadProgress {
  progress: number        // 0-100
  status: string          // 'downloading', 'pulling', 'verifying', etc.
  completed?: number      // bytes completed
  total?: number          // total bytes
}

