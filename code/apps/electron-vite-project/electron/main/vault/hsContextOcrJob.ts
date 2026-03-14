/**
 * HS Context OCR Job
 *
 * Async text extraction for profile documents (PDFs).
 *
 * Strategy (in order of preference):
 *  1. Direct text extraction via pdfjs-dist getTextContent() — works for
 *     PDFs that have a selectable text layer.
 *  2. Page-by-page image rendering via pdfjs-dist → fed to ocrService
 *     (Tesseract.js) — handles scanned/image-only PDFs.
 *  3. Sparse direct text — last-resort fallback when OCR produces nothing.
 *  4. Fail with NO_TEXT_EXTRACTED — surfaces the BYOK Vision card in the UI.
 *
 * Vision API retry path (user-initiated, BYOK):
 *  When all automatic tiers fail, the user can supply an Anthropic API key.
 *  `runExtractionJobWithVision` re-runs extraction using Claude Vision to read
 *  each page image — handles any raster PDF regardless of language or encoding.
 *
 * Updates extraction_status in hs_context_profile_documents on completion.
 */

import { createRequire } from 'module'
import { ocrService } from '../ocr/ocr-service'

const require = createRequire(import.meta.url)

// Minimum average non-whitespace characters per page for the direct path to
// be considered "dense enough" to skip OCR.
const MIN_TEXT_CHARS_PER_PAGE = 30

// Extracted text validation limits
const EXTRACTED_TEXT_MAX_LENGTH = 2_000_000 // ~2MB of plain text
const CONTROL_CHAR_REGEX = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

// Only reject text that looks like a full HTML document (doctype / html+head+body
// structure), NOT arbitrary angle-bracket content. Technical documents, legal
// schedules ("<Annex A>"), templates ("<placeholder>"), and XML annotations
// surfaced by pdfjs all contain angle brackets but are perfectly valid plain text.
const FULL_HTML_DOC_REGEX = /<!DOCTYPE\s+html|<html[\s>]|<head[\s>][\s\S]{0,500}<body[\s>]/i

// Vision API config — use Sonnet for high-quality multilingual extraction
const VISION_MODEL = 'claude-sonnet-4-20250514'
const VISION_MAX_TOKENS = 8192
// Render at 2× for good OCR quality, but cap to avoid OOM
const VISION_RENDER_SCALE = 2.0
const VISION_MAX_PAGES = 100

// ── Types ────────────────────────────────────────────────────────────────────

export interface OcrJobResult {
  success: boolean
  extracted_text?: string
  /** Per-page text for document reader (1-indexed pages). */
  pageTexts?: string[]
  extractor_name?: string
  error_message?: string
  /** Structured error code for the UI to decide which failure card to render. */
  error_code?: string
}

export interface ExtractionOptions {
  /** Use Anthropic Vision API as the extraction engine (user-initiated retry). */
  useVisionApi?: boolean
  /** Anthropic API key for Vision API usage. */
  anthropicApiKey?: string
  /** Progress callback for Vision page-by-page updates. */
  onVisionPageProgress?: (current: number, total: number) => void
}

// ── PDF.js loader ──

async function loadPdfjs(): Promise<any> {
  try {
    // pdfjs-dist legacy build runs in Node without a canvas dependency for
    // text extraction. For OCR rendering we use the canvas package if available.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs' as any).catch(
      () => import('pdfjs-dist' as any)
    )
    // pdfjs-dist v4+ requires a real workerSrc — an empty string throws
    // "Setting up fake worker failed: 'No GlobalWorkerOptions.workerSrc specified'".
    if (pdfjs.GlobalWorkerOptions) {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.mjs', import.meta.url).toString()
    }
    return pdfjs
  } catch (err: any) {
    throw new Error(`Failed to load pdfjs-dist: ${err?.message}`)
  }
}

// ── PDF metadata ─────────────────────────────────────────────────────────────

interface PdfMetadata {
  producer?: string
  creator?: string
  title?: string
  pageCount?: number
}

