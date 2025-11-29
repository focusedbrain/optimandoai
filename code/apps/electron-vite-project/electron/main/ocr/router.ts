/**
 * OCR Router
 * Smart routing between cloud vision APIs and local OCR based on configuration
 */

import { 
  OCROptions, 
  OCRResult, 
  OCRInput, 
  VisionProvider, 
  CloudAIConfig,
  OCRProgressCallback
} from './types'
import { ocrService } from './ocr-service'

/**
 * Vision-capable providers and their capabilities
 */
const VISION_PROVIDERS: Record<VisionProvider, { supportsVision: boolean; endpoint?: string }> = {
  'OpenAI': { supportsVision: true },
  'Claude': { supportsVision: true },
  'Gemini': { supportsVision: true },
  'Grok': { supportsVision: true }
}

/**
 * OCR Router class
 * Routes OCR requests to either cloud vision or local tesseract
 */
export class OCRRouter {
  private cloudConfig: CloudAIConfig | null = null

  /**
   * Update cloud AI configuration
   */
  setCloudConfig(config: CloudAIConfig): void {
    this.cloudConfig = config
    console.log('[OCR Router] Cloud config updated:', {
      hasApiKeys: Object.keys(config.apiKeys).filter(k => config.apiKeys[k as VisionProvider]).length,
      preference: config.preference,
      useCloudForImages: config.useCloudForImages
    })
  }

  /**
   * Check if cloud vision is available and should be used
   */
  shouldUseCloud(options?: OCROptions): { useCloud: boolean; provider?: VisionProvider; reason: string } {
    // Force local if explicitly requested
    if (options?.forceLocal) {
      return { useCloud: false, reason: 'Force local requested' }
    }

    // Force cloud if explicitly requested
    if (options?.forceCloud) {
      const provider = this.getAvailableVisionProvider(options.preferredProvider)
      if (provider) {
        return { useCloud: true, provider, reason: 'Force cloud requested' }
      }
      return { useCloud: false, reason: 'Force cloud requested but no provider available' }
    }

    // No cloud config set
    if (!this.cloudConfig) {
      return { useCloud: false, reason: 'No cloud configuration' }
    }

    // User explicitly prefers local
    if (this.cloudConfig.preference === 'local') {
      return { useCloud: false, reason: 'User prefers local AI' }
    }

    // Cloud not enabled for images
    if (!this.cloudConfig.useCloudForImages) {
      return { useCloud: false, reason: 'Cloud not enabled for image processing' }
    }

    // Check for available vision provider
    const provider = this.getAvailableVisionProvider(options?.preferredProvider)
    if (!provider) {
      return { useCloud: false, reason: 'No vision-capable provider with API key' }
    }

    // Cloud is available and preferred
    return { 
      useCloud: true, 
      provider, 
      reason: this.cloudConfig.preference === 'cloud' 
        ? 'User prefers cloud AI' 
        : 'Auto-selected cloud (API key available)'
    }
  }

  /**
   * Get an available vision provider
   */
  private getAvailableVisionProvider(preferred?: VisionProvider): VisionProvider | undefined {
    if (!this.cloudConfig) return undefined

    // Check preferred provider first
    if (preferred && this.isProviderAvailable(preferred)) {
      return preferred
    }

    // Check other providers in order of preference
    const providerOrder: VisionProvider[] = ['OpenAI', 'Claude', 'Gemini', 'Grok']
    for (const provider of providerOrder) {
      if (this.isProviderAvailable(provider)) {
        return provider
      }
    }

    return undefined
  }

  /**
   * Check if a provider is available (has API key and supports vision)
   */
  private isProviderAvailable(provider: VisionProvider): boolean {
    if (!this.cloudConfig) return false
    
    const apiKey = this.cloudConfig.apiKeys[provider]
    const config = VISION_PROVIDERS[provider]
    
    return !!(apiKey && apiKey.trim() && config?.supportsVision)
  }

  /**
   * Process an image - routes to cloud or local based on config
   */
  async processImage(
    input: OCRInput,
    options: OCROptions = {},
    onProgress?: OCRProgressCallback
  ): Promise<OCRResult> {
    const routing = this.shouldUseCloud(options)
    
    console.log('[OCR Router] Routing decision:', routing)

    if (routing.useCloud && routing.provider) {
      // Use cloud vision API
      return this.processWithCloud(input, routing.provider, options, onProgress)
    } else {
      // Use local tesseract
      return ocrService.processImage(input, options, onProgress)
    }
  }

