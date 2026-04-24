/**
 * Central pdfjs-dist worker path for the Electron main process.
 *
 * Do not set `GlobalWorkerOptions.workerSrc` to `path.join(__dirname, 'pdf.worker.mjs')`:
 * the Vite main bundle does not place `pdf.worker.mjs` next to `dist-electron/main.js`,
 * and packaged `app.asar` would look for a non-existent `dist-electron/pdf.worker.mjs`.
 *
 * Resolving from `pdfjs-dist/package.json` always finds `build/pdf.worker.mjs` in
 * `app.asar/node_modules/pdfjs-dist` (or dev `node_modules`).
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

/** `file://` URL to the installed `pdfjs-dist` legacy worker (`build/pdf.worker.mjs`). */
export function resolvePdfjsDistWorkerFileUrl(): string {
  const root = path.dirname(require.resolve('pdfjs-dist/package.json'))
  return pathToFileURL(path.join(root, 'build', 'pdf.worker.mjs')).href
}
