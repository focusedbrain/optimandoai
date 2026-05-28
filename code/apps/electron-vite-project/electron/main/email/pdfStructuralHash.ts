/**
 * Structural hash for PDF extracted text (aligned with @repo/beap-pod pdfExtractCore).
 */

import { createHash } from 'node:crypto'

export function canonicalizePagesForHash(pages: string[]): string {
  return pages.map((p) => p.replace(/\r\n?/g, '\n').trim()).join('\n\n')
}

export function computeStructuralHash(pages: string[]): string {
  return createHash('sha256').update(canonicalizePagesForHash(pages), 'utf8').digest('hex')
}

export function verifyExtractedTextStructuralHash(text: string, structuralHash: string): boolean {
  const pages = text.split('\n\n')
  const normalized = pages.length > 1 ? pages : [text]
  return computeStructuralHash(normalized) === structuralHash
}
