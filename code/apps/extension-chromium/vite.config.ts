import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config'
import path from 'path'

/**
 * Vite plugin: makes the preload-helper chunk safe for service workers.
 *
 * Vite's default preload helper uses `document` and `window` which don't
 * exist in Chrome extension MV3 service workers.  This plugin patches the
 * generated helper to early-return from the import wrapper when `document`
 * is unavailable (i.e. in a service worker), while preserving full
 * preloading behaviour for content scripts, popups, and sidepanels.
 */
function serviceWorkerSafePreload(): Plugin {
  return {
    name: 'sw-safe-preload',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const [key, chunk] of Object.entries(bundle)) {
        if (key.includes('preload-helper') && chunk.type === 'chunk') {
          // Wrap the exported function so it skips DOM preloading when
          // `document` is not available (service worker context).
          chunk.code = chunk.code.replace(
            /export\{(\w+) as _\}/,
            'const __swSafe = function(loader, deps, url) {' +
            '  if (typeof document === "undefined") return loader();' +
            '  return $1(loader, deps, url);' +
            '};' +
            'export { __swSafe as _ }'
          )
        }
      }
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
    serviceWorkerSafePreload(),
  ],
  // Use relative paths for Chrome extension compatibility
  base: '',
  resolve: {
    alias: {
      '@shared-extension': path.resolve(__dirname, '../../packages/shared-extension/src'),
      '@shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
  build: {
    // Disable Vite's modulepreload polyfill — it references `document` and
    // `window` which don't exist in Chrome extension service workers (MV3).
    modulePreload: false,
    rollupOptions: {
      input: {
        'popup-chat': path.resolve(__dirname, 'src/popup-chat.html')
      },
      output: {
        manualChunks(id) {
          // Keep handshake UI components in a shared chunk loaded by both
          // sidepanel and popup-chat — prevents HandshakeRequestForm from
          // being siloed into the sidepanel-only bundle.
          if (id.includes('handshake/components') || id.includes('handshake\\components')) {
            return 'handshake-ui'
          }
        }
      }
    }
  }
})
