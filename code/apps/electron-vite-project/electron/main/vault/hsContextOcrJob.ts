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
 *
 * Updates extraction_status in hs_context_profile_documents on completion.
 */

import { createRequire } from 'module'
import { ocrService } from '../ocr/ocr-service'

const require = createRequire(import.meta.url)

// Minimum text length (characters) for a page to be considered "text-extractable".
// Pages with fewer characters will fall back to OCR.
const MIN_TEXT_CHARS_PER_PAGE = 30

// Extracted text validation limits
const EXTRACTED_TEXT_MAX_LENGTH = 2_000_000 // ~2MB of plain text
const CONTROL_CHAR_REGEX = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g
const HTML_TAG_REGEX = /<[^>]+>/g

// ── Types ──

export interface OcrJobResult {
  success: boolean
  extracted_text?: string
  extractor_name?: string
  error_message?: string
}

// ── PDF.js loader ──

async function loadPdfjs(): Promise<any> {
  try {
    // pdfjs-dist legacy build runs in Node without a canvas dependency for
    // text extraction. For OCR rendering we use the canvas package if available.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs' as any).catch(
      () => import('pdfjs-dist' as any)
    )
    // Disable worker in Node environment
    if (pdfjs.GlobalWorkerOptions) {
      pdfjs.GlobalWorkerOptions.workerSrc = ''
    }
    return pdfjs
  } catch (err: any) {
    throw new Error(`Failed to load pdfjs-dist: ${err?.message}`)
  }
}

// ── Direct text extraction ──

async function extractTextDirect(pdfjs: any, data: Buffer): Promise<{ text: string; pageCount: number }> {
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data) })
  const pdf = await loadingTask.promise
  const pageCount: number = pdf.numPages
  const pageTexts: string[] = []

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item: any) => (item as any).str ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    pageTexts.push(pageText)
  }

  return { text: pageTexts.join('\n\n'), pageCount }
}

// ── OCR fallback via Tesseract ──

async function extractTextOcr(pdfjs: any, data: Buffer): Promise<{ text: string; pageCount: number }> {
  // Try to load canvas for rendering; if unavailable, we can only use direct
  let canvas: any = null
  try {
    canvas = require('canvas')
  } catch {
    throw new Error('canvas package not available for OCR rendering; install `canvas` or use a text-layer PDF')
  }

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data) })
  const pdf = await loadingTask.promise
  const pageCount: number = pdf.numPages
  const pageTexts: string[] = []

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 2.0 }) // 2x scale for better OCR accuracy

    const canvasEl = canvas.createCanvas(viewport.width, viewport.height)
    const ctx = canvasEl.getContext('2d')

    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise

    const pngBuffer: Buffer = canvasEl.toBuffer('image/png')
    const ocrResult = await ocrService.processImage({ type: 'buffer', data: pngBuffer })
    pageTexts.push(ocrResult.text.trim())
  }

  return { text: pageTexts.join('\n\n'), pageCount }
}

// ── Main extraction entrypoint ──

/**
 * Extract text from a PDF buffer.
 * Attempts direct text extraction first; falls back to OCR if the
 * extracted text is too sparse (scanned PDF).
 */
export async function extractTextFromPdf(pdfBuffer: Buffer): Promise<OcrJobResult> {
  try {
    const pdfjs = await loadPdfjs()

    // Attempt 1: Direct text extraction
    let directResult: { text: string; pageCount: number } | null = null
    try {
      directResult = await extractTextDirect(pdfjs, pdfBuffer)
    } catch (err: any) {
      console.warn('[HS OCR] Direct text extraction failed:', err?.message)
    }

    if (directResult) {
      const charCount = directResult.text.replace(/\s/g, '').length
      const avgCharsPerPage = charCount / Math.max(1, directResult.pageCount)

      if (avgCharsPerPage >= MIN_TEXT_CHARS_PER_PAGE) {
        return {
          success: true,
          extracted_text: directResult.text.trim(),
          extractor_name: 'pdfjs-direct',
        }
      }
      // Text layer too sparse — fall through to OCR
      console.log(`[HS OCR] Text layer sparse (${avgCharsPerPage.toFixed(0)} chars/page), falling back to OCR`)
    }

    // Attempt 2: OCR via Tesseract
    try {
      const ocrResult = await extractTextOcr(pdfjs, pdfBuffer)
      return {
        success: true,
        extracted_text: ocrResult.text.trim(),
        extractor_name: 'pdfjs+tesseract',
      }
    } catch (ocrErr: any) {
      // If OCR is unavailable, return whatever direct extraction gave us
      if (directResult && directResult.text.trim()) {
        console.warn('[HS OCR] OCR failed, using sparse direct text:', ocrErr?.message)
        return {
          success: true,
          extracted_text: directResult.text.trim(),
          extractor_name: 'pdfjs-direct-sparse',
        }
      }
      throw ocrErr
    }
  } catch (err: any) {
    return {
      success: false,
      error_message: err?.message ?? 'Unknown extraction error',
    }
  }
}