async function extractPdfMetadata(pdfjs: any, data: Buffer): Promise<PdfMetadata> {
  try {
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise
    const meta = await pdf.getMetadata().catch(() => null)
    const info = meta?.info ?? {}
    return {
      producer: info.Producer,
      creator: info.Creator,
      title: info.Title,
      pageCount: pdf.numPages,
    }
  } catch {
    return {}
  }
}

/**
 * Build a contextual, actionable error message based on PDF metadata.
 * Detects "Print to PDF" origin (very common for webmail-forwarded documents)
 * and explains exactly what went wrong and how the user can fix it.
 */
function buildExtractionFailureMessage(metadata: PdfMetadata | null, pageCount: number): string {
  const producer = (metadata?.producer ?? '').toLowerCase()
  const title = (metadata?.title ?? '').toLowerCase()

  const isPrintToPdf =
    producer.includes('print to pdf') ||
    producer.includes('microsoft: print') ||
    producer.includes('cups') ||
    /chrome|chromium|firefox|safari|edge/.test(producer)

  const isFromWebmail =
    title.includes('mail') ||
    title.includes('gmail') ||
    title.includes('outlook') ||
    title.includes('web.de') ||
    title.includes('gmx') ||
    title.includes('yahoo') ||
    title.includes('freenet')

  if (isPrintToPdf && isFromWebmail) {
    return (
      'This PDF was printed from a webmail client, which converts text into flat images. ' +
      `No text layer was found across ${pageCount} page${pageCount !== 1 ? 's' : ''}. ` +
      'Try downloading the original PDF attachment directly from the sender instead of printing it from your browser. ' +
      'Or use AI Vision to extract the text (requires an Anthropic API key).'
    )
  }

  if (isPrintToPdf) {
    return (
      'This PDF was created with "Print to PDF", which often removes the text layer. ' +
      `No readable text was found across ${pageCount} page${pageCount !== 1 ? 's' : ''}. ` +
      'Try using the original digital version of this document. ' +
      'Or use AI Vision to extract the text (requires an Anthropic API key).'
    )
  }

  return (
    'This PDF appears to contain only images without readable text. ' +
    `No text layer or OCR-readable text was found across ${pageCount} page${pageCount !== 1 ? 's' : ''}. ` +
    'This can happen with scanned documents or PDFs created via "Print to PDF". ' +
    'You can use AI Vision to extract the text (requires an Anthropic API key).'
  )
}

// ── Direct text extraction ──

/**
 * Reconstruct readable text from a single PDF page's text items.
 *
 * PDF.js returns text as an array of positioned items. Some PDFs store each
 * character as a separate item — naively joining with ' ' produces
 * "B u n d e s a g e n t u r" instead of "Bundesagentur".
 */
function reconstructPageText(items: any[]): string {
  if (items.length === 0) return ''

  let result = ''
  let prevEndX = 0
  let prevY: number | null = null

  for (const item of items) {
    const str: string = item.str ?? ''
    // transform matrix: [scaleX, skewX, skewY, scaleY, translateX, translateY]
    const transform: number[] = item.transform ?? [10, 0, 0, 10, 0, 0]
    const x: number = transform[4]
    const y: number = transform[5]
    const fontSize: number = Math.abs(transform[3]) || Math.abs(transform[0]) || 10
    const itemWidth: number = item.width ?? 0

    if (prevY !== null) {
      const dy = Math.abs(y - prevY)
      const gap = x - prevEndX

      if (item.hasEOL || dy > fontSize * 0.5) {
        result += '\n'
      } else if (gap > fontSize * 0.25) {
        result += ' '
      }
    }

    result += str
    prevEndX = x + itemWidth
    prevY = y
  }

  return result
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ {2,}/g, ' ')
    .trim()
}

/**
 * FIX 3 — Detect password-protected PDFs.
 *
 * pdfjs throws a PasswordException for encrypted/password-protected PDFs.
 * We catch it and throw a tagged error so the orchestrator can surface a
 * clear, actionable message without trying OCR (which would also fail).
 */
