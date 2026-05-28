/**
 * Inbox PDF extraction — routes through local depackager (on_demand); no pdfjs in main.
 */

import type { ExtractedAttachmentText } from './types'
import { extractPdfViaDepackager } from './pdfPodClient.js'

export type ExtractPdfTextResult = ExtractedAttachmentText & {
  success: boolean
  error?: string
  pages: string[]
  structural_hash?: string
  extractor_version?: string
}

/**
 * Map depackager / pod extraction output to inbox attachment status.
 */
export function resolveInboxPdfExtractionStatus(result: ExtractPdfTextResult): {
  status: 'done' | 'partial' | 'failed' | 'host_extracted_with_consent' | 'edge_extracted'
  error: string | null
} {
  const text = (result.text ?? '').trim()
  const pc = typeof result.pageCount === 'number' ? result.pageCount : 0
  if (!result.success || text.length === 0) {
    return {
      status: 'failed',
      error:
        result.error ??
        (result.warnings?.length ? result.warnings.join('; ') : null) ??
        'No text extracted',
    }
  }
  const avg = pc > 0 ? text.length / pc : 0
  if (pc > 5 && avg < 50) {
    return {
      status: 'partial',
      error: `Only ${text.length} chars extracted from ${pc} pages (~${Math.round(avg)} chars/page avg). Text extraction may be incomplete.`,
    }
  }
  return { status: 'done', error: null }
}

function pagesFromText(text: string): string[] {
  const parts = text.split('\n\n')
  return parts.length > 0 ? parts : ['']
}

/**
 * Extract PDF text via local depackager (requires pod + attachment/message ids).
 */
export async function extractPdfTextViaPod(
  buffer: Buffer,
  messageId: string,
  attachmentId: string,
): Promise<ExtractPdfTextResult> {
  if (buffer.length < 5 || buffer[0] !== 0x25 || buffer[1] !== 0x50 || buffer[2] !== 0x44 || buffer[3] !== 0x46) {
    return {
      attachmentId,
      text: '',
      pages: [],
      pageCount: 0,
      warnings: [],
      success: false,
      error: 'Invalid PDF: Missing PDF header',
    }
  }

  const pod = await extractPdfViaDepackager(buffer, { messageId, attachmentId })
  if (!pod.ok) {
    return {
      attachmentId,
      text: '',
      pages: [],
      pageCount: 0,
      warnings: [],
      success: false,
      error: pod.reason,
    }
  }

  const text = pod.extracted_text_v1.text
  const pages = pagesFromText(text)
  return {
    attachmentId,
    text,
    pages,
    pageCount: pages.length,
    warnings: [],
    success: text.trim().length > 0,
    structural_hash: pod.extracted_text_v1.structural_hash,
    extractor_version: pod.extracted_text_v1.extractor_version,
  }
}

/**
 * @deprecated Use extractPdfTextViaPod with message/attachment ids. Kept for callers that lack ids.
 */
export async function extractPdfText(buffer: Buffer): Promise<ExtractPdfTextResult> {
  return extractPdfTextViaPod(buffer, 'legacy', 'legacy')
}

export function isPdfFile(mimeType: string, filename?: string): boolean {
  if (mimeType === 'application/pdf') return true
  if (filename && filename.toLowerCase().endsWith('.pdf')) return true
  return false
}

export function getSupportedExtractionTypes(): string[] {
  return ['application/pdf', 'application/vnd.beap+json', 'application/json', 'text/plain']
}

export function supportsTextExtraction(mimeType: string): boolean {
  return getSupportedExtractionTypes().includes(mimeType)
}
