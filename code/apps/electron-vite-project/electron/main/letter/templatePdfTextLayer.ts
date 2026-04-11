/**
 * PDF text positions for Letter Composer rectangle mapping (normalized 0–1, same basis as FieldMappingOverlay).
 */

import fs from 'fs'

const MAX_PAGES = 100

export type PdfPageTextItem = { text: string; x: number; y: number; w: number; h: number }

export type PdfPageTextPositions = { page: number; items: PdfPageTextItem[] }

async function loadPdfjs(): Promise<any> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs' as any).catch(() =>
    import('pdfjs-dist' as any),
  )
  const { createRequire } = await import('module')
  const { pathToFileURL } = await import('url')
  const path = await import('path')
  const require = createRequire(import.meta.url)
  if (pdfjs.GlobalWorkerOptions) {
    const root = path.dirname(require.resolve('pdfjs-dist/package.json'))
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(root, 'build', 'pdf.worker.mjs')).href
  }
  return pdfjs
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

export async function extractPdfTextPositionsFromPath(absPath: string): Promise<PdfPageTextPositions[]> {
  const buffer = fs.readFileSync(absPath)
  if (buffer.length < 5 || buffer[0] !== 0x25 || buffer[1] !== 0x50 || buffer[2] !== 0x44 || buffer[3] !== 0x46) {
    return []
  }

  const pdfjs = await loadPdfjs()
  let pdf: any
  try {
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) })
    pdf = await loadingTask.promise
  } catch {
    return []
  }

  const numPages = Math.min(pdf.numPages, MAX_PAGES)
  const pages: PdfPageTextPositions[] = []

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 1.0 })
    const textContent = await page.getTextContent()
    const vw = viewport.width || 1
    const vh = viewport.height || 1
    const items: PdfPageTextItem[] = []

    for (const raw of textContent.items as any[]) {
      const str = typeof raw.str === 'string' ? raw.str : ''
      if (!str.trim()) continue
      const tx: number[] = Array.isArray(raw.transform) ? raw.transform : [1, 0, 0, 1, 0, 0]
      const fontHeight =
        typeof raw.height === 'number' && raw.height > 0 ? raw.height : Math.abs(tx[3]) || 12
      const x = tx[4] / vw
      const y = 1 - (tx[5] + fontHeight) / vh
      const w = (typeof raw.width === 'number' && raw.width > 0 ? raw.width : str.length * 6) / vw
      const h = fontHeight / vh
      items.push({
        text: str,
        x: clamp01(x),
        y: clamp01(y),
        w: clamp01(w || 0.02),
        h: clamp01(h || 0.02),
      })
    }

    pages.push({ page: i - 1, items })
  }

  return pages
}