async function extractTextDirect(pdfjs: any, data: Buffer): Promise<{ text: string; pageCount: number; pageTexts: string[] }> {
  let pdf: any
  try {
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data) })
    pdf = await loadingTask.promise
  } catch (err: any) {
    if (err?.name === 'PasswordException' || err?.message?.toLowerCase().includes('password')) {
      const pwError = new Error(
        'This PDF is password-protected. Please remove the password and re-upload the document.'
      )
      ;(pwError as any).isPasswordProtected = true
      throw pwError
    }
    throw err
  }

  const pageCount: number = pdf.numPages
  const pageTexts: string[] = []

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = reconstructPageText(content.items)
    pageTexts.push(pageText)
  }

  return { text: pageTexts.join('\n\n'), pageCount, pageTexts }
}

// ── OCR fallback via Tesseract ──

// Max canvas dimension (px) to avoid OOM on very large pages (A0, posters, etc.)
const MAX_CANVAS_DIMENSION = 3508 // ≈ A3 at 300 dpi; still excellent OCR quality

/**
 * pdfjs-dist v4 requires a NodeCanvasFactory object for Node.js rendering.
 */
function makeNodeCanvasFactory(createCanvas: (w: number, h: number) => any) {
  return {
    create(width: number, height: number) {
      const canvas = createCanvas(Math.ceil(width), Math.ceil(height))
      return { canvas, context: canvas.getContext('2d') }
    },
    reset(canvasAndContext: any, width: number, height: number) {
      canvasAndContext.canvas.width = Math.ceil(width)
      canvasAndContext.canvas.height = Math.ceil(height)
    },
    destroy(canvasAndContext: any) {
      canvasAndContext.canvas.width = 0
      canvasAndContext.canvas.height = 0
      canvasAndContext.context = null
    },
  }
}

async function extractTextOcr(
  pdfjs: any,
  data: Buffer,
  onPageProgress?: (current: number, total: number) => void,
): Promise<{ text: string; pageCount: number; pageTexts: string[] }> {
  let createCanvas: ((w: number, h: number) => any) | null = null
  try {
    createCanvas = require('canvas').createCanvas
  } catch {
    throw new Error('canvas package not available for OCR rendering; install `canvas` or use a text-layer PDF')
  }

  const canvasFactory = makeNodeCanvasFactory(createCanvas!)

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data), canvasFactory })
  const pdf = await loadingTask.promise
  const pageCount: number = pdf.numPages
  const pageTexts: string[] = []

  for (let i = 1; i <= pageCount; i++) {
    try {
      const page = await pdf.getPage(i)

      const baseViewport = page.getViewport({ scale: 1.0 })
      const maxDim = Math.max(baseViewport.width, baseViewport.height)
      const scale = Math.min(2.0, MAX_CANVAS_DIMENSION / maxDim)
      const viewport = page.getViewport({ scale })

      const canvasAndContext = canvasFactory.create(viewport.width, viewport.height)

      await page.render({
        canvasContext: canvasAndContext.context,
        viewport,
        canvasFactory,
      }).promise

      const pngBuffer: Buffer = canvasAndContext.canvas.toBuffer('image/png')
      canvasFactory.destroy(canvasAndContext)

      try {
        const ocrResult = await ocrService.processImage(
          { type: 'buffer', data: pngBuffer },
          { language: 'spa+eng+deu' },
        )
        pageTexts.push(ocrResult.text.trim())
      } catch (ocrErr: any) {
        console.warn(`[HS OCR] Tesseract failed on page ${i}: ${ocrErr?.message}`)
        pageTexts.push('')
      }
    } catch (pageErr: any) {
      console.warn(`[HS OCR] Skipping page ${i} (render error): ${pageErr?.message}`)
      pageTexts.push('')
    }

    if (onPageProgress && (i % 5 === 0 || i === pageCount)) {
      onPageProgress(i, pageCount)
    }
  }

  return { text: pageTexts.filter(Boolean).join('\n\n'), pageCount, pageTexts }
}

// ── Anthropic Vision API extraction ─────────────────────────────────────────

/**
 * Render each PDF page to a PNG and send to Anthropic's Vision API for text
 * extraction. Handles any raster PDF regardless of language or encoding.
 *
 * Only called when the user explicitly opts in via the BYOK failure card.
 */
