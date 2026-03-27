/**
 * Vision Extraction Service
 *
 * Extracts text from image-based PDFs using Anthropic Vision API.
 * Renders each PDF page to PNG via pdfjs-dist canvas, then sends to Claude.
 *
 * Used as fallback when browser + Electron parsing return no text
 * (scanned documents, rasterized PDFs).
 *
 * @version 1.0.0
 */

const VISION_MODEL = 'claude-sonnet-4-20250514'
const VISION_MAX_TOKENS = 8192
const VISION_RENDER_SCALE = 2.0
const VISION_MAX_PAGES = 50
const MAX_CANVAS_DIMENSION = 4096

/** Decode standard base64 or base64url (PDF bytes from file readers / APIs may vary). */
function safeAtob(input: string): string {
  let b64 = input.replace(/-/g, '+').replace(/_/g, '/')
  b64 = b64.replace(/\s/g, '')
  const pad = b64.length % 4
  if (pad === 2) b64 += '=='
  else if (pad === 3) b64 += '='
  return atob(b64)
}

const EXTRACT_PROMPT = [
  'Extract ALL text from this document page image exactly as written.',
  'Preserve paragraphs, line breaks, and logical structure.',
  'Include text in ALL languages exactly as shown (do not translate).',
  'For tables, preserve structure using plain text alignment.',
  'For multi-column layouts, extract left column first, then right.',
  'Output ONLY the extracted text — no commentary, descriptions, or markdown formatting.',
].join(' ')

export interface VisionExtractionResult {
  success: boolean
  extractedText?: string
  error?: string
  errorCode?: string
}

export interface VisionExtractionOptions {
  onProgress?: (current: number, total: number) => void
}

let _pdfjsInit = false

function resolveExtensionPdfWorkerSrc(viteUrl: string): string {
  if (/^https?:\/\//i.test(viteUrl)) return viteUrl
  const trimmed = viteUrl.startsWith('/') ? viteUrl.slice(1) : viteUrl
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    try {
      return chrome.runtime.getURL(trimmed)
    } catch {
      /* fall through */
    }
  }
  return viteUrl
}

async function initPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (_pdfjsInit) {
    return (await import('pdfjs-dist')) as typeof import('pdfjs-dist')
  }
  const pdfjsLib = await import('pdfjs-dist')
  if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
    try {
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default
      pdfjsLib.GlobalWorkerOptions.workerSrc = resolveExtensionPdfWorkerSrc(workerUrl)
    } catch {
      // Worker init may fail; getDocument may still work
    }
  }
  _pdfjsInit = true
  return pdfjsLib
}

/**
 * Render a PDF page to base64 PNG using pdfjs canvas rendering.
 */
async function renderPageToPng(
  pdfjsLib: typeof import('pdfjs-dist'),
  pdf: Awaited<ReturnType<typeof import('pdfjs-dist').getDocument>>,
  pageNum: number
): Promise<string> {
  const page = await pdf.getPage(pageNum)
  const baseViewport = page.getViewport({ scale: 1.0 })
  const maxDim = Math.max(baseViewport.width, baseViewport.height)
  const scale = Math.min(VISION_RENDER_SCALE, MAX_CANVAS_DIMENSION / maxDim)
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2d context not available')

  await page.render({
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise

  return canvas.toDataURL('image/png').split(',')[1] ?? ''
}

/**
 * Call Anthropic Vision API for a single page image.
 */
async function extractPageWithVision(
  base64Png: string,
  apiKey: string
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      max_tokens: VISION_MAX_TOKENS,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: base64Png },
          },
          { type: 'text', text: EXTRACT_PROMPT },
        ],
      }],
    }),
  })

  if (!response.ok) {
    const status = response.status
    const body = await response.json().catch(() => ({}))
    const errMsg = (body as { error?: { message?: string } })?.error?.message ?? `HTTP ${status}`

    if (status === 401) {
      throw new Error('INVALID_API_KEY:Invalid API key. Please check your key and try again.')
    }
    if (status === 403) {
      throw new Error(`API_FORBIDDEN:${errMsg}`)
    }
    if (status === 429) {
      throw new Error('RATE_LIMITED:Anthropic API rate limit reached. Please wait a moment and try again.')
    }
    if (status === 529) {
      throw new Error('API_OVERLOADED:Anthropic API is temporarily overloaded. Please try again in a few minutes.')
    }
    throw new Error(`API_ERROR:${errMsg}`)
  }

  const result = await response.json()
  const pageText = (result.content as Array<{ type: string; text?: string }>)
    ?.filter((c) => c.type === 'text')
    ?.map((c) => c.text ?? '')
    ?.join('\n') ?? ''

  return pageText
}

/**
 * Extract text from a PDF using Anthropic Vision API.
 * Renders each page to PNG and sends to Claude for OCR.
 *
 * @param base64Data - Base64-encoded PDF
 * @param apiKey - Anthropic API key (sk-ant-...)
 * @param options - Optional progress callback
 */
export async function extractPdfTextWithVision(
  base64Data: string,
  apiKey: string,
  options?: VisionExtractionOptions
): Promise<VisionExtractionResult> {
  if (!apiKey?.trim() || !apiKey.startsWith('sk-ant-')) {
    return { success: false, error: 'Valid Anthropic API key required', errorCode: 'INVALID_API_KEY' }
  }

  const onProgress = options?.onProgress

  try {
    const pdfjsLib = await initPdfjs()
    const binary = safeAtob(base64Data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

    const loadingTask = pdfjsLib.getDocument({ data: bytes })
    const pdf = await loadingTask.promise
    const numPages = Math.min(pdf.numPages, VISION_MAX_PAGES)
    const pageTexts: string[] = []

    for (let i = 1; i <= numPages; i++) {
      try {
        const base64Png = await renderPageToPng(pdfjsLib, pdf, i)
        const pageText = await extractPageWithVision(base64Png, apiKey.trim())
        pageTexts.push(pageText)
      } catch (pageErr) {
        const msg = pageErr instanceof Error ? pageErr.message : String(pageErr)
        if (msg.startsWith('INVALID_API_KEY:') || msg.startsWith('RATE_LIMITED:') || msg.startsWith('API_OVERLOADED:')) {
          const [code, text] = msg.split(':', 2)
          return { success: false, error: text ?? msg, errorCode: code }
        }
        pageTexts.push(`[Page ${i}: extraction failed]`)
      }

      if (onProgress && (i % 2 === 0 || i === numPages)) {
        onProgress(i, numPages)
      }
    }

    const fullText = pageTexts.join('\n\n')
    const nonWhitespace = fullText.replace(/\s|\[Page \d+:[^\]]+\]/g, '').length

    if (nonWhitespace < 10) {
      return {
        success: false,
        error: 'AI Vision could not extract meaningful text from this document.',
        errorCode: 'NO_TEXT_EXTRACTED',
      }
    }

    return { success: true, extractedText: fullText }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('PasswordException') || msg.toLowerCase().includes('password')) {
      return {
        success: false,
        error: 'This PDF is password-protected. Please remove the password and re-upload.',
        errorCode: 'PASSWORD_PROTECTED',
      }
    }
    return {
      success: false,
      error: msg,
      errorCode: 'EXTRACTION_FAILED',
    }
  }
}
