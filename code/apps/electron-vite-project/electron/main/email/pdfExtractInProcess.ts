/**
 * In-process PDF text extraction (Case A — user-supplied composer files).
 * Used when the local depackager pod is not ready; does not require vault material.
 */

import { resolvePdfjsDistWorkerFileUrl } from '../pdfjsWorkerSrc.js'
import { computeStructuralHash } from './pdfStructuralHash.js'

export interface InProcessPdfExtractResult {
  text: string
  pageCount: number
  pageTexts: string[]
  structural_hash: string
  extractor_version: string
}

async function loadPdfjs(): Promise<any> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs' as any).catch(() =>
    import('pdfjs-dist' as any),
  )
  if (pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = resolvePdfjsDistWorkerFileUrl()
  }
  return pdfjs
}

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

/**
 * Extract text from a PDF buffer using pdfjs in the Electron main process.
 */
export async function extractPdfTextInProcess(pdfBuffer: Buffer): Promise<InProcessPdfExtractResult> {
  const pdfjs = await loadPdfjs()
  let pdf: any
  try {
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(pdfBuffer), verbosity: 0 })
    pdf = await loadingTask.promise
  } catch (err: any) {
    if (err?.name === 'PasswordException' || err?.message?.toLowerCase().includes('password')) {
      throw new Error(
        'This PDF is password-protected. Please remove the password and re-upload the document.',
      )
    }
    throw err
  }

  const pageCount: number = pdf.numPages
  const pageTexts: string[] = []

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    pageTexts.push(reconstructPageText(content.items))
  }

  const text = pageTexts.join('\n\n')
  const structural_hash = computeStructuralHash(pageTexts.length > 1 ? pageTexts : [text])

  return {
    text,
    pageCount,
    pageTexts,
    structural_hash,
    extractor_version: 'beap-pdf-extract-v1',
  }
}