async function extractTextVision(
  pdfjs: any,
  data: Buffer,
  anthropicApiKey: string,
  onPageProgress?: (current: number, total: number) => void,
): Promise<OcrJobResult> {
  let createCanvas: ((w: number, h: number) => any) | null = null
  try {
    createCanvas = require('canvas').createCanvas
  } catch {
    return { success: false, error_message: 'canvas package not available for Vision rendering', error_code: 'INTERNAL_ERROR' }
  }

  const canvasFactory = makeNodeCanvasFactory(createCanvas!)

  let pdf: any
  try {
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data), canvasFactory })
    pdf = await loadingTask.promise
  } catch (err: any) {
    if (err?.name === 'PasswordException' || err?.message?.toLowerCase().includes('password')) {
      return {
        success: false,
        error_message: 'This PDF is password-protected. Please remove the password and re-upload.',
        error_code: 'PASSWORD_PROTECTED',
      }
    }
    return { success: false, error_message: `PDF load failed: ${err?.message}`, error_code: 'PDF_LOAD_ERROR' }
  }

  const numPages = Math.min(pdf.numPages, VISION_MAX_PAGES)
  const pageTexts: string[] = []

  for (let i = 1; i <= numPages; i++) {
    // Render page to PNG
    let base64Png: string
    try {
      const page = await pdf.getPage(i)
      const baseViewport = page.getViewport({ scale: 1.0 })
      const maxDim = Math.max(baseViewport.width, baseViewport.height)
      const scale = Math.min(VISION_RENDER_SCALE, MAX_CANVAS_DIMENSION / maxDim)
      const viewport = page.getViewport({ scale })

      const canvasAndContext = canvasFactory.create(viewport.width, viewport.height)
      await page.render({ canvasContext: canvasAndContext.context, viewport, canvasFactory }).promise
      base64Png = canvasAndContext.canvas.toBuffer('image/png').toString('base64')
      canvasFactory.destroy(canvasAndContext)
    } catch (renderErr: any) {
      console.warn(`[HS OCR Vision] Page ${i} render failed: ${renderErr?.message}`)
      pageTexts.push(`[Page ${i}: render failed]`)
      continue
    }

    // Call Anthropic Vision API
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicApiKey,
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
              {
                type: 'text',
                text: [
                  'Extract ALL text from this document page image exactly as written.',
                  'Preserve paragraphs, line breaks, and logical structure.',
                  'Include text in ALL languages exactly as shown (do not translate).',
                  'For tables, preserve structure using plain text alignment.',
                  'For multi-column layouts, extract left column first, then right.',
                  'Output ONLY the extracted text — no commentary, descriptions, or markdown formatting.',
                ].join(' '),
              },
            ],
          }],
        }),
      })

      if (!response.ok) {
        const status = response.status
        const body = await response.json().catch(() => ({}))
        const errMsg = (body as any)?.error?.message ?? `HTTP ${status}`

        // Surface actionable errors immediately — stop burning pages/credits
        if (status === 401) {
          return { success: false, error_message: 'Invalid API key. Please check your key and try again.', error_code: 'INVALID_API_KEY' }
        }
        if (status === 403) {
          return { success: false, error_message: `API key does not have access to this model: ${errMsg}`, error_code: 'API_FORBIDDEN' }
        }
        if (status === 429) {
          return { success: false, error_message: 'Anthropic API rate limit reached. Please wait a moment and try again.', error_code: 'RATE_LIMITED' }
        }
        if (status === 529) {
          return { success: false, error_message: 'Anthropic API is temporarily overloaded. Please try again in a few minutes.', error_code: 'API_OVERLOADED' }
        }

        console.warn(`[HS OCR Vision] Page ${i} API error (${status}): ${errMsg}`)
        pageTexts.push(`[Page ${i}: extraction failed]`)
        continue
      }

      const result = await response.json()
      const pageText = (result.content as any[])
        ?.filter((c: any) => c.type === 'text')
        ?.map((c: any) => c.text)
        ?.join('\n') ?? ''

      pageTexts.push(pageText)
      console.log(`[HS OCR Vision] Page ${i}/${numPages}: ${pageText.replace(/\s/g, '').length} chars`)
    } catch (fetchErr: any) {
      console.warn(`[HS OCR Vision] Page ${i} fetch failed: ${fetchErr?.message}`)
      pageTexts.push(`[Page ${i}: network error]`)
    }

    if (onPageProgress && (i % 2 === 0 || i === numPages)) {
      onPageProgress(i, numPages)
    }
  }

  const fullText = pageTexts.join('\n\n')
  const nonWhitespace = fullText.replace(/\s|\[Page \d+:[^\]]+\]/g, '').length

  if (nonWhitespace < 10) {
    return {
      success: false,
      error_message: 'AI Vision could not extract meaningful text from this document.',
      error_code: 'NO_TEXT_EXTRACTED',
    }
  }

  return {
    success: true,
    extracted_text: fullText,
    pageTexts,
    extractor_name: 'anthropic-vision',
  }
}

