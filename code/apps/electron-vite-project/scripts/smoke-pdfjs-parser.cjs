/**
 * Pre-packaging smoke: `pdfjs-dist` must ship `build/pdf.worker.mjs` and resolve from package.json
 * the same way `electron/main/pdfjsWorkerSrc.ts` does (BEAP Composer / parser:extractPdfText).
 *
 * No hard-coded build output paths — uses createRequire from this app's package.json only.
 */
'use strict'

const { createRequire } = require('module')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')

const appDir = path.join(__dirname, '..')
const requireFromPkg = createRequire(path.join(appDir, 'package.json'))

let root
try {
  root = path.dirname(requireFromPkg.resolve('pdfjs-dist/package.json'))
} catch (e) {
  console.error('[smoke-pdf] Cannot resolve pdfjs-dist/package.json — install deps in apps/electron-vite-project', e)
  process.exit(1)
}

const worker = path.join(root, 'build', 'pdf.worker.mjs')
if (!fs.existsSync(worker)) {
  console.error('[smoke-pdf] MISSING', worker)
  process.exit(1)
}

const href = pathToFileURL(worker).href
if (!href.startsWith('file:') || !href.endsWith('pdf.worker.mjs')) {
  console.error('[smoke-pdf] UNEXPECTED file URL', href)
  process.exit(1)
}

console.log('[smoke-pdf] OK: pdfjs worker at', href)
process.exit(0)
