import { app, desktopCapturer, screen } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { Selection } from './overlay'

function capturesRoot() {
  return path.join(app.getPath('home'), '.opengiraffe', 'lmgtfy', 'captures')
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true })
}

function datedDir() {
  const d = new Date()
  const yyyy = d.getFullYear().toString()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const dir = path.join(capturesRoot(), yyyy, mm, dd)
  ensureDir(dir)
  return dir
}

export async function captureScreenshot(sel: Selection): Promise<{ filePath: string; thumbnailPath: string }> {
  const display = screen.getAllDisplays().find(d => d.id === sel.displayId) || screen.getPrimaryDisplay()
  const scale = Math.max(1, display.scaleFactor)
  const fullW = Math.max(1, Math.round(display.size.width * scale))
  const fullH = Math.max(1, Math.round(display.size.height * scale))
  console.log('[CAPTURE] captureScreenshot input:', { displayId: sel.displayId, logicalX: sel.x, logicalY: sel.y, logicalW: sel.w, logicalH: sel.h, scale, physicalFullW: fullW, physicalFullH: fullH })
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: fullW, height: fullH } })
  const displays = screen.getAllDisplays()
  const displayIndex = Math.max(0, displays.findIndex(d => d.id === display.id))
  // Try matching by display_id string first, then by index fallback
  let screenSource = sources.find(s => {
    try { return s.display_id && (String(s.display_id) === String(display.id)) } catch { return false }
  }) as any
  if (!screenSource && sources[displayIndex]) screenSource = sources[displayIndex] as any
  if (!screenSource) {
    screenSource = sources.find(s => {
      try { return s.thumbnail && s.thumbnail.getSize && s.thumbnail.getSize().width === fullW && s.thumbnail.getSize().height === fullH } catch { return false }
    }) as any
  }
  if (!screenSource) screenSource = sources[0] as any
  // Log actual thumbnail dimensions so we can confirm the source matches what we expect.
  try {
    const sz = screenSource?.thumbnail?.getSize?.()
    console.log('[CAPTURE] source thumbnail size:', sz, '| matched display index:', displayIndex)
  } catch {}
  // Overlay / WR Chat store selection in display **logical** (DIP) coords (getBoundingClientRect).
  // Thumbnail buffer is physical pixels — multiply by scaleFactor before crop.
  const rawX = Math.round(sel.x * scale)
  const rawY = Math.round(sel.y * scale)
  const rawW = Math.round(sel.w * scale)
  const rawH = Math.round(sel.h * scale)
  const x = Math.max(0, Math.min(fullW - 1, rawX))
  const y = Math.max(0, Math.min(fullH - 1, rawY))
  const w = Math.max(1, Math.min(fullW - x, rawW))
  const h = Math.max(1, Math.min(fullH - y, rawH))
  if (rawX !== x || rawY !== y || rawW !== w || rawH !== h) {
    console.warn('[CAPTURE] crop coords clamped:', { rawX, rawY, rawW, rawH, clampedX: x, clampedY: y, clampedW: w, clampedH: h, fullW, fullH })
  }
  console.log('[CAPTURE] final crop region (physical px):', { x, y, w, h })
  const image = screenSource.thumbnail.crop({ x, y, width: w, height: h })
  const png = image.toPNG()
  console.log('[CAPTURE] PNG size bytes:', png.length)

  const dir = datedDir()
  const base = `shot_${Date.now()}`
  const filePath = path.join(dir, `${base}.png`)
  const thumbPath = path.join(dir, `${base}.thumb.png`)
  fs.writeFileSync(filePath, png)
  fs.writeFileSync(thumbPath, image.resize({ width: Math.min(320, w) }).toPNG())
  return { filePath, thumbnailPath: thumbPath }
}

/**
 * Region video streaming previously encoded frames with a bundled binary whose license (GPL-3.0+)
 * is incompatible with this product. The API remains for compile-time stability; callers receive a clear error.
 */
export async function startRegionStream(_sel: Selection): Promise<{ stop: () => Promise<string> }> {
  console.warn(
    '[capture] startRegionStream is disabled — third-party screen-region video encoder removed (license incompatibility).',
  )
  throw new Error(
    'Region streaming is unavailable. The previous video encoder was removed due to GPL license incompatibility.',
  )
}