// ── Main extraction entrypoint ───────────────────────────────────────────────

/**
 * Extract text from a PDF buffer.
 *
 * Automatic tiers (no API key required):
 *  1. Direct pdfjs text extraction — preferred when text layer is dense.
 *  2. Tesseract OCR (spa+eng+deu) — for scanned/image pages.
 *  3. Sparse direct text — any direct text at all, even below density threshold.
 *
 * On failure: returns error_code='NO_TEXT_EXTRACTED' with a contextual message
 * that the UI turns into the BYOK Vision failure card.
 *
 * Vision API tier is NOT included here — it runs only through
 * `runExtractionJobWithVision` (user-initiated retry with an API key).
 */
export async function extractTextFromPdf(
  pdfBuffer: Buffer,
  onOcrPageProgress?: (current: number, total: number) => void,
): Promise<OcrJobResult> {
  try {
    const pdfjs = await loadPdfjs()

    // ── Attempt 1: Direct text extraction ──
    let directResult: { text: string; pageCount: number; pageTexts: string[] } | null = null
    try {
      directResult = await extractTextDirect(pdfjs, pdfBuffer)
    } catch (err: any) {
      if ((err as any).isPasswordProtected) {
        return { success: false, error_message: err.message, error_code: 'PASSWORD_PROTECTED' }
      }
      console.warn('[HS OCR] Direct text extraction failed:', err?.message)
    }

    if (directResult) {
      const charCount = directResult.text.replace(/\s/g, '').length
      const avgCharsPerPage = charCount / Math.max(1, directResult.pageCount)

      if (avgCharsPerPage >= MIN_TEXT_CHARS_PER_PAGE) {
        return {
          success: true,
          extracted_text: directResult.text.trim(),
          pageTexts: directResult.pageTexts,
          extractor_name: 'pdfjs-direct',
        }
      }
      console.log(`[HS OCR] Text layer sparse (${avgCharsPerPage.toFixed(0)} chars/page), trying OCR`)
    }

    // ── Attempt 2: Tesseract OCR ──
    let ocrText = ''
    let ocrResult: { text: string; pageCount: number; pageTexts: string[] } | null = null
    try {
      ocrResult = await extractTextOcr(pdfjs, pdfBuffer, onOcrPageProgress)
      ocrText = ocrResult.text.trim()
    } catch (ocrErr: any) {
      console.warn('[HS OCR] OCR path failed entirely:', ocrErr?.message)
    }

    if (ocrText && ocrResult) {
      return {
        success: true,
        extracted_text: ocrText,
        pageTexts: ocrResult.pageTexts,
        extractor_name: 'pdfjs+tesseract',
      }
    }

    // ── Attempt 3: Sparse direct text ──
    const sparseText = directResult?.text?.trim() ?? ''
    if (sparseText && directResult) {
      console.warn('[HS OCR] OCR produced no text — using sparse direct extraction as fallback')
      return {
        success: true,
        extracted_text: sparseText,
        pageTexts: directResult.pageTexts,
        extractor_name: 'pdfjs-direct-sparse',
      }
    }

    // ── All automatic tiers failed — surface the BYOK Vision failure card ──
    // Do NOT store a success placeholder here. The document is marked 'failed'
    // with a contextual error_code so the UI can show the Vision retry option.
    const pageCount = directResult?.pageCount ?? 1
    const metadata = await extractPdfMetadata(pdfjs, pdfBuffer).catch(() => null)
    const errorMsg = buildExtractionFailureMessage(metadata, pageCount)
    console.warn(`[HS OCR] All extraction tiers failed for ${pageCount}-page document — ${metadata?.producer ?? 'unknown producer'}`)

    return {
      success: false,
      error_message: errorMsg,
      error_code: 'NO_TEXT_EXTRACTED',
    }
  } catch (err: any) {
    return {
      success: false,
      error_message: err?.message ?? 'Unknown extraction error',
    }
  }
}

