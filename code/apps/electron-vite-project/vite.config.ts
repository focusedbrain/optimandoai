import { defineConfig } from 'vite'
import path from 'node:path'
import fs from 'node:fs'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

// Plugin to copy pdf.worker.mjs to dist-electron at build time
function copyPdfWorkerPlugin() {
  return {
    name: 'copy-pdf-worker',
    writeBundle() {
      const workerSrc = path.resolve(__dirname, 'node_modules/pdfjs-dist/build/pdf.worker.mjs')
      const workerDest = path.resolve(__dirname, 'dist-electron/pdf.worker.mjs')
      
      if (fs.existsSync(workerSrc)) {
        fs.copyFileSync(workerSrc, workerDest)
        console.log('[copy-pdf-worker] Copied pdf.worker.mjs to dist-electron/')
      } else {
        console.warn('[copy-pdf-worker] Warning: pdf.worker.mjs not found at', workerSrc)
      }
    }
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              // pdfjs-dist is NOT externalized - it will be bundled
              // canvas (node-canvas), keytar are externalized (native modules)
              // electron is externalized to use runtime import
              external: ['electron', 'bufferutil', 'utf-8-validate', 'fluent-ffmpeg', 'ffmpeg-static', 'pg', 'libsodium-wrappers', '@journeyapps/sqlcipher', 'tesseract.js', 'canvas', 'keytar', 'open', 'jose'],
              output: {
                // Use 'auto' interop for CommonJS modules like electron
                interop: 'auto'
              }
            }
          },
          plugins: [copyPdfWorkerPlugin()]
        }
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, 'electron/preload.ts'),
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: process.env.NODE_ENV === 'test'
        // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        ? undefined
        : {},
    }),
  ],
})
