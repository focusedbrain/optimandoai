/**
 * Render each page of a PDF on disk to PNG data URLs (pdfjs-dist + canvas).
 * Used for Letter Composer template mapping preview (high-res for zone drawing).
 */

import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { pathToFileURL } from 'url'

const require = createRequire(import.meta.url)

const MAX_CANVAS_DIMENSION = 4096
const MAX_PAGES = 100
const TARGET_SCALE = 2.0

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

export async function renderPdfFileToPngDataUrls(absPath: string): Promise<{
  pages: string[]
  pageCount: number
}> {
  const buffer = fs.readFileSync(absPath)
  if (buffer.length < 5 || buffer[0] !== 0x25 || buffer[1] !== 0x50 || buffer[2] !== 0x44 || buffer[3] !== 0x46) {
    throw new Error('Invalid PDF file')
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
      throw new Error('This PDF is password-protected. Remove the password and re-upload.')
    }
    throw err
  }

  const numPages = Math.min(pdf.numPages, MAX_PAGES)
  const pages: string[] = []

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i)
    const baseViewport = page.getViewport({ scale: 1.0 })
    const maxDim = Math.max(baseViewport.width, baseViewport.height)
    const scale = Math.min(TARGET_SCALE, MAX_CANVAS_DIMENSION / maxDim)
    const viewport = page.getViewport({ scale })

    const canvasAndContext = canvasFactory.create(viewport.width, viewport.height)
    await page.render({
      canvasContext: canvasAndContext.context,
      viewport,
      canvasFactory,
    }).promise

    const pngBuffer: Buffer = canvasAndContext.canvas.toBuffer('image/png')
    canvasFactory.destroy(canvasAndContext)
    pages.push(`data:image/png;base64,${pngBuffer.toString('base64')}`)
  }

  return { pages, pageCount: pdf.numPages }
}
