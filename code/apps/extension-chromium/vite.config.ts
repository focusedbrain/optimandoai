import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Build stamp (also set as import.meta.env). */
const VITE_EXT_BUILD_STAMP = 'build122'

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@shared-extension': path.resolve(__dirname, '../../packages/shared-extension/src'),
    },
  },
  define: {
    'import.meta.env.VITE_EXT_BUILD_STAMP': JSON.stringify(VITE_EXT_BUILD_STAMP),
  },
  build: {
    // Literal string required by apps/electron-vite-project/scripts/clear-build-caches.cjs (regex on vite.config.ts)
    outDir: 'build124',
    emptyOutDir: true,
    rollupOptions: {
      // HTML entry so Vite resolves ./popup-chat.tsx inside the template and emits hashed JS (fixes blank popup).
      input: {
        'popup-chat': path.resolve(__dirname, 'src/popup-chat.html'),
      },
      output: {
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
