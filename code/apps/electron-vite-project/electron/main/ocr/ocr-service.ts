/**
 * OCR Service
 * Provides local OCR capabilities using tesseract.js
 *
 * Packaged-app path resolution
 * ─────────────────────────────
 * In a packaged Electron app the node_modules directory lives inside the ASAR
 * archive. Node's worker_threads module cannot spawn a worker from inside ASAR
 * so we must point Tesseract to pre-extracted copies under process.resourcesPath.
 *
 * electron-builder.config.cjs copies the following via extraResources:
 *   tesseract-worker/worker.min.js          ← tesseract.js/dist/worker.min.js
 *   tesseract-worker/tesseract-core-simd-lstm.wasm.js
 *                                           ← tesseract.js-core/tesseract-core-simd-lstm.wasm.js
 *   tesseract-lang/eng.traineddata          ← tesseract-lang/eng.traineddata (optional)
 *
 * If tesseract-lang/eng.traineddata is not bundled the worker falls back to the
 * projectnaptha CDN — this requires internet access. To make the app offline-capable
 * download the file (~12 MB for the LSTM best model) and place it at:
 *   apps/electron-vite-project/tesseract-lang/eng.traineddata
 * Source: https://github.com/tesseract-ocr/tessdata_best/raw/main/eng.traineddata
 */

import { Worker, createWorker } from 'tesseract.js'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import {
  OCRLanguage,
  OCROptions,
  OCRResult,
  OCRStatus,
  OCRInput,
  OCRProgressCallback
} from './types'

/**
 * OCR Service class
 * Manages Tesseract workers and provides OCR functionality
 */
export class OCRService {
  private worker: Worker | null = null
  private currentLanguage: OCRLanguage = 'eng'
  private isInitializing = false
  private initPromise: Promise<void> | null = null
  private lastError: string | null = null

  /**
   * Becomes true after a successful worker initialization.
   * processImage checks this flag before attempting recognition so that a
   * misconfigured worker fails fast with a clear error instead of hanging or
   * silently returning empty strings.
   */
  private ocrAvailable = false

  constructor() {
    // Worker will be initialized lazily on first use
  }

  /**
   * Initialize the Tesseract worker with specified language
   */
  async initialize(language: OCRLanguage = 'eng'): Promise<void> {
    if (this.worker && this.currentLanguage === language) {
      return // Already initialized with correct language
    }

    if (this.isInitializing) {
      await this.initPromise
      return
    }

    this.isInitializing = true
    this.initPromise = this.doInitialize(language)

    try {
      await this.initPromise
    } finally {
      this.isInitializing = false
      this.initPromise = null
    }
  }

