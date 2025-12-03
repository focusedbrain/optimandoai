/**
 * Image Provider Types and Configuration
 * Cloud image generation APIs only
 * 
 * NOTE: Local image engines (ComfyUI, Automatic1111, SD.Next, InvokeAI) are 
 * intentionally NOT supported due to security concerns:
 * - They load untrusted dependencies at runtime
 * - No audit trail for code execution
 * - Potential for supply chain attacks
 */

// Cloud API provider identifiers
export type CloudImageProviderId = 'replicate' | 'banana' | 'together' | 'openai-dalle' | 'stability'

// Model types for categorization
export type ImageModelType = 'flux' | 'sdxl' | 'sd15' | 'dalle3' | 'sd3' | 'custom'

/**
 * Image model configuration
 */
export interface ImageModelConfig {
  id: string
  name: string
  displayName: string
  type: ImageModelType
  description?: string
  // Model-specific settings
  defaultWidth?: number
  defaultHeight?: number
  maxWidth?: number
  maxHeight?: number
}

/**
 * Cloud image API provider configuration
 */
export interface CloudImageProviderConfig {
  id: CloudImageProviderId
  name: string
  displayName: string
  description: string
  enabled: boolean
  status: 'connected' | 'disconnected' | 'checking' | 'error'
  statusMessage?: string
  // API configuration
  apiKey?: string
  apiEndpoint: string
  // Available models
  models: ImageModelConfig[]
  // Documentation
  pricingUrl?: string
  docsUrl: string
}

/**
 * Image provider (unified interface for cloud providers)
 */
export interface ImageProvider {
  id: string
  type: 'cloud'
  name: string
  displayName: string
  enabled: boolean
  status: 'connected' | 'disconnected' | 'checking' | 'error'
  models: ImageModelConfig[]
}

/**
 * Image providers storage configuration
 */
export interface ImageProvidersConfig {
  cloud: CloudImageProviderConfig[]
  // Default provider for new agent boxes
  defaultProviderId?: string
  defaultModelId?: string
}

/**
 * Default cloud API provider configurations
 * These are official, audited API services from established providers
 */
export const DEFAULT_CLOUD_PROVIDERS: CloudImageProviderConfig[] = [
  {
    id: 'replicate',
    name: 'replicate',
    displayName: 'Replicate',
    description: 'Run Flux, SDXL, and thousands of AI models via API. Pay per prediction.',
    enabled: false,
    status: 'disconnected',
    apiEndpoint: 'https://api.replicate.com/v1',
    models: [
      { id: 'flux-schnell', name: 'flux-schnell', displayName: 'Flux Schnell', type: 'flux', description: 'Fast Flux model' },
      { id: 'flux-dev', name: 'flux-dev', displayName: 'Flux Dev', type: 'flux', description: 'High quality Flux model' },
      { id: 'sdxl', name: 'sdxl', displayName: 'SDXL', type: 'sdxl', description: 'Stable Diffusion XL' }
    ],
    pricingUrl: 'https://replicate.com/pricing',
    docsUrl: 'https://replicate.com/docs'
  },
  {
    id: 'banana',
    name: 'banana',
    displayName: 'Banana.dev',
    description: 'Serverless GPU infrastructure for AI models. Deploy custom models or use pre-built ones.',
    enabled: false,
    status: 'disconnected',
    apiEndpoint: 'https://api.banana.dev',
    models: [
      { id: 'sdxl-base', name: 'sdxl-base', displayName: 'SDXL Base', type: 'sdxl' },
      { id: 'sd-1.5', name: 'sd-1.5', displayName: 'SD 1.5', type: 'sd15' }
    ],
    pricingUrl: 'https://www.banana.dev/pricing',
    docsUrl: 'https://docs.banana.dev/'
  },
  {
    id: 'together',
    name: 'together',
    displayName: 'Together AI',
    description: 'Fast inference for Flux and other image models with competitive pricing.',
    enabled: false,
    status: 'disconnected',
    apiEndpoint: 'https://api.together.xyz/v1',
    models: [
      { id: 'flux-schnell', name: 'black-forest-labs/FLUX.1-schnell', displayName: 'Flux Schnell', type: 'flux' },
      { id: 'flux-dev', name: 'black-forest-labs/FLUX.1-dev', displayName: 'Flux Dev', type: 'flux' }
    ],
    pricingUrl: 'https://www.together.ai/pricing',
    docsUrl: 'https://docs.together.ai/'
  },
  {
    id: 'openai-dalle',
    name: 'openai-dalle',
    displayName: 'OpenAI DALL·E 3',
    description: 'State-of-the-art image generation from OpenAI. Best for prompt following and text rendering.',
    enabled: false,
    status: 'disconnected',
    apiEndpoint: 'https://api.openai.com/v1',
    models: [
      { id: 'dall-e-3', name: 'dall-e-3', displayName: 'DALL·E 3', type: 'dalle3', description: 'Latest DALL·E model', defaultWidth: 1024, defaultHeight: 1024 },
      { id: 'dall-e-2', name: 'dall-e-2', displayName: 'DALL·E 2', type: 'dalle3', description: 'Previous generation', defaultWidth: 512, defaultHeight: 512 }
    ],
    pricingUrl: 'https://openai.com/pricing',
    docsUrl: 'https://platform.openai.com/docs/guides/images'
  },
  {
    id: 'stability',
    name: 'stability',
    displayName: 'Stability AI',
    description: 'Official Stable Diffusion API from the creators. Access to SD3, SDXL, and more.',
    enabled: false,
    status: 'disconnected',
    apiEndpoint: 'https://api.stability.ai/v1',
    models: [
      { id: 'sd3-medium', name: 'sd3-medium', displayName: 'SD3 Medium', type: 'sd3', description: 'Stable Diffusion 3' },
      { id: 'sdxl-1.0', name: 'stable-diffusion-xl-1024-v1-0', displayName: 'SDXL 1.0', type: 'sdxl' },
      { id: 'sd-1.6', name: 'stable-diffusion-v1-6', displayName: 'SD 1.6', type: 'sd15' }
    ],
    pricingUrl: 'https://platform.stability.ai/pricing',
    docsUrl: 'https://platform.stability.ai/docs/api-reference'
  }
]

/**
 * Get default image providers configuration (cloud only)
 */
export function getDefaultImageProvidersConfig(): ImageProvidersConfig {
  return {
    cloud: [...DEFAULT_CLOUD_PROVIDERS]
  }
}

/**
 * Get all enabled cloud providers
 */
export function getEnabledImageProviders(config: ImageProvidersConfig): ImageProvider[] {
  const providers: ImageProvider[] = []
  
  for (const cloud of config.cloud) {
    if (cloud.enabled && cloud.status === 'connected') {
      providers.push({
        id: cloud.id,
        type: 'cloud',
        name: cloud.name,
        displayName: cloud.displayName,
        enabled: cloud.enabled,
        status: cloud.status,
        models: cloud.models
      })
    }
  }
  
  return providers
}
