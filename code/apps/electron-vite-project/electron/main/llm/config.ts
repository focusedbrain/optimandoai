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
  // Ultra-Lightweight models (0.5-2GB RAM) - Heavily Quantized
  {
    id: 'tinyllama',
    displayName: 'TinyLlama 1.1B (Q4)',
    provider: 'TinyLlama',
    tier: 'lightweight',
    minRamGb: 1,
    recommendedRamGb: 2,
    diskSizeGb: 0.6,
    contextWindow: 2048,
    description: 'Ultra-fast, 4-bit quantized. Best for very old hardware. Good for simple tasks.'
  },
  {
    id: 'qwen2:0.5b',
    displayName: 'Qwen2 0.5B (Q4)',
    provider: 'Alibaba',
    tier: 'lightweight',
    minRamGb: 0.5,
    recommendedRamGb: 1,
    diskSizeGb: 0.4,
    contextWindow: 32768,
    description: 'Smallest model available. 4-bit quantized. 0.5B params. Huge context window. Ultra-fast.'
  },
  {
    id: 'stablelm2:1.6b',
    displayName: 'StableLM 2 1.6B (Q4)',
    provider: 'Stability AI',
    tier: 'lightweight',
    minRamGb: 1,
    recommendedRamGb: 1.5,
    diskSizeGb: 1.0,
    contextWindow: 4096,
    description: '4-bit quantized. 1.6B params. Very fast, good quality for size.'
  },
  {
    id: 'phi3-low',
    displayName: 'Phi-3 Low-Spec 3.8B (Custom Q4)',
    provider: 'Microsoft',
    tier: 'lightweight',
    minRamGb: 1.5,
    recommendedRamGb: 2,
    diskSizeGb: 2.3,
    contextWindow: 1024,
    description: 'Custom optimized 4-bit quantized. Reduced context (1024), batch (16), threads (4). Best performance/quality balance for low-spec.'
  },
  
  // Lightweight models (2-3GB RAM) - 2B-3B params
  {
    id: 'gemma:2b',
    displayName: 'Gemma 2B (Q4_0)',
    provider: 'Google',
    tier: 'lightweight',
    minRamGb: 1.5,
    recommendedRamGb: 2,
    diskSizeGb: 1.4,
    contextWindow: 8192,
    description: '4-bit Q4_0 quantized. 2B params. Google quality, very efficient.'
  },
  {
    id: 'gemma:2b-q2_K',
    displayName: 'Gemma 2B (Q2_K - Ultra Compressed)',
    provider: 'Google',
    tier: 'lightweight',
    minRamGb: 1,
    recommendedRamGb: 1.5,
    diskSizeGb: 0.9,
    contextWindow: 8192,
    description: '2-bit Q2_K quantized. 2B params. Extreme compression, slight quality loss. Fastest option.'
  },
  {
    id: 'phi:2.7b',
    displayName: 'Phi-2 2.7B (Q4)',
    provider: 'Microsoft',
    tier: 'lightweight',
    minRamGb: 1.5,
    recommendedRamGb: 2,
    diskSizeGb: 1.6,
    contextWindow: 2048,
    description: '4-bit quantized. 2.7B params. Excellent for coding and reasoning despite small size.'
  },
  {
    id: 'phi3:mini',
    displayName: 'Phi-3 Mini 3.8B (Q4)',
    provider: 'Microsoft',
    tier: 'lightweight',
    minRamGb: 2,
    recommendedRamGb: 3,
    diskSizeGb: 2.3,
    contextWindow: 4096,
    description: '4-bit quantized. 3.8B params. Very fast and capable for low-end PCs.'
  },
  {
    id: 'phi3:3.8b-q2_K',
    displayName: 'Phi-3 Mini 3.8B (Q2_K - Ultra Light)',
    provider: 'Microsoft',
    tier: 'lightweight',
    minRamGb: 1.5,
    recommendedRamGb: 2,
    diskSizeGb: 1.5,
    contextWindow: 4096,
    description: '2-bit Q2_K quantized. 3.8B params. Extreme compression for weak hardware.'
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
    id: 'llama3.2:3b',
    displayName: 'Llama 3.2 3B (Q4)',
    provider: 'Meta',
    tier: 'balanced',
    minRamGb: 2,
    recommendedRamGb: 3,
    diskSizeGb: 2.0,
    contextWindow: 131072,
    description: '4-bit quantized. Latest Llama 3.2 with 128K context. Excellent for 2-3GB RAM systems.'
  },
  {
    id: 'llama3.1:8b',
    displayName: 'Llama 3.1 8B (Q4)',
    provider: 'Meta',
    tier: 'performance',
    minRamGb: 6,
    recommendedRamGb: 8,
    diskSizeGb: 4.7,
    contextWindow: 131072,
    description: '4-bit quantized. Latest Llama 3.1 with 128K context window. Improved performance.'
  },
  {
    id: 'gemma2:9b',
    displayName: 'Gemma 2 9B (Q4)',
    provider: 'Google',
    tier: 'performance',
    minRamGb: 7,
    recommendedRamGb: 9,
    diskSizeGb: 5.4,
    contextWindow: 8192,
    description: '4-bit quantized. 9B params. Google latest generation with excellent quality.'
  },
  {
    id: 'mistral-nemo:12b',
    displayName: 'Mistral Nemo 12B (Q4)',
    provider: 'Mistral',
    tier: 'performance',
    minRamGb: 8,
    recommendedRamGb: 10,
    diskSizeGb: 7.1,
    contextWindow: 128000,
    description: '4-bit quantized. 12B params. 128K context. Excellent for complex tasks.'
  },
  {
    id: 'qwen2.5:14b',
    displayName: 'Qwen 2.5 14B (Q4)',
    provider: 'Alibaba',
    tier: 'performance',
    minRamGb: 10,
    recommendedRamGb: 12,
    diskSizeGb: 8.5,
    contextWindow: 32768,
    description: '4-bit quantized. 14B params. Latest Qwen with multilingual excellence.'
  },
  {
    id: 'mixtral:8x7b',
    displayName: 'Mixtral 8x7B MoE (Q4)',
    provider: 'Mistral',
    tier: 'high-end',
    minRamGb: 24,
    recommendedRamGb: 32,
    diskSizeGb: 26,
    contextWindow: 32768,
    description: '4-bit quantized. Mixture of Experts model. Excellent reasoning and coding.'
  },
  {
    id: 'deepseek-coder:6.7b',
    displayName: 'DeepSeek Coder 6.7B (Q4)',
    provider: 'DeepSeek',
    tier: 'performance',
    minRamGb: 5,
    recommendedRamGb: 7,
    diskSizeGb: 3.8,
    contextWindow: 16384,
    description: '4-bit quantized. 6.7B params. Specialized for coding tasks.'
  },
  {
    id: 'codellama:13b',
    displayName: 'Code Llama 13B (Q4)',
    provider: 'Meta',
    tier: 'performance',
    minRamGb: 10,
    recommendedRamGb: 13,
    diskSizeGb: 7.4,
    contextWindow: 16384,
    description: '4-bit quantized. 13B params. Meta specialized coding model.'
  },
  {
    id: 'llama3.1:70b',
    displayName: 'Llama 3.1 70B (Q4)',
    provider: 'Meta',
    tier: 'high-end',
    minRamGb: 48,
    recommendedRamGb: 64,
    diskSizeGb: 40,
    contextWindow: 131072,
    description: '4-bit quantized. 70B params. Enterprise-grade. Powerful capabilities, requires high-end hardware.'
  },
  {
    id: 'qwen2.5:72b',
    displayName: 'Qwen 2.5 72B (Q4)',
    provider: 'Alibaba',
    tier: 'high-end',
    minRamGb: 48,
    recommendedRamGb: 64,
    diskSizeGb: 41,
    contextWindow: 32768,
    description: '4-bit quantized. 72B params. Advanced reasoning and multilingual support. Top-tier performance.'
  },
  {
    id: 'llama3.1:405b-q2_K',
    displayName: 'Llama 3.1 405B (Q2_K)',
    provider: 'Meta',
    tier: 'high-end',
    minRamGb: 128,
    recommendedRamGb: 192,
    diskSizeGb: 136,
    contextWindow: 131072,
    description: '2-bit Q2_K quantized. 405B params. Largest Llama model. Extreme hardware requirements.'
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
