/**
 * PDF Text Extractor (Electron main)
 *
 * Uses pdfjs-dist + getTextContent(), same strategy as vault/hsContextOcrJob.ts
 * (reconstructPageText for positioned items — avoids CMap/stream garbage from raw parsing).
 */

import { createRequire } from 'module'
import path from 'path'
import { pathToFileURL } from 'url'
import { ExtractedAttachmentText } from './types'

const require = createRequire(import.meta.url)

function resolvePdfWorkerSrc(): string {
  const root = path.dirname(require.resolve('pdfjs-dist/package.json'))
  return pathToFileURL(path.join(root, 'build', 'pdf.worker.mjs')).href
}

async function loadPdfjs(): Promise<any> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs' as any).catch(() => import('pdfjs-dist' as any))
  if (pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = resolvePdfWorkerSrc()
  }
  return pdfjs
}

/**
 * Reconstruct readable text from a single PDF page's text items (aligned with hsContextOcrJob).
 */
function reconstructPageText(items: any[]): string {
  if (items.length === 0) return ''

  let result = ''
  let prevEndX = 0
  let prevY: number | null = null

  for (const item of items) {
    const str: string = item.str ?? ''
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

export type ExtractPdfTextResult = ExtractedAttachmentText & {
  success: boolean
  error?: string
  /** Per-page text (1-indexed order in array) */
  pages: string[]
}

/**
 * Extract text from a PDF buffer using pdfjs-dist (main entry for inbox / gateway).
 */
export async function extractPdfText(buffer: Buffer): Promise<ExtractPdfTextResult> {
  const warnings: string[] = []

  if (buffer.length < 5 || buffer[0] !== 0x25 || buffer[1] !== 0x50 || buffer[2] !== 0x44 || buffer[3] !== 0x46) {
    return {
      attachmentId: '',
      text: '',
      pages: [],
      pageCount: 0,
      warnings: [],
      success: false,
      error: 'Invalid PDF: Missing PDF header',
    }
  }

  try {
    const pdfjs = await loadPdfjs()
    let pdf: any
    try {
      const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) })
      pdf = await loadingTask.promise
    } catch (err: any) {
      if (err?.name === 'PasswordException' || err?.message?.toLowerCase?.().includes('password')) {
        return {
          attachmentId: '',
          text: '',
          pages: [],
          pageCount: 0,
          warnings: [],
          success: false,
          error:
            'This PDF is password-protected. Remove the password and re-upload, or open the original file.',
        }
      }
      throw err
    }

    const pageCount: number = pdf.numPages
    const pages: string[] = []

    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      pages.push(reconstructPageText(content.items))
    }

    const text = pages.join('\n\n')
    if (!text.trim()) {
      warnings.push('No text extracted from PDF text layer. The document may be scanned or image-only.')
    }

    return {
      attachmentId: '',
      text,
      pages,
      pageCount,
      warnings,
      success: text.trim().length > 0,
      error: text.trim().length > 0 ? undefined : warnings[0] ?? 'No text extracted',
    }
  } catch (err: any) {
    return {
      attachmentId: '',
      text: '',
      pages: [],
      pageCount: 0,
      warnings: [],
      success: false,
      error: err?.message ? String(err.message) : 'PDF extraction failed',
    }
  }
}

/**
 * Check if a file is a PDF based on MIME type or extension
 */
export function isPdfFile(mimeType: string, filename?: string): boolean {
  if (mimeType === 'application/pdf') {
    return true
  }

  if (filename && filename.toLowerCase().endsWith('.pdf')) {
    return true
  }

  return false
}

/**
 * Get supported document types for text extraction
 */
export function getSupportedExtractionTypes(): string[] {
  return ['application/pdf', 'application/vnd.beap+json', 'application/json', 'text/plain']
}

/**
 * Check if a MIME type supports text extraction
 */
export function supportsTextExtraction(mimeType: string): boolean {
  return getSupportedExtractionTypes().includes(mimeType)
}
