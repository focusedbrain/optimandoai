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

// Video recording using a hidden window with MediaRecorder
export async function startRegionStream(sel: Selection): Promise<{ stop: () => Promise<string> }> {
  const { BrowserWindow } = await import('electron')
  const dir = datedDir()
  const base = `stream_${Date.now()}`
  const outFile = path.join(dir, `${base}.webm`)
  
  // Create a hidden window for recording (regular windows have access to media APIs)
  const recorderWin = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      offscreen: true  // Render offscreen for better performance
    }
  })

  // Load a data URL with the recording script
  await recorderWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
    <!DOCTYPE html>
    <html><body><script>
      const { ipcRenderer, desktopCapturer } = require('electron');
      const fs = require('fs');
      const path = require('path');
      
      let recorder = null;
      let chunks = [];
      
      async function startRecording(sel, outFile) {
        try {
          const sources = await desktopCapturer.getSources({ types: ['screen'] });
          let source = sources.find(s => s.display_id === String(sel.displayId)) || sources[0];
          
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: source.id,
                minWidth: 1280,
                maxWidth: 4096,
                minHeight: 720,
                maxHeight: 2160
              }
            }
          });
          
          // Create canvas to crop to selected region
          const video = document.createElement('video');
          video.srcObject = stream;
          video.muted = true;
          await video.play();
          
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(2, sel.w);
          canvas.height = Math.max(2, sel.h);
          const ctx = canvas.getContext('2d');
          
          // Draw cropped frames
          function drawFrame() {
            ctx.drawImage(video, sel.x, sel.y, sel.w, sel.h, 0, 0, canvas.width, canvas.height);
            requestAnimationFrame(drawFrame);
          }
          requestAnimationFrame(drawFrame);
          
          // Record canvas stream
          const canvasStream = canvas.captureStream(30);
          recorder = new MediaRecorder(canvasStream, { mimeType: 'video/webm;codecs=vp9' });
          
          recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
          recorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'video/webm' });
            const reader = new FileReader();
            reader.onload = () => {
              const buffer = Buffer.from(reader.result);
              fs.writeFileSync(outFile, buffer);
              ipcRenderer.send('recording-complete', outFile);
            };
            reader.readAsArrayBuffer(blob);
            stream.getTracks().forEach(t => t.stop());
          };
          
          recorder.start(250);
          ipcRenderer.send('recording-started');
        } catch (err) {
          ipcRenderer.send('recording-error', String(err));
        }
      }
      
      ipcRenderer.on('start', (_, sel, outFile) => startRecording(sel, outFile));
      ipcRenderer.on('stop', () => { if (recorder && recorder.state !== 'inactive') recorder.stop(); });
    </script></body></html>
  `))

  // Start recording
  await new Promise<void>((resolve, reject) => {
    recorderWin.webContents.once('ipc-message', (_e, channel) => {
      if (channel === 'recording-started') resolve()
      else if (channel === 'recording-error') reject(new Error('Recording failed'))
    })
    recorderWin.webContents.send('start', sel, outFile)
  })

  return {
    async stop() {
      return new Promise<string>((resolve) => {
        recorderWin.webContents.once('ipc-message', (_e, channel, file) => {
          if (channel === 'recording-complete') {
            recorderWin.close()
            resolve(file)
          }
        })
        recorderWin.webContents.send('stop')
      })
    },
  }
}


