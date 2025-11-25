/**
 * OCR Types and Interfaces
 * Defines types for OCR operations with smart cloud/local routing
 */

/**
 * Supported OCR languages
 * Based on Tesseract language codes
 */
export type OCRLanguage = 
  | 'eng'  // English
  | 'deu'  // German
  | 'fra'  // French
  | 'spa'  // Spanish
  | 'ita'  // Italian
  | 'por'  // Portuguese
  | 'nld'  // Dutch
  | 'pol'  // Polish
  | 'rus'  // Russian
  | 'jpn'  // Japanese
  | 'chi_sim'  // Chinese Simplified
  | 'chi_tra'  // Chinese Traditional
  | 'kor'  // Korean
  | 'ara'  // Arabic

/**
 * OCR processing method
 */
export type OCRMethod = 'local_tesseract' | 'cloud_vision'

/**
 * Vision-capable cloud providers
 */
export type VisionProvider = 'OpenAI' | 'Claude' | 'Gemini' | 'Grok'

/**
 * OCR processing options
 */
export interface OCROptions {
  /** Primary language for OCR (default: 'eng') */
  language?: OCRLanguage
  
  /** Additional languages to recognize */
  additionalLanguages?: OCRLanguage[]
  
  /** Force local OCR even if cloud is available */
  forceLocal?: boolean
  
  /** Force cloud vision even if no API key (will fail if not configured) */
  forceCloud?: boolean
  
  /** Preferred cloud provider for vision */
  preferredProvider?: VisionProvider
  
  /** Image preprocessing options */
  preprocessing?: {
    /** Convert to grayscale before OCR */
    grayscale?: boolean
    /** Apply contrast enhancement */
    enhanceContrast?: boolean
    /** Deskew image */
    deskew?: boolean
  }
}

/**
 * OCR processing result
 */
export interface OCRResult {
  /** Extracted text content */
  text: string
  
  /** Confidence score (0-100) */
  confidence: number
  
  /** Language detected/used */
  language: OCRLanguage
  
  /** Processing method used */
  method: OCRMethod
  
  /** Provider used (if cloud) */
  provider?: VisionProvider
  
  /** Processing time in milliseconds */
  processingTimeMs: number
  
  /** Whether the result was cached */
  cached?: boolean
  
  /** Word-level details (if available) */
  words?: Array<{
    text: string
    confidence: number
    bbox?: { x: number; y: number; width: number; height: number }
  }>
  
  /** Any warnings during processing */
  warnings?: string[]
}

/**
 * OCR service status
 */
export interface OCRStatus {
  /** Whether local OCR (tesseract) is available */
  localAvailable: boolean
  
  /** Whether cloud vision is available (API key configured) */
  cloudAvailable: boolean
  
  /** Available cloud providers with vision support */
  availableProviders: VisionProvider[]
  
  /** Currently loaded Tesseract languages */
  loadedLanguages: OCRLanguage[]
  
  /** Tesseract worker status */
  workerStatus: 'idle' | 'busy' | 'initializing' | 'error'
  
  /** Last error if any */
  lastError?: string
}

/**
 * Cloud AI configuration for routing decisions
 */
export interface CloudAIConfig {
  /** API keys by provider */
  apiKeys: Partial<Record<VisionProvider, string>>
  
  /** User's AI preference */
  preference: 'cloud' | 'local' | 'auto'
  
  /** Whether to use cloud for image processing */
  useCloudForImages: boolean
}

/**
 * Input types that can be processed by OCR
 */
export type OCRInput = 
  | { type: 'buffer'; data: Buffer; mimeType?: string }
  | { type: 'base64'; data: string; mimeType?: string }
  | { type: 'path'; filePath: string }
  | { type: 'dataUrl'; dataUrl: string }

/**
 * OCR progress callback
 */
export interface OCRProgress {
  status: 'loading' | 'initializing' | 'recognizing' | 'complete' | 'error'
  progress: number // 0-100
  message?: string
}

export type OCRProgressCallback = (progress: OCRProgress) => void

