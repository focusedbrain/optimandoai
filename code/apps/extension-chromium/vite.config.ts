import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config'
import path from 'path'

/**
 * Vite plugin: makes the preload helper safe for service workers.
 *
 * The background (service worker) imports the preload helper from the
 * handshake-ui chunk, which contains React and DOM code. Loading that chunk
 * in a service worker causes "document is not defined". This plugin:
 * 1. Patches preload-helper chunks when they exist (legacy).
 * 2. Replaces the background chunk's import of handshake-ui with an inline
 *    SW-safe implementation so the background never loads DOM-dependent code.
 */
function serviceWorkerSafePreload(): Plugin {
  return {
    name: 'sw-safe-preload',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const [key, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk') continue

        // 1. Patch preload-helper chunks (if Vite emits a separate one)
        if (key.includes('preload-helper')) {
          chunk.code = chunk.code.replace(
            /export\{(\w+) as _\}/,
            'const __swSafe = function(loader, deps, url) {' +
              '  if (typeof document === "undefined") return loader();' +
              '  return $1(loader, deps, url);' +
              '};' +
              'export { __swSafe as _ }'
          )
          continue
        }

        // 2. Background chunk: replace handshake-ui import with SW-safe inline preload.
        // The background imports { _ as J } from handshake-ui for dynamic import wrapping.
        // handshake-ui contains React/DOM and fails in service workers.
        const isBackground =
          key.includes('background') &&
          (key.endsWith('.js') || key.includes('background.ts'))
        if (isBackground && chunk.code.includes('handshake-ui')) {
          chunk.code = chunk.code.replace(
            /import\{_ as (\w+)\}from["'][^"']*handshake-ui[^"']*["'];?/,
            (_, localName) =>
              `const ${localName}=(loader,deps,url)=>loader();`
          )
        }
      }
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    // @ts-expect-error crxjs plugin types lag behind Vite's Plugin type
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
    outDir: 'build455',
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