// ── Extracted text validation ─────────────────────────────────────────────────

export function validateExtractedText(text: string | null | undefined): { ok: true; sanitized: string } | { ok: false; reason: string } {
  if (text == null || typeof text !== 'string') {
    return { ok: false, reason: 'Extracted text is missing or not a string' }
  }
  if (text.length > EXTRACTED_TEXT_MAX_LENGTH) {
    return { ok: false, reason: `Extracted text exceeds maximum length (${EXTRACTED_TEXT_MAX_LENGTH} chars)` }
  }
  const withoutControl = text.replace(CONTROL_CHAR_REGEX, '')
  if (FULL_HTML_DOC_REGEX.test(withoutControl)) {
    return { ok: false, reason: 'Extracted content appears to be an HTML document rather than a PDF text layer' }
  }
  const normalized = withoutControl
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!normalized) {
    return { ok: false, reason: 'Extracted text is empty after sanitization' }
  }
  return { ok: true, sanitized: normalized }
}

// ── DB update helpers ─────────────────────────────────────────────────────────

export function markDocumentExtractionPending(db: any, documentId: string): void {
  db.prepare(`
    UPDATE hs_context_profile_documents
    SET extraction_status = 'pending', error_message = NULL, error_code = NULL
    WHERE id = ?
  `).run(documentId)
}

/**
 * Insert per-page text into hs_context_profile_document_pages.
 * Clears existing pages for the document first (idempotent for re-extraction).
 */
