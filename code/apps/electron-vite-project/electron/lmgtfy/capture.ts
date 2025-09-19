import { app, desktopCapturer } from 'electron'
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
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: sel.w, height: sel.h } })
  const screenSource = sources.find(s => s.display_id && Number(s.display_id) === sel.displayId) || sources[0]
  const image = screenSource.thumbnail.crop({ x: sel.x, y: sel.y, width: sel.w, height: sel.h })
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


