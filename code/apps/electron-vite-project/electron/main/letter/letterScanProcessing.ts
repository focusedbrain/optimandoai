/**
 * Letter Composer — scanned PDF / images: preview PNGs + text (pdfjs + optional Tesseract).
 * Patterns aligned with `email/pdf-extractor.ts` and `vault/hsContextOcrJob.ts`.
 */

import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { pathToFileURL } from 'url'
import { extractPdfText } from '../email/pdf-extractor'
import { ocrService } from '../ocr/ocr-service'

const require = createRequire(import.meta.url)

/** Match hsContextOcrJob: sparse text layer → try OCR. */
const MIN_TEXT_CHARS_PER_PAGE = 30
const MAX_PDF_PAGES = 100
const MAX_CANVAS_DIMENSION = 3508

export type LetterScanPage = {
  pageNumber: number
  imageDataUrl: string
  text: string
}

function resolvePdfWorkerSrc(): string {
  const root = path.dirname(require.resolve('pdfjs-dist/package.json'))
  return pathToFileURL(path.join(root, 'build', 'pdf.worker.mjs')).href
}

async function loadPdfjs(): Promise<any> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs' as any).catch(() =>
    import('pdfjs-dist' as any),
  )
  if (pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = resolvePdfWorkerSrc()
  }
  return pdfjs
}

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

function mimeForImageExt(ext: string): string {
  switch (ext) {
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    case '.tif':
    case '.tiff':
      return 'image/tiff'
    case '.jpg':
    case '.jpeg':
    default:
      return 'image/jpeg'
  }
}

export async function processPdfForLetterViewer(absPath: string): Promise<{
  pages: LetterScanPage[]
  fullText: string
}> {
  const buffer = fs.readFileSync(absPath)
  if (buffer.length < 5 || buffer[0] !== 0x25 || buffer[1] !== 0x50 || buffer[2] !== 0x44 || buffer[3] !== 0x46) {
    throw new Error('Invalid PDF file')
  }

  const extracted = await extractPdfText(buffer)
  if (!extracted.pageCount) {
    throw new Error(extracted.error || 'Could not read PDF')
  }

  const pageCount = Math.min(extracted.pageCount || extracted.pages.length || 0, MAX_PDF_PAGES)
  if (pageCount < 1) {
    throw new Error('PDF has no pages')
  }

  const pageTexts: string[] = []
  for (let i = 0; i < pageCount; i++) {
    pageTexts.push(extracted.pages[i] ?? '')
  }

  let createCanvas: (w: number, h: number) => any
  try {
    createCanvas = require('canvas').createCanvas
  } catch {
    throw new Error('canvas package is required for PDF page preview')
  }

  const pdfjs = await loadPdfjs()
  const canvasFactory = makeNodeCanvasFactory(createCanvas)
  let pdf: any
  try {
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer), canvasFactory })
    pdf = await loadingTask.promise
  } catch (err: any) {
    if (err?.name === 'PasswordException' || err?.message?.toLowerCase?.().includes('password')) {
      throw new Error(
        'This PDF is password-protected. Remove the password and re-upload.',
      )
    }
    throw err
  }

  const pages: LetterScanPage[] = []
  const numPages = Math.min(pdf.numPages, pageCount)

  for (let i = 1; i <= numPages; i++) {
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

    const imageDataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`
    let text = (pageTexts[i - 1] ?? '').trim()

    if (text.length < MIN_TEXT_CHARS_PER_PAGE) {
      try {
        const ocrResult = await ocrService.processImage(
          { type: 'buffer', data: pngBuffer },
          { language: 'eng' },
        )
        const ocrText = (ocrResult.text ?? '').trim()
        if (ocrText.length > text.length) {
          text = ocrText
        }
      } catch (e) {
        console.warn(`[letterScan] Tesseract failed on PDF page ${i}:`, e instanceof Error ? e.message : e)
      }
    }

    pages.push({ pageNumber: i, imageDataUrl, text })
  }

  const fullText = pages.map((p) => p.text).filter(Boolean).join('\n\n--- Page Break ---\n\n')
  return { pages, fullText }
}

export async function processImageFileForLetterViewer(absPath: string): Promise<{
  imageDataUrl: string
  text: string
}> {
  const buffer = fs.readFileSync(absPath)
  const ext = path.extname(absPath).toLowerCase()
  const mime = mimeForImageExt(ext)
  const imageDataUrl = `data:${mime};base64,${buffer.toString('base64')}`

  let text = ''
  try {
    const ocrResult = await ocrService.processImage({ type: 'buffer', data: buffer }, { language: 'eng' })
    text = (ocrResult.text ?? '').trim()
  } catch (e) {
    console.warn('[letterScan] Image OCR failed:', e instanceof Error ? e.message : e)
  }

  return { imageDataUrl, text }
}
