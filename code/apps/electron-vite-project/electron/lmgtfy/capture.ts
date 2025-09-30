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
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: fullW, height: fullH } })
  // Prefer matching by display_id; fall back to matching by thumbnail size as a heuristic
  let screenSource = sources.find(s => {
    try { return s.display_id && String(s.display_id) === String(display.id) } catch { return false }
  }) as any
  if (!screenSource) {
    screenSource = sources.find(s => {
      try { return s.thumbnail && s.thumbnail.getSize && s.thumbnail.getSize().width === fullW && s.thumbnail.getSize().height === fullH } catch { return false }
    }) as any
  }
  if (!screenSource) screenSource = sources[0] as any
  // Clamp crop rect to bounds to avoid out-of-range on rounding
  const x = Math.max(0, Math.min(fullW - 1, Math.round(sel.x)))
  const y = Math.max(0, Math.min(fullH - 1, Math.round(sel.y)))
  const w = Math.max(1, Math.min(fullW - x, Math.round(sel.w)))
  const h = Math.max(1, Math.min(fullH - y, Math.round(sel.h)))
  const image = screenSource.thumbnail.crop({ x, y, width: w, height: h })
  const png = image.toPNG()

  const dir = datedDir()
  const base = `shot_${Date.now()}`
  const filePath = path.join(dir, `${base}.png`)
  const thumbPath = path.join(dir, `${base}.thumb.png`)
  fs.writeFileSync(filePath, png)
  fs.writeFileSync(thumbPath, image.resize({ width: Math.min(320, sel.w) }).toPNG())
  return { filePath, thumbnailPath: thumbPath }
}

// Placeholder for stream capture; real implementation should use OS-specific APIs (WGC/CGDisplayStream/PipeWire)
export async function startRegionStream(_sel: Selection): Promise<{ stop: () => Promise<string> }> {
  const dir = datedDir()
  const base = `stream_${Date.now()}`
  const outFile = path.join(dir, `${base}.mp4`)
  // Minimal placeholder: write an empty file so renderer flow works. Replace with real capture pipeline.
  fs.writeFileSync(outFile, '')
  return {
    async stop() {
      // In real flow, finalize encoder and return path
      return outFile
    },
  }
}


