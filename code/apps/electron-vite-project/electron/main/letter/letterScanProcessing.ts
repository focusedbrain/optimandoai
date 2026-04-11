/**
 * Letter Composer — scanned PDF / images: preview PNGs + text (pdfjs text in main + browser raster + optional Tesseract).
 * PDF page images use the same hidden BrowserWindow path as template preview (node-canvas + pdfjs render breaks in main).
 */

import fs from 'fs'
import path from 'path'
import { extractPdfText } from '../email/pdf-extractor'
import { ocrService } from '../ocr/ocr-service'
import { renderPdfPagesToImages } from './renderPdfPagesInBrowser'

/** Match hsContextOcrJob: sparse text layer → try OCR. */
const MIN_TEXT_CHARS_PER_PAGE = 30
const MAX_PDF_PAGES = 100

export type LetterScanPage = {
  pageNumber: number
  imageDataUrl: string
  text: string
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

function pngDataUrlToBuffer(dataUrl: string): Buffer | null {
  const prefix = 'data:image/png;base64,'
  if (!dataUrl.startsWith(prefix)) return null
  try {
    return Buffer.from(dataUrl.slice(prefix.length), 'base64')
  } catch {
    return null
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

  const imageByPage = new Map<number, string>()
  try {
    const { pages: rendered } = await renderPdfPagesToImages(absPath)
    for (const p of rendered) {
      if (p.pageNumber >= 1 && p.pageNumber <= pageCount) {
        imageByPage.set(p.pageNumber, p.imageDataUrl)
      }
    }
  } catch (e) {
    console.warn(
      '[letterScan] PDF page rasterize failed; continuing with text only:',
      e instanceof Error ? e.message : e,
    )
  }

  const pages: LetterScanPage[] = []
  const numPages = pageCount

  for (let i = 1; i <= numPages; i++) {
    const imageDataUrl = imageByPage.get(i) ?? ''
    let text = (pageTexts[i - 1] ?? '').trim()
    const pngBuffer = imageDataUrl ? pngDataUrlToBuffer(imageDataUrl) : null

    if (text.length < MIN_TEXT_CHARS_PER_PAGE && pngBuffer) {
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
