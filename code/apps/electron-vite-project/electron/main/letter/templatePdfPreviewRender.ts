/**
 * Template port — rasterize PDF pages to PNG data URLs (delegates to shared browser-window renderer).
 */

import { renderPdfPagesToImages } from './renderPdfPagesInBrowser'

export async function renderPdfFileToPngDataUrls(absPath: string): Promise<{
  pages: string[]
  pageCount: number
}> {
  const { pages, pageCount } = await renderPdfPagesToImages(absPath)
  return {
    pages: pages.map((p) => p.imageDataUrl),
    pageCount,
  }
}