// ── Extracted text validation ──

/**
 * Validate and sanitize extracted document text before persistence.
 * Rejects clearly unsafe or unusable outputs. Returns null if validation fails.
 */
export function validateExtractedText(text: string | null | undefined): { ok: true; sanitized: string } | { ok: false; reason: string } {
  if (text == null || typeof text !== 'string') {
    return { ok: false, reason: 'Extracted text is missing or not a string' }
  }
  if (text.length > EXTRACTED_TEXT_MAX_LENGTH) {
    return { ok: false, reason: `Extracted text exceeds maximum length (${EXTRACTED_TEXT_MAX_LENGTH} chars)` }
  }
  // Strip control characters
  const withoutControl = text.replace(CONTROL_CHAR_REGEX, '')
  // Reject if HTML/markup present (conservative: any tag-like content)
  if (HTML_TAG_REGEX.test(withoutControl)) {
    return { ok: false, reason: 'Extracted text contains HTML or markup' }
  }
  // Normalize to plain text: collapse excessive newlines, trim
  const normalized = withoutControl
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!normalized) {
    return { ok: false, reason: 'Extracted text is empty after sanitization' }
  }
  return { ok: true, sanitized: normalized }
}

// ── DB update helpers ──

export function markDocumentExtractionPending(db: any, documentId: string): void {
  db.prepare(`
    UPDATE hs_context_profile_documents
    SET extraction_status = 'pending', error_message = NULL
    WHERE id = ?
  `).run(documentId)
}

export function markDocumentExtractionSuccess(
  db: any,
  documentId: string,
  extractedText: string,
  extractorName: string,
): void {
  db.prepare(`
    UPDATE hs_context_profile_documents
    SET extraction_status = 'success',
        extracted_text = ?,
        extracted_at = ?,
        extractor_name = ?,
        error_message = NULL
    WHERE id = ?
  `).run(extractedText, Date.now(), extractorName, documentId)
}

export function markDocumentExtractionFailed(
  db: any,
  documentId: string,
  errorMessage: string,
): void {
  db.prepare(`
    UPDATE hs_context_profile_documents
    SET extraction_status = 'failed',
        extracted_text = NULL,
        error_message = ?
    WHERE id = ?
  `).run(errorMessage, documentId)
}

/**
 * Run the extraction job for a document.
 * Reads the encrypted PDF from storage, extracts text, persists results.
 *
 * @param db           Open vault DB connection.
 * @param documentId   The hs_context_profile_documents row id.
 * @param pdfBuffer    Decrypted PDF content as a Buffer.
 */
export async function runExtractionJob(
  db: any,
  documentId: string,
  pdfBuffer: Buffer,
): Promise<void> {
  console.log(`[HS OCR] Starting extraction for document: ${documentId}`)
  markDocumentExtractionPending(db, documentId)

  const result = await extractTextFromPdf(pdfBuffer)

  if (result.success && result.extracted_text !== undefined) {
    const validation = validateExtractedText(result.extracted_text)
    if (validation.ok) {
      markDocumentExtractionSuccess(
        db,
        documentId,
        validation.sanitized,
        result.extractor_name ?? 'unknown',
      )
      console.log(`[HS OCR] Extraction succeeded (${result.extractor_name}) for document: ${documentId}`)
    } else {
      markDocumentExtractionFailed(db, documentId, `Validation failed: ${validation.reason}`)
      console.warn(`[HS OCR] Extracted text validation failed for document ${documentId}:`, validation.reason)
    }
  } else {
    markDocumentExtractionFailed(db, documentId, result.error_message ?? 'Extraction failed')
    console.error(`[HS OCR] Extraction failed for document ${documentId}:`, result.error_message)
  }
}
