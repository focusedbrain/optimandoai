import { app, desktopCapturer, screen } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { Selection } from './overlay'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from 'ffmpeg-static'

// Configure ffmpeg with static binary path (no runtime loading)
// Handle both development and production (unpacked from asar)
if (ffmpegPath) {
  let actualPath = ffmpegPath
  // In production, replace app.asar with app.asar.unpacked for binaries
  if (actualPath.includes('app.asar') && !actualPath.includes('app.asar.unpacked')) {
    actualPath = actualPath.replace('app.asar', 'app.asar.unpacked')
  }
  console.log('[CAPTURE] FFmpeg path:', actualPath)
  console.log('[CAPTURE] FFmpeg exists:', fs.existsSync(actualPath))
  ffmpeg.setFfmpegPath(actualPath)
}

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

// Real video recording with frame capture + ffmpeg encoding (all bundled, no runtime loading)
export async function startRegionStream(sel: Selection): Promise<{ stop: () => Promise<string> }> {
  const dir = datedDir()
  const base = `stream_${Date.now()}`
  const outFile = path.join(dir, `${base}.webm`)
  const framesDir = path.join(dir, `${base}_frames`)
  ensureDir(framesDir)

  console.log('[CAPTURE] Starting real video recording:', { x: sel.x, y: sel.y, w: sel.w, h: sel.h })

  const displays = screen.getAllDisplays()
  const display = displays.find(d => d.id === sel.displayId) || displays[0]
  if (!display) throw new Error('Display not found')

  const fullW = Math.round(display.size.width * display.scaleFactor)
  const fullH = Math.round(display.size.height * display.scaleFactor)

  const x = Math.max(0, Math.min(fullW - 1, Math.round(sel.x)))
  const y = Math.max(0, Math.min(fullH - 1, Math.round(sel.y)))
  const w = Math.max(1, Math.min(fullW - x, Math.round(sel.w)))
  const h = Math.max(1, Math.min(fullH - y, Math.round(sel.h)))

  let frameCount = 0
  let recording = true
  const fps = 10

  // Capture frames in background
  const captureInterval = setInterval(async () => {
    if (!recording) return

    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: fullW, height: fullH }
      })

      const source = sources.find(s => String(s.display_id || s.id) === String(sel.displayId)) || sources[0]
      if (!source || !source.thumbnail) return

      const croppedImage = source.thumbnail.crop({ x, y, width: w, height: h })
      const framePath = path.join(framesDir, `frame_${String(frameCount).padStart(6, '0')}.png`)
      fs.writeFileSync(framePath, croppedImage.toPNG())
      frameCount++
    } catch (err) {
      console.log('[CAPTURE] Frame capture error:', err)
    }
  }, 1000 / fps)

  return {
    async stop() {
      console.log('[CAPTURE] Stopping video recording...')
      recording = false
      clearInterval(captureInterval)

      // Wait a bit for last frame
      await new Promise(resolve => setTimeout(resolve, 200))

      console.log(`[CAPTURE] Encoding ${frameCount} frames to video...`)

      if (frameCount === 0) {
        console.log('[CAPTURE] No frames captured, creating empty file')
        fs.writeFileSync(outFile, Buffer.from([]))
        try { fs.rmSync(framesDir, { recursive: true, force: true }) } catch {}
        return outFile
      }

      // Encode frames to video using bundled ffmpeg
      return new Promise<string>((resolve) => {
        ffmpeg()
          .input(path.join(framesDir, 'frame_%06d.png'))
          .inputFPS(fps)
          .videoCodec('libvpx')
          .size(`${w}x${h}`)
          .fps(fps)
          .outputOptions([
            '-deadline realtime',
            '-cpu-used 8',
            '-pix_fmt yuv420p'
          ])
          .on('start', (cmd) => console.log('[CAPTURE] FFmpeg command:', cmd))
          .on('progress', (progress) => {
            if (progress.percent) {
              console.log(`[CAPTURE] Encoding progress: ${Math.round(progress.percent)}%`)
            }
          })
          .on('end', () => {
            console.log('[CAPTURE] Video encoding complete:', outFile)
            // Cleanup frames
            try { fs.rmSync(framesDir, { recursive: true, force: true }) } catch {}
            resolve(outFile)
          })
          .on('error', (err) => {
            console.log('[CAPTURE] FFmpeg error:', err)
            // Create empty file on error
            fs.writeFileSync(outFile, Buffer.from([]))
            try { fs.rmSync(framesDir, { recursive: true, force: true }) } catch {}
            resolve(outFile)
          })
          .save(outFile)
      })
    }
  }
}