function insertDocumentPages(db: any, documentId: string, pageTexts: string[]): void {
  db.prepare('DELETE FROM hs_context_profile_document_pages WHERE document_id = ?').run(documentId)
  const now = Date.now()
  const insert = db.prepare(`
    INSERT INTO hs_context_profile_document_pages (id, document_id, page_number, text, char_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  for (let i = 0; i < pageTexts.length; i++) {
    const text = pageTexts[i] ?? ''
    const pageNum = i + 1
    const id = `hspg_${documentId}_${pageNum}`
    insert.run(id, documentId, pageNum, text, text.length, now)
  }
}

export function markDocumentExtractionSuccess(
  db: any,
  documentId: string,
  extractedText: string,
  extractorName: string,
  pageTexts?: string[],
): void {
  const pageCount = pageTexts?.length ?? 0
  if (pageTexts && pageTexts.length > 0) {
    insertDocumentPages(db, documentId, pageTexts)
  }
  db.prepare(`
    UPDATE hs_context_profile_documents
    SET extraction_status = 'success',
        extracted_text = ?,
        extracted_at = ?,
        extractor_name = ?,
        page_count = ?,
        error_message = NULL,
        error_code = NULL
    WHERE id = ?
  `).run(extractedText, Date.now(), extractorName, pageCount, documentId)
}

/**
 * Mark a document extraction as failed.
 * Optionally stores a structured error_code for the UI to decide which
 * failure card to render (BYOK Vision card, password card, timeout card, etc.)
 */
export function markDocumentExtractionFailed(
  db: any,
  documentId: string,
  errorMessage: string,
  errorCode?: string,
): void {
  db.prepare(`
    UPDATE hs_context_profile_documents
    SET extraction_status = 'failed',
        extracted_text = NULL,
        error_message = ?,
        error_code = ?
    WHERE id = ?
  `).run(errorMessage, errorCode ?? null, documentId)
}

/**
 * Write OCR progress into error_message while the document is still pending.
 * The UI polls this field and displays it so the user can see
 * "Extracting page 12 of 47 (OCR)…" instead of a static spinner.
 */
export function updateExtractionProgress(db: any, documentId: string, message: string): void {
  try {
    db.prepare(`
      UPDATE hs_context_profile_documents
      SET error_message = ?
      WHERE id = ? AND extraction_status = 'pending'
    `).run(message, documentId)
  } catch (_) { /* non-critical */ }
}

// ── Job runners ───────────────────────────────────────────────────────────────

/**
 * Run the standard (automatic) extraction job for a document.
 * Tries direct → Tesseract OCR → sparse fallback.
 * On failure, stores error_code='NO_TEXT_EXTRACTED' to surface the BYOK card.
 */
export async function runExtractionJob(
  db: any,
  documentId: string,
  pdfBuffer: Buffer,
): Promise<void> {
  console.log(`[HS OCR] Starting extraction for document: ${documentId}`)
  markDocumentExtractionPending(db, documentId)

  const onOcrPageProgress = (current: number, total: number) => {
    updateExtractionProgress(db, documentId, `Extracting page ${current} of ${total} (OCR)…`)
  }

  const result = await extractTextFromPdf(pdfBuffer, onOcrPageProgress)

  if (result.success && result.extracted_text !== undefined) {
    const validation = validateExtractedText(result.extracted_text)
    if (validation.ok) {
      markDocumentExtractionSuccess(db, documentId, validation.sanitized, result.extractor_name ?? 'unknown')
      console.log(`[HS OCR] Extraction succeeded (${result.extractor_name}) for document: ${documentId}`)
    } else {
      markDocumentExtractionFailed(db, documentId, `Validation failed: ${validation.reason}`, 'VALIDATION_FAILED')
      console.warn(`[HS OCR] Extracted text validation failed for document ${documentId}:`, validation.reason)
    }
  } else {
    markDocumentExtractionFailed(db, documentId, result.error_message ?? 'Extraction failed', result.error_code)
    console.error(`[HS OCR] Extraction failed for document ${documentId}:`, result.error_message)
  }
}

/**
 * Run Vision API extraction for a document (user-initiated BYOK retry).
 * Renders each page as a PNG and sends to Anthropic's Vision API.
 * On success, overwrites any previous failed state with the extracted text.
 */
export async function runExtractionJobWithVision(
  db: any,
  documentId: string,
  pdfBuffer: Buffer,
  anthropicApiKey: string,
): Promise<void> {
  console.log(`[HS OCR Vision] Starting Vision extraction for document: ${documentId}`)
  markDocumentExtractionPending(db, documentId)

  const onVisionPageProgress = (current: number, total: number) => {
    updateExtractionProgress(db, documentId, `Extracting page ${current} of ${total} with AI Vision…`)
  }

  let result: OcrJobResult
  try {
    const pdfjs = await loadPdfjs()
    result = await extractTextVision(pdfjs, pdfBuffer, anthropicApiKey, onVisionPageProgress)
  } catch (err: any) {
    result = { success: false, error_message: err?.message ?? 'Vision extraction failed' }
  }

  if (result.success && result.extracted_text !== undefined) {
    const validation = validateExtractedText(result.extracted_text)
    if (validation.ok) {
      markDocumentExtractionSuccess(db, documentId, validation.sanitized, result.extractor_name ?? 'anthropic-vision', result.pageTexts)
      console.log(`[HS OCR Vision] Extraction succeeded for document: ${documentId}`)
    } else {
      markDocumentExtractionFailed(db, documentId, `Validation failed: ${validation.reason}`, 'VALIDATION_FAILED')
    }
  } else {
    markDocumentExtractionFailed(db, documentId, result.error_message ?? 'Vision extraction failed', result.error_code)
    console.error(`[HS OCR Vision] Extraction failed for document ${documentId}:`, result.error_message)
  }
}