  /**
   * Process image with cloud vision API
   * Note: This is a placeholder - actual implementation depends on the provider's API
   */
  private async processWithCloud(
    input: OCRInput,
    provider: VisionProvider,
    options: OCROptions,
    onProgress?: OCRProgressCallback
  ): Promise<OCRResult> {
    const startTime = Date.now()
    
    onProgress?.({ status: 'initializing', progress: 0, message: `Connecting to ${provider}...` })

    try {
      // Get the image as base64
      const base64Image = await this.inputToBase64(input)
      
      onProgress?.({ status: 'recognizing', progress: 30, message: `Processing with ${provider} Vision...` })

      // Route to appropriate provider
      let result: { text: string; confidence?: number }
      
      switch (provider) {
        case 'OpenAI':
          result = await this.processWithOpenAI(base64Image)
          break
        case 'Claude':
          result = await this.processWithClaude(base64Image)
          break
        case 'Gemini':
          result = await this.processWithGemini(base64Image)
          break
        case 'Grok':
          result = await this.processWithGrok(base64Image)
          break
        default:
          throw new Error(`Unsupported provider: ${provider}`)
      }

      onProgress?.({ status: 'complete', progress: 100, message: 'Processing complete' })

      return {
        text: result.text,
        confidence: result.confidence || 95, // Cloud usually has high confidence
        language: options.language || 'eng',
        method: 'cloud_vision',
        provider,
        processingTimeMs: Date.now() - startTime
      }
    } catch (error: any) {
      console.error(`[OCR Router] Cloud processing failed with ${provider}:`, error)
      
      // Fallback to local OCR
      console.log('[OCR Router] Falling back to local OCR...')
      onProgress?.({ status: 'initializing', progress: 0, message: 'Cloud failed, using local OCR...' })
      
      const localResult = await ocrService.processImage(input, options, onProgress)
      localResult.warnings = localResult.warnings || []
      localResult.warnings.push(`Cloud ${provider} failed: ${error.message}. Used local OCR instead.`)
      
      return localResult
    }
  }

  /**
   * Convert input to base64 string
   */
  private async inputToBase64(input: OCRInput): Promise<string> {
    const fs = await import('fs')
    
    switch (input.type) {
      case 'base64':
        return input.data
        
      case 'dataUrl':
        const match = input.dataUrl.match(/^data:image\/\w+;base64,(.+)$/)
        if (!match) throw new Error('Invalid data URL')
        return match[1]
        
      case 'buffer':
        return input.data.toString('base64')
        
      case 'path':
        const buffer = fs.readFileSync(input.filePath)
        return buffer.toString('base64')
        
      default:
        throw new Error('Unsupported input type')
    }
  }

  /**
   * Process with OpenAI Vision API
   */
  private async processWithOpenAI(base64Image: string): Promise<{ text: string; confidence?: number }> {
    const apiKey = this.cloudConfig?.apiKeys['OpenAI']
    if (!apiKey) throw new Error('OpenAI API key not configured')

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Extract all text from this image. Return only the extracted text, nothing else. Preserve the original formatting and layout as much as possible.'
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${base64Image}`
                }
              }
            ]
          }
        ],
        max_tokens: 4096
      })
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI API error: ${error}`)
    }

    const data = await response.json()
    return { text: data.choices[0]?.message?.content || '' }
  }

  /**
   * Process with Claude Vision API
   */
  private async processWithClaude(base64Image: string): Promise<{ text: string; confidence?: number }> {
    const apiKey = this.cloudConfig?.apiKeys['Claude']
    if (!apiKey) throw new Error('Claude API key not configured')

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: base64Image
                }
              },
              {
                type: 'text',
                text: 'Extract all text from this image. Return only the extracted text, nothing else. Preserve the original formatting and layout as much as possible.'
              }
            ]
          }
        ]
      })
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Claude API error: ${error}`)
    }

    const data = await response.json()
    return { text: data.content[0]?.text || '' }
  }

  /**
   * Process with Gemini Vision API
   */
  private async processWithGemini(base64Image: string): Promise<{ text: string; confidence?: number }> {
    const apiKey = this.cloudConfig?.apiKeys['Gemini']
    if (!apiKey) throw new Error('Gemini API key not configured')

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: 'Extract all text from this image. Return only the extracted text, nothing else. Preserve the original formatting and layout as much as possible.'
              },
              {
                inline_data: {
                  mime_type: 'image/png',
                  data: base64Image
                }
              }
            ]
          }
        ]
      })
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Gemini API error: ${error}`)
    }

    const data = await response.json()
    return { text: data.candidates?.[0]?.content?.parts?.[0]?.text || '' }
  }

  /**
   * Process with Grok Vision API
   */
  private async processWithGrok(base64Image: string): Promise<{ text: string; confidence?: number }> {
    const apiKey = this.cloudConfig?.apiKeys['Grok']
    if (!apiKey) throw new Error('Grok API key not configured')

    // Grok uses OpenAI-compatible API
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'grok-vision-beta',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Extract all text from this image. Return only the extracted text, nothing else. Preserve the original formatting and layout as much as possible.'
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${base64Image}`
                }
              }
            ]
          }
        ],
        max_tokens: 4096
      })
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Grok API error: ${error}`)
    }

    const data = await response.json()
    return { text: data.choices[0]?.message?.content || '' }
  }

  /**
   * Get available vision providers
   */
  getAvailableProviders(): VisionProvider[] {
    if (!this.cloudConfig) return []
    
    return (Object.keys(VISION_PROVIDERS) as VisionProvider[])
      .filter(provider => this.isProviderAvailable(provider))
  }
}

// Singleton instance
export const ocrRouter = new OCRRouter()






