/**
 * Rasterize PDF pages to PNG data URLs using a hidden BrowserWindow (Chromium Canvas).
 * pdfjs-dist + node-canvas in the main process triggers "Image or Canvas expected" — this path does not.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { createRequire } from 'node:module'
import { BrowserWindow, type WebContents } from 'electron'

const require = createRequire(import.meta.url)

const MAX_PAGES = 100
const TARGET_SCALE = 2.0
const MAX_CANVAS_DIMENSION = 4096
const RENDER_READY_TIMEOUT_MS = 45_000

const INDEX_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title></title></head><body>
<script type="module" src="./bootstrap.mjs"></script>
</body></html>`

function bootstrapSource(): string {
  return `import * as pdfjsLib from './pdfjs/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./pdfjs/pdf.worker.mjs', import.meta.url).href;

window.__renderPdfFromBase64 = async function (b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  let doc;
  try {
    doc = await pdfjsLib.getDocument({ data: bytes }).promise;
  } catch (e) {
    const name = e && e.name ? e.name : '';
    const msg = e && e.message ? String(e.message) : String(e);
    if (name === 'PasswordException' || msg.toLowerCase().includes('password')) {
      throw new Error('This PDF is password-protected. Remove the password and re-upload.');
    }
    throw e;
  }

  const pages = [];
  const numPages = Math.min(doc.numPages, ${MAX_PAGES});
  for (let i = 1; i <= numPages; i++) {
    const page = await doc.getPage(i);
    const baseViewport = page.getViewport({ scale: 1.0 });
    const maxDim = Math.max(baseViewport.width, baseViewport.height);
    const scale = Math.min(${TARGET_SCALE}, ${MAX_CANVAS_DIMENSION} / maxDim);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D context');
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push(canvas.toDataURL('image/png'));
  }
  return { pages, pageCount: doc.numPages };
};
window.__pdfPreviewReady = true;
`
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name)
    const to = path.join(dest, name)
    const st = fs.statSync(from)
    if (st.isDirectory()) {
      copyDirSync(from, to)
    } else {
      fs.copyFileSync(from, to)
    }
  }
}

function pdfjsBuildDir(): string {
  const root = path.dirname(require.resolve('pdfjs-dist/package.json'))
  return path.join(root, 'build')
}

async function waitForPreviewReady(wc: WebContents, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ok = await wc.executeJavaScript('window.__pdfPreviewReady === true')
    if (ok === true) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('PDF preview renderer failed to initialize')
}

export async function renderPdfFileToPngDataUrls(absPath: string): Promise<{
  pages: string[]
  pageCount: number
}> {
  const buffer = fs.readFileSync(absPath)
  if (buffer.length < 5 || buffer[0] !== 0x25 || buffer[1] !== 0x50 || buffer[2] !== 0x44 || buffer[3] !== 0x46) {
    throw new Error('Invalid PDF file')
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wrdesk-pdf-raster-'))
  let win: BrowserWindow | null = null

  try {
    copyDirSync(pdfjsBuildDir(), path.join(tmpRoot, 'pdfjs'))
    fs.writeFileSync(path.join(tmpRoot, 'bootstrap.mjs'), bootstrapSource(), 'utf8')
    fs.writeFileSync(path.join(tmpRoot, 'index.html'), INDEX_HTML, 'utf8')

    win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 1600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      },
    })

    await win.loadFile(path.join(tmpRoot, 'index.html'))
    await waitForPreviewReady(win.webContents, RENDER_READY_TIMEOUT_MS)

    const b64 = buffer.toString('base64')
    const result = await win.webContents.executeJavaScript(
      `(async () => { return await window.__renderPdfFromBase64(${JSON.stringify(b64)}); })()`,
    ) as { pages: string[]; pageCount: number }

    if (!result || !Array.isArray(result.pages)) {
      throw new Error('PDF rasterize returned no pages')
    }

    return result
  } finally {
    if (win && !win.isDestroyed()) {
      try {
        win.destroy()
      } catch {
        /* noop */
      }
    }
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    } catch {
      /* noop */
    }
  }
}
