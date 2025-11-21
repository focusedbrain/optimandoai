/**
 * LLM Configuration Service
 * Manages LLM configuration with JSON file persistence
 * Future: Move API keys to encrypted orchestrator-db
 */

import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import type { LlmConfig } from './types'

/**
 * Default LLM configuration
 * Used when no config file exists (first run)
 * Uses quantized model by default for broader hardware compatibility
 */
export const DEFAULT_LLM_CONFIG: LlmConfig = {
  provider: 'ollama',
  modelId: 'mistral:7b-instruct-q4_0',  // Quantized 4-bit for low-end hardware
  endpointUrl: 'http://127.0.0.1:11434',
  ramTier: 'recommended',
  autoStartOllama: true
}

/**
 * Predefined model configurations for reference
 * All opensource models compatible with Ollama
 */
export const MODEL_CONFIGS = {
  // Quantized Mistral models (recommended for most users)
  'mistral:7b-instruct-q4_0': {
    id: 'mistral:7b-instruct-q4_0',
    displayName: 'Mistral 7B Q4 (Fast)',
    provider: 'ollama' as const,
    minRamGb: 4,
    recommendedRamGb: 6,
    diskSizeGb: 2.6,
    contextWindow: 8192,
    isQuantized: true,
    quantization: 'Q4_0'
  },
  'mistral:7b-instruct-q5_K_M': {
    id: 'mistral:7b-instruct-q5_K_M',
    displayName: 'Mistral 7B Q5 (Balanced)',
    provider: 'ollama' as const,
    minRamGb: 5,
    recommendedRamGb: 7,
    diskSizeGb: 3.2,
    contextWindow: 8192,
    isQuantized: true,
    quantization: 'Q5_K_M'
  },
  // Full precision Mistral (for high-end hardware only)
  'mistral:7b': {
    id: 'mistral:7b',
    displayName: 'Mistral 7B (Best Quality)',
    provider: 'ollama' as const,
    minRamGb: 8,
    recommendedRamGb: 12,
    diskSizeGb: 4.1,
    contextWindow: 8192,
    isQuantized: false
  },
  // Smaller models for low-end hardware
  'phi3:mini': {
    id: 'phi3:mini',
    displayName: 'Phi-3 Mini (Very Fast)',
    provider: 'ollama' as const,
    minRamGb: 2,
    recommendedRamGb: 4,
    diskSizeGb: 2.3,
    contextWindow: 4096,
    isQuantized: false
  },
  'tinyllama': {
    id: 'tinyllama',
    displayName: 'TinyLlama (Ultra Fast)',
    provider: 'ollama' as const,
    minRamGb: 1,
    recommendedRamGb: 2,
    diskSizeGb: 0.6,
    contextWindow: 2048,
    isQuantized: false
  },
  // Standard 8B models
  'llama3:8b': {
    id: 'llama3:8b',
    displayName: 'Llama 3 8B',
    provider: 'ollama' as const,
    minRamGb: 8,
    recommendedRamGb: 12,
    diskSizeGb: 4.7,
    contextWindow: 8192,
    isQuantized: false
  },
  'llama3.1:8b': {
    id: 'llama3.1:8b',
    displayName: 'Llama 3.1 8B',
    provider: 'ollama' as const,
    minRamGb: 8,
    recommendedRamGb: 12,
    diskSizeGb: 4.7,
    contextWindow: 8192,
    isQuantized: false
  },
  // High-end models
  'mixtral:8x7b': {
    id: 'mixtral:8x7b',
    displayName: 'Mixtral 8x7B (MoE)',
    provider: 'ollama' as const,
    minRamGb: 32,
    recommendedRamGb: 48,
    diskSizeGb: 26,
    contextWindow: 32768,
    isQuantized: false
  },
  'llama3.1:70b': {
    id: 'llama3.1:70b',
    displayName: 'Llama 3.1 70B',
    provider: 'ollama' as const,
    minRamGb: 64,
    recommendedRamGb: 80,
    diskSizeGb: 40,
    contextWindow: 8192,
    isQuantized: false
  },
  'qwen2:72b': {
    id: 'qwen2:72b',
    displayName: 'Qwen 2 72B',
    provider: 'ollama' as const,
    minRamGb: 64,
    recommendedRamGb: 80,
    diskSizeGb: 41,
    contextWindow: 32768,
    isQuantized: false
  }
}

export class LlmConfigService {
  private configPath: string
  private config: LlmConfig = { ...DEFAULT_LLM_CONFIG }
  
  constructor() {
    const userDataPath = app.getPath('userData')
    this.configPath = path.join(userDataPath, 'llm-config.json')
    console.log('[LLM CONFIG] Config file path:', this.configPath)
  }
  
  /**
   * Load configuration from file
   * Falls back to defaults if file doesn't exist
   */
  async load(): Promise<LlmConfig> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8')
      const loaded = JSON.parse(data)
      
      // Merge with defaults to ensure all fields are present
      this.config = { ...DEFAULT_LLM_CONFIG, ...loaded }
      
      console.log('[LLM CONFIG] Loaded from file:', {
        provider: this.config.provider,
        modelId: this.config.modelId,
        ramTier: this.config.ramTier
      })
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.log('[LLM CONFIG] No config file found, using defaults')
      } else {
        console.error('[LLM CONFIG] Error loading config:', error)
      }
      this.config = { ...DEFAULT_LLM_CONFIG }
    }
    
    // TODO: Load encrypted secrets (API keys) from orchestrator-db
    // For now, keep apiKey in config
    
    return this.config
  }
  
  /**
   * Save configuration to file
   */
  async save(updates: Partial<LlmConfig>): Promise<void> {
    this.config = { ...this.config, ...updates }
    
    // Don't save sensitive data to JSON
    // Future: Store apiKey in encrypted orchestrator-db
    const { apiKey, ...publicConfig } = this.config
    
    try {
      await fs.writeFile(
        this.configPath, 
        JSON.stringify(publicConfig, null, 2),
        'utf-8'
      )
      
      console.log('[LLM CONFIG] Saved to file:', {
        provider: this.config.provider,
        modelId: this.config.modelId
      })
    } catch (error) {
      console.error('[LLM CONFIG] Error saving config:', error)
      throw new Error(`Failed to save config: ${error}`)
    }
    
    // TODO: Save encrypted secrets to orchestrator-db
  }
  
  /**
   * Get current configuration
   */
  get(): LlmConfig {
    return { ...this.config }
  }
  
  /**
   * Update configuration (in memory only, call save() to persist)
   */
  update(updates: Partial<LlmConfig>): void {
    this.config = { ...this.config, ...updates }
  }
}

// Singleton instance
export const llmConfigService = new LlmConfigService()

