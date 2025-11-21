/**
 * LLM Integration Types
 * Core TypeScript interfaces for local LLM management
 */

export type ModelTier = 'lightweight' | 'balanced' | 'performance' | 'high-end'
export type PerformanceEstimate = 'fast' | 'usable' | 'slow' | 'unusable'
export type OsType = 'windows' | 'macos' | 'linux'

/**
 * Hardware information detected from the system
 */
export interface HardwareInfo {
  totalRamGb: number
  freeRamGb: number
  cpuCores: number
  cpuThreads: number
  gpuAvailable: boolean
  gpuVramGb?: number
  diskFreeGb: number
  osType: OsType
  warnings: string[]
  recommendedModels: string[]  // Array of model IDs recommended for this hardware
}

/**
 * LLM Model configuration catalog entry
 */
export interface LlmModelConfig {
  id: string                    // e.g., "mistral:7b-instruct-q4_0"
  displayName: string           // e.g., "Mistral 7B Q4"
  provider: string              // e.g., "Mistral", "Meta", "Microsoft"
  tier: ModelTier
  minRamGb: number
  recommendedRamGb: number
  diskSizeGb: number
  contextWindow: number
  description: string
}

/**
 * Installed model information from Ollama
 */
export interface InstalledModel {
  name: string                  // Full model name with tag
  size: number                  // Size in bytes
  modified: string              // Last modified timestamp
  digest: string                // Model digest/hash
  isActive: boolean             // Whether this is the currently active model
}

/**
 * Ollama runtime status
 */
export interface OllamaStatus {
  installed: boolean            // Ollama binary found
  running: boolean              // Ollama service is running
  version?: string              // Ollama version string
  port: number                  // Port Ollama is running on
  modelsInstalled: InstalledModel[]
  activeModel?: string          // Currently active model ID
}

/**
 * LLM configuration stored in app data
 */
export interface LlmConfig {
  ollamaPath: string            // Path to Ollama binary
  ollamaPort: number            // Port for Ollama API
  activeModelId: string         // Currently active model
  autoStart: boolean            // Auto-start Ollama on app launch
}

/**
 * Chat message for LLM conversation
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Chat request to LLM
 */
export interface ChatRequest {
  modelId?: string              // Optional model override
  messages: ChatMessage[]
  maxTokens?: number
  temperature?: number
  stream?: boolean
}

/**
 * Chat response from LLM
 */
export interface ChatResponse {
  content: string
  model: string
  done: boolean
  totalDuration?: number
  loadDuration?: number
  promptEvalCount?: number
  evalCount?: number
}

/**
 * Model download progress
 */
export interface DownloadProgress {
  modelId: string
  status: string                // e.g., "downloading", "verifying", "complete"
  progress: number              // 0-100
  completed?: number            // Bytes downloaded
  total?: number                // Total bytes
  digest?: string
  error?: string
}

/**
 * Model performance estimate for specific hardware
 */
export interface ModelPerformanceEstimate {
  modelId: string
  estimate: PerformanceEstimate
  reason: string                // Human-readable explanation
  ramUsageGb: number           // Expected RAM usage
  speedEstimate?: string       // e.g., "~5 tokens/sec"
}
