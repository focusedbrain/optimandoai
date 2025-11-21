/**
 * Model Catalog and Default Configuration
 * Defines all available LLM models and their specifications
 */

import { LlmModelConfig, LlmConfig, ModelTier } from './types'

/**
 * Complete catalog of available LLM models
 * Sorted by tier and resource requirements
 */
export const MODEL_CATALOG: LlmModelConfig[] = [
  // Lightweight models (1-3GB RAM)
  {
    id: 'tinyllama',
    displayName: 'TinyLlama 1.1B',
    provider: 'TinyLlama',
    tier: 'lightweight',
    minRamGb: 1,
    recommendedRamGb: 2,
    diskSizeGb: 0.6,
    contextWindow: 2048,
    description: 'Ultra-fast, best for very old hardware. Good for simple tasks.'
  },
  {
    id: 'phi3-low',
    displayName: 'Phi-3 Low-Spec (Custom)',
    provider: 'Microsoft',
    tier: 'lightweight',
    minRamGb: 1.5,
    recommendedRamGb: 2,
    diskSizeGb: 2.3,
    contextWindow: 1024,
    description: 'Custom optimized Phi-3 for very low-spec systems. Reduced context, batch size, and threads.'
  },
  {
    id: 'phi3:mini',
    displayName: 'Phi-3 Mini 3.8B',
    provider: 'Microsoft',
    tier: 'lightweight',
    minRamGb: 2,
    recommendedRamGb: 3,
    diskSizeGb: 2.3,
    contextWindow: 4096,
    description: 'Very fast and capable. Recommended for low-end PCs.'
  },
  
  // Balanced models (3-8GB RAM)
  {
    id: 'mistral:7b-instruct-q4_0',
    displayName: 'Mistral 7B Q4 (Quantized)',
    provider: 'Mistral',
    tier: 'balanced',
    minRamGb: 3,
    recommendedRamGb: 4,
    diskSizeGb: 2.6,
    contextWindow: 8192,
    description: 'Default model. Excellent balance of speed and quality.'
  },
  {
    id: 'mistral:7b-instruct-q5_K_M',
    displayName: 'Mistral 7B Q5 (Quantized)',
    provider: 'Mistral',
    tier: 'balanced',
    minRamGb: 4,
    recommendedRamGb: 5,
    diskSizeGb: 3.2,
    contextWindow: 8192,
    description: 'Better quality than Q4, slightly more RAM required.'
  },
  {
    id: 'llama3:8b',
    displayName: 'Llama 3 8B',
    provider: 'Meta',
    tier: 'balanced',
    minRamGb: 5,
    recommendedRamGb: 6,
    diskSizeGb: 4.7,
    contextWindow: 8192,
    description: 'High-quality responses, good reasoning capabilities.'
  },
  
  // Performance models (8-16GB RAM)
  {
    id: 'mistral:7b',
    displayName: 'Mistral 7B (Full Precision)',
    provider: 'Mistral',
    tier: 'performance',
    minRamGb: 7,
    recommendedRamGb: 8,
    diskSizeGb: 4.1,
    contextWindow: 8192,
    description: 'Full quality Mistral, no quantization. Requires more RAM.'
  },
  {
    id: 'llama3.1:8b',
    displayName: 'Llama 3.1 8B',
    provider: 'Meta',
    tier: 'performance',
    minRamGb: 6,
    recommendedRamGb: 8,
    diskSizeGb: 4.7,
    contextWindow: 131072,
    description: 'Latest Llama version with 128K context window. Improved performance.'
  },
  
  // High-end models (16GB+ RAM)
  {
    id: 'mixtral:8x7b',
    displayName: 'Mixtral 8x7B (MoE)',
    provider: 'Mistral',
    tier: 'high-end',
    minRamGb: 24,
    recommendedRamGb: 32,
    diskSizeGb: 26,
    contextWindow: 32768,
    description: 'Mixture of Experts model. Excellent reasoning and coding.'
  },
  {
    id: 'llama3.1:70b',
    displayName: 'Llama 3.1 70B',
    provider: 'Meta',
    tier: 'high-end',
    minRamGb: 48,
    recommendedRamGb: 64,
    diskSizeGb: 40,
    contextWindow: 131072,
    description: 'Enterprise-grade model. Powerful capabilities, requires high-end hardware.'
  },
  {
    id: 'qwen2:72b',
    displayName: 'Qwen 2 72B',
    provider: 'Alibaba',
    tier: 'high-end',
    minRamGb: 48,
    recommendedRamGb: 64,
    diskSizeGb: 41,
    contextWindow: 32768,
    description: 'Advanced reasoning and multilingual support. Top-tier performance.'
  }
]

/**
 * Default LLM configuration
 * ollamaPath will be set at runtime based on bundled location
 */
export const DEFAULT_CONFIG: LlmConfig = {
  ollamaPath: '',  // Set dynamically based on app resources path
  ollamaPort: 11434,
  activeModelId: 'mistral:7b-instruct-q4_0',
  autoStart: true
}

/**
 * Get model config by ID
 */
export function getModelConfig(modelId: string): LlmModelConfig | undefined {
  return MODEL_CATALOG.find(m => m.id === modelId)
}

/**
 * Get all models by tier
 */
export function getModelsByTier(tier: ModelTier): LlmModelConfig[] {
  return MODEL_CATALOG.filter(m => m.tier === tier)
}

/**
 * Get models within RAM budget
 */
export function getModelsForRam(freeRamGb: number): LlmModelConfig[] {
  return MODEL_CATALOG.filter(m => m.recommendedRamGb <= freeRamGb)
}