  private async doInitialize(language: OCRLanguage): Promise<void> {
    try {
      // Terminate existing worker if any
      if (this.worker) {
        await this.worker.terminate()
        this.worker = null
        this.ocrAvailable = false
      }

      console.log(`[OCR] Initializing Tesseract worker with language: ${language}`)

      // ── Resolve paths for packaged vs. dev mode ───────────────────────────
      const workerOptions: Record<string, string> = {}

      if (app.isPackaged) {
        const resourcesPath = process.resourcesPath
        console.log(`[OCR] Packaged mode | resourcesPath: ${resourcesPath}`)

        // Do NOT set workerPath — worker.min.js is the browser build and crashes
        // in Node worker_threads with "addEventListener is not a function".
        // tesseract.js automatically uses its own Node-compatible worker script
        // from the asarUnpacked node_modules/tesseract.js package.

        const corePath = path.join(resourcesPath, 'tesseract-worker', 'tesseract-core-simd-lstm.wasm.js')
        if (fs.existsSync(corePath)) {
          workerOptions.corePath = corePath
          console.log(`[OCR] Using bundled WASM core`)
        } else {
          console.warn(`[OCR] WASM core NOT FOUND at ${corePath} — Tesseract will try default paths`)
        }

        const localLangDir = path.join(resourcesPath, 'tesseract-lang')
        const langCodes = language.split('+')
        const allBundled = langCodes.every(code =>
          fs.existsSync(path.join(localLangDir, `${code}.traineddata`))
        )

        if (allBundled) {
          workerOptions.langPath = `file:///${localLangDir.replace(/\\/g, '/')}`
          console.log(`[OCR] Using bundled language data for: ${language}`)
        } else {
          const missing = langCodes.filter(
            code => !fs.existsSync(path.join(localLangDir, `${code}.traineddata`))
          )
          console.log(`[OCR] Language data not bundled for [${missing.join(', ')}] — using CDN (internet required)`)
        }
      }
      // In dev mode: all three options are omitted → Tesseract uses its built-in
      // defaults (CDN for lang data, package-local worker and core paths).

      const INIT_TIMEOUT_MS = 30_000
      const workerPromise = createWorker(language, 1, {
        ...workerOptions,
        logger: (m) => {
          if (m.status === 'recognizing text') {
            console.log(`[OCR] Progress: ${Math.round(m.progress * 100)}%`)
          }
        },
        errorHandler: (err) => {
          console.error('[OCR] Worker error:', err instanceof Error ? err.message : JSON.stringify(err))
          this.lastError = (err as any).message || JSON.stringify(err) || String(err)
        },
      })
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Tesseract worker initialization timed out after ${INIT_TIMEOUT_MS}ms`)), INIT_TIMEOUT_MS)
      )

      this.worker = await Promise.race([workerPromise, timeoutPromise])

      this.currentLanguage = language
      this.lastError = null
      this.ocrAvailable = true
      console.log(`[OCR] Worker initialized successfully`)
    } catch (error: any) {
      this.ocrAvailable = false
      const msg = error?.message || JSON.stringify(error) || String(error)
      console.error('[OCR] Failed to initialize worker:', msg)
      console.error('[OCR] Worker initialization failed — OCR will not be available for scanned documents.')
      this.lastError = msg
      throw error
    }
  }

  /**
   * Process an image and extract text
   */
  async processImage(
    input: OCRInput,
    options: OCROptions = {},
    onProgress?: OCRProgressCallback
  ): Promise<OCRResult> {
    const startTime = Date.now()
    const language = options.language || 'eng'

    onProgress?.({ status: 'initializing', progress: 0, message: 'Initializing OCR engine...' })

    // Ensure worker is initialized with correct language
    await this.initialize(language)

    // Fast-fail if the worker did not initialise properly rather than
    // silently returning empty strings (which is the previous behaviour).
    if (!this.ocrAvailable || !this.worker) {
      throw new Error(
        `OCR engine is not available${this.lastError ? `: ${this.lastError}` : '. Check Tesseract worker configuration.'}`
      )
    }

    onProgress?.({ status: 'loading', progress: 10, message: 'Loading image...' })

    // Convert input to a format Tesseract can process
    const imageData = await this.prepareInput(input)

    onProgress?.({ status: 'recognizing', progress: 20, message: 'Recognizing text...' })

    try {
      // Perform OCR
      const result = await this.worker.recognize(imageData, {
        // rotateAuto: options.preprocessing?.deskew
      }, {
        text: true,
        blocks: true,
        // hocr: false,
        // tsv: false
      })

      onProgress?.({ status: 'complete', progress: 100, message: 'OCR complete' })

      const processingTimeMs = Date.now() - startTime

      // Extract word-level details if available
      const words = result.data.words?.map(word => ({
        text: word.text,
        confidence: word.confidence,
        bbox: word.bbox ? {
          x: word.bbox.x0,
          y: word.bbox.y0,
          width: word.bbox.x1 - word.bbox.x0,
          height: word.bbox.y1 - word.bbox.y0
        } : undefined
      }))

      return {
        text: result.data.text.trim(),
        confidence: result.data.confidence,
        language,
        method: 'local_tesseract',
        processingTimeMs,
        words,
        warnings: this.generateWarnings(result.data.confidence)
      }
    } catch (error: any) {
      onProgress?.({ status: 'error', progress: 0, message: error.message })
      throw error
    }
  }

  /**
   * Process a screenshot file
   */
  async processScreenshot(
    filePath: string,
    options: OCROptions = {},
    onProgress?: OCRProgressCallback
  ): Promise<OCRResult> {
    return this.processImage(
      { type: 'path', filePath },
      options,
      onProgress
    )
  }

  /**
   * Process a base64 encoded image
   */
  async processBase64(
    base64Data: string,
    options: OCROptions = {},
    onProgress?: OCRProgressCallback
  ): Promise<OCRResult> {
    // Remove data URL prefix if present
    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '')

    return this.processImage(
      { type: 'base64', data: cleanBase64 },
      options,
      onProgress
    )
  }

  /**
   * Get current service status
   */
  getStatus(): OCRStatus {
    return {
      localAvailable: this.ocrAvailable,
      cloudAvailable: false, // Will be determined by router
      availableProviders: [],
      loadedLanguages: this.worker ? [this.currentLanguage] : [],
      workerStatus: this.isInitializing
        ? 'initializing'
        : this.worker
          ? 'idle'
          : this.lastError
            ? 'error'
            : 'idle',
      lastError: this.lastError || undefined
    }
  }

  /**
   * Get list of supported languages
   */
  getSupportedLanguages(): Array<{ code: OCRLanguage; name: string }> {
    return [
      { code: 'eng', name: 'English' },
      { code: 'deu', name: 'German' },
      { code: 'fra', name: 'French' },
      { code: 'spa', name: 'Spanish' },
      { code: 'ita', name: 'Italian' },
      { code: 'por', name: 'Portuguese' },
      { code: 'nld', name: 'Dutch' },
      { code: 'pol', name: 'Polish' },
      { code: 'rus', name: 'Russian' },
      { code: 'jpn', name: 'Japanese' },
      { code: 'chi_sim', name: 'Chinese (Simplified)' },
      { code: 'chi_tra', name: 'Chinese (Traditional)' },
      { code: 'kor', name: 'Korean' },
      { code: 'ara', name: 'Arabic' }
    ]
  }

  /**
   * Terminate the worker and clean up resources
   */
  async terminate(): Promise<void> {
    if (this.worker) {
      console.log('[OCR] Terminating worker...')
      await this.worker.terminate()
      this.worker = null
      this.ocrAvailable = false
      console.log('[OCR] Worker terminated')
    }
  }

  /**
   * Prepare input for Tesseract processing
   */
  private async prepareInput(input: OCRInput): Promise<string | Buffer> {
    switch (input.type) {
      case 'path':
        // Tesseract can handle file paths directly
        if (!fs.existsSync(input.filePath)) {
          throw new Error(`File not found: ${input.filePath}`)
        }
        return input.filePath

      case 'buffer':
        return input.data

      case 'base64':
        return Buffer.from(input.data, 'base64')

      case 'dataUrl': {
        // Extract base64 from data URL
        const match = input.dataUrl.match(/^data:image\/\w+;base64,(.+)$/)
        if (!match) {
          throw new Error('Invalid data URL format')
        }
        return Buffer.from(match[1], 'base64')
      }

      default:
        throw new Error('Unsupported input type')
    }
  }

  /**
   * Generate warnings based on OCR confidence
   */
  private generateWarnings(confidence: number): string[] | undefined {
    const warnings: string[] = []

    if (confidence < 50) {
      warnings.push('Low confidence: Text may be inaccurate. Consider using a clearer image.')
    } else if (confidence < 70) {
      warnings.push('Moderate confidence: Some text may be inaccurate.')
    }

    return warnings.length > 0 ? warnings : undefined
  }
}

// Singleton instance
export const ocrService = new OCRService()
