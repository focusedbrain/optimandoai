/**
 * Image Provider Types and Configuration
 * Defines all image generation providers (local engines and cloud APIs)
 */

// Provider type discriminator
export type ImageProviderType = 'local' | 'cloud'

// Local engine identifiers
export type LocalEngineId = 'comfyui' | 'automatic1111' | 'sdnext' | 'invokeai'

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
 * Local image engine configuration
 */
export interface LocalImageEngineConfig {
  id: LocalEngineId
  name: string
  displayName: string
  description: string
  enabled: boolean
  status: 'connected' | 'disconnected' | 'checking' | 'error'
  statusMessage?: string
  // Connection settings
  endpoint: string
  defaultPort: number
  // Health check endpoint
  healthCheckPath: string
  // Models API endpoint (if available)
  modelsApiPath?: string
  // Registered models
  models: ImageModelConfig[]
  // Installation info
  installUrl: string
  docsUrl: string
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
 * Combined image provider (unified interface for both local and cloud)
 */
export interface ImageProvider {
  id: string
  type: ImageProviderType
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
  local: LocalImageEngineConfig[]
  cloud: CloudImageProviderConfig[]
  // Default provider for new agent boxes
  defaultProviderId?: string
  defaultModelId?: string
}

/**
 * Default local engine configurations
 * Users must install these tools from official sources
 * 
 * SECURITY NOTE: All local engines should bind to 127.0.0.1 (localhost) only.
 * Never expose these services on 0.0.0.0 or forward ports externally.
 */
export const DEFAULT_LOCAL_ENGINES: LocalImageEngineConfig[] = [
  {
    id: 'comfyui',
    name: 'comfyui',
    displayName: 'ComfyUI',
    description: 'Node-based Stable Diffusion interface. Runs on localhost only (127.0.0.1:8188).',
    enabled: false,
    status: 'disconnected',
    endpoint: 'http://127.0.0.1:8188',
    defaultPort: 8188,
    healthCheckPath: '/system_stats',
    modelsApiPath: '/object_info',
    models: [],
    installUrl: 'https://github.com/comfyanonymous/ComfyUI',
    docsUrl: 'https://github.com/comfyanonymous/ComfyUI#readme'
  },
  {
    id: 'automatic1111',
    name: 'automatic1111',
    displayName: 'Automatic1111',
    description: 'Popular Stable Diffusion Web UI with extensive features and extensions ecosystem.',
    enabled: false,
    status: 'disconnected',
    endpoint: 'http://127.0.0.1:7860',
    defaultPort: 7860,
    healthCheckPath: '/sdapi/v1/sd-models',
    modelsApiPath: '/sdapi/v1/sd-models',
    models: [],
    installUrl: 'https://github.com/AUTOMATIC1111/stable-diffusion-webui',
    docsUrl: 'https://github.com/AUTOMATIC1111/stable-diffusion-webui/wiki'
  },
  {
    id: 'sdnext',
    name: 'sdnext',
    displayName: 'SD.Next',
    description: 'Advanced fork of Automatic1111 with additional features and optimizations.',
    enabled: false,
    status: 'disconnected',
    endpoint: 'http://127.0.0.1:7861',
    defaultPort: 7861,
    healthCheckPath: '/sdapi/v1/sd-models',
    modelsApiPath: '/sdapi/v1/sd-models',
    models: [],
    installUrl: 'https://github.com/vladmandic/automatic',
    docsUrl: 'https://github.com/vladmandic/automatic/wiki'
  },
  {
    id: 'invokeai',
    name: 'invokeai',
    displayName: 'InvokeAI',
    description: 'Professional-grade creative AI platform with intuitive canvas interface.',
    enabled: false,
    status: 'disconnected',
    endpoint: 'http://127.0.0.1:9090',
    defaultPort: 9090,
    healthCheckPath: '/api/v1/app/version',
    modelsApiPath: '/api/v1/models',
    models: [],
    installUrl: 'https://invoke-ai.github.io/InvokeAI/',
    docsUrl: 'https://invoke-ai.github.io/InvokeAI/installation/'
  }
]

/**
 * Default cloud API provider configurations
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
 * Get default image providers configuration
 */
export function getDefaultImageProvidersConfig(): ImageProvidersConfig {
  return {
    local: [...DEFAULT_LOCAL_ENGINES],
    cloud: [...DEFAULT_CLOUD_PROVIDERS]
  }
}

/**
 * Get all enabled providers as unified list
 */
export function getEnabledImageProviders(config: ImageProvidersConfig): ImageProvider[] {
  const providers: ImageProvider[] = []
  
  for (const local of config.local) {
    if (local.enabled && local.status === 'connected') {
      providers.push({
        id: local.id,
        type: 'local',
        name: local.name,
        displayName: local.displayName,
        enabled: local.enabled,
        status: local.status,
        models: local.models
      })
    }
  }
  
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

