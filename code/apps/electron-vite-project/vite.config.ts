import { defineConfig } from 'vite'
import path from 'node:path'
import fs from 'node:fs'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

// Plugin to intercept specific extension files and replace with Electron shims.
// Aliases don't work for relative imports inside extension-chromium — resolveId catches them by absolute path.
function shimExtensionPlugin() {
  const extSrc = path.resolve(__dirname, '../extension-chromium/src')
  const shimDir = path.resolve(__dirname, 'src/shims')

  // Normalize to forward slashes for cross-platform comparison
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\.(ts|tsx|js|jsx)$/, '')

  const shimMap: Record<string, string> = {
    [norm(path.join(extSrc, 'handshake', 'handshakeRpc'))]: path.join(shimDir, 'handshakeRpc.ts'),
    [norm(path.join(extSrc, 'vault', 'hsContextProfilesRpc'))]: path.join(shimDir, 'hsContextProfilesRpc.ts'),
  }

  return {
    name: 'shim-extension',
    enforce: 'pre' as const,
    resolveId(id: string, importer: string | undefined) {
      if (!importer) return null
      let resolved: string
      if (id.startsWith('.')) {
        resolved = norm(path.resolve(path.dirname(importer), id))
      } else {
        resolved = norm(id)
      }
      const shim = shimMap[resolved]
      if (shim) return shim
      return null
    },
    load(id: string) {
      const normalized = norm(id)
      const shim = shimMap[normalized]
      if (shim) {
        return fs.readFileSync(shim, 'utf-8')
      }
      return null
    },
  }
}

// Remove the crossorigin attribute from all <script> and <link> tags in the built HTML.
// When base is './' and Electron loads via file://, the crossorigin="anonymous" attribute
// causes CORS blocking in sandboxed renderers on Windows → blank white page.
// Uses closeBundle (not transformIndexHtml) so the source index.html is never modified.
function removeCrossoriginPlugin() {
  return {
    name: 'remove-crossorigin',
    apply: 'build' as const,
    closeBundle() {
      const distHtml = path.resolve(__dirname, 'dist', 'index.html')
      if (fs.existsSync(distHtml)) {
        const content = fs.readFileSync(distHtml, 'utf-8')
        const fixed = content.replace(/ crossorigin(?:="[^"]*")?/g, '')
        if (fixed !== content) {
          fs.writeFileSync(distHtml, fixed, 'utf-8')
          console.log('[remove-crossorigin] Stripped crossorigin from dist/index.html')
        }
      }
    },
  }
}

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
  // Required for Electron loadFile() with file:// protocol — relative paths must resolve
  // from the index.html location; default '/' breaks in packaged app.
  base: './',
  // Unminified build + sourcemaps for readable React error messages (remove after debugging)
  build: {
    sourcemap: true,
    minify: false,
  },
  resolve: {
    alias: [
      // Shared package (used by extension-chromium components bundled in renderer)
      { find: '@shared', replacement: path.resolve(__dirname, '../../packages/shared/src') },
      // Shim the extension's handshakeRpc (matched by both alias and absolute path for relative imports)
      { find: '@ext/handshake/handshakeRpc', replacement: path.resolve(__dirname, 'src/shims/handshakeRpc') },
      { find: path.resolve(__dirname, '../extension-chromium/src/handshake/handshakeRpc'), replacement: path.resolve(__dirname, 'src/shims/handshakeRpc') },
      // Shim hsContextProfilesRpc
      { find: '@ext/vault/hsContextProfilesRpc', replacement: path.resolve(__dirname, 'src/shims/hsContextProfilesRpc') },
      { find: path.resolve(__dirname, '../extension-chromium/src/vault/hsContextProfilesRpc'), replacement: path.resolve(__dirname, 'src/shims/hsContextProfilesRpc') },
      // Other shims
      { find: '@ext/reconstruction', replacement: path.resolve(__dirname, 'src/shims/reconstruction') },
      { find: '@ext/audit', replacement: path.resolve(__dirname, 'src/shims/audit') },
      { find: '@ext/envelope-evaluation', replacement: path.resolve(__dirname, 'src/shims/envelope-evaluation') },
      { find: '@ext/ingress', replacement: path.resolve(__dirname, 'src/shims/ingress') },
      // Catch-all for @ext
      { find: '@ext', replacement: path.resolve(__dirname, '../extension-chromium/src') },
    ],
  },
  plugins: [
    shimExtensionPlugin(),
    removeCrossoriginPlugin(),
    react(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
        vite: {
          define: {
            // Inlined at `vite build` — set GOOGLE_OAUTH_CLIENT_ID in CI for packaged Gmail OAuth.
            __BUILD_TIME_GOOGLE_OAUTH_CLIENT_ID__: JSON.stringify(
              (process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.WR_DESK_GOOGLE_OAUTH_CLIENT_ID || '').trim(),
            ),
            __BUILD_TIME_GOOGLE_OAUTH_CLIENT_SECRET__: JSON.stringify(
              (process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.WR_DESK_GOOGLE_OAUTH_CLIENT_SECRET || '').trim(),
            ),
            // New ISO timestamp on each main-bundle compile — exposed via GET /api/health for extension parity checks.
            __ORCHESTRATOR_BUILD_STAMP__: JSON.stringify('build050'),
          },
          build: {
            rollupOptions: {
              // Only NATIVE MODULES should be externalized
              // All pure JS packages must be bundled to avoid runtime resolution
              // electron is externalized to use runtime import
              external: [
                'electron',           // Runtime: Electron APIs
                'bufferutil',         // Native: WebSocket optimization
                'utf-8-validate',     // Native: WebSocket validation
                'libsodium-wrappers', // Native: Crypto bindings
                '@journeyapps/sqlcipher', // Native: SQLite encryption
                'tesseract.js',       // Has worker files that need runtime resolution
                'canvas',             // Native: node-canvas
                'keytar',             // Native: OS keychain
                'better-sqlite3',     // Native: SQLite bindings
                'pg-native',          // Optional native dep of pg — external so pg can bundle (pg has JS fallback)
                // pg: BUNDLED — externalizing caused "Cannot find module pg-pool" in asar (pnpm layout)
              ],
              output: {
                // Use 'auto' interop for CommonJS modules like electron
                interop: 'auto',
                // Inject __dirname and __filename shims for CommonJS packages bundled in ESM
                intro: `
import { fileURLToPath as ___fileURLToPath } from 'url';
import { dirname as ___dirname } from 'path';
const __filename = ___fileURLToPath(import.meta.url);
const __dirname = ___dirname(__filename);
`
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
        vite: {
          build: {
            rollupOptions: {
              output: {
                // CommonJS format with .cjs extension works on ALL platforms:
                //  - Windows (sandbox:true):  require() ✔  import ✘  → CJS required
                //  - Linux   (sandbox:false): require() ✘  import ✔  BUT .cjs is
                //    always loaded as CommonJS by Node regardless of package.json "type"
                //    and Electron supports require() in .cjs preload even with sandbox:false.
                // Using .mjs (ESM) breaks Windows. Using .js (CJS) breaks when
                // package.json has "type":"module". .cjs is the universal solution.
                format: 'cjs',
                inlineDynamicImports: true,
                entryFileNames: '[name].cjs',
                chunkFileNames: '[name].cjs',
              },
            },
          },
        },
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
