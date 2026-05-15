import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = __dirname
const extSrc = path.resolve(root, '../extension-chromium/src')

/**
 * Single source of truth with `extension-chromium/vite.config.ts` `build.outDir`
 * (same regex as scripts/clear-build-caches.cjs). Avoids stale hardcoded stamps after `git pull`.
 */
function readExtensionOutDirStamp(): string {
  const extVite = path.join(root, '../extension-chromium/vite.config.ts')
  try {
    const src = fs.readFileSync(extVite, 'utf8')
    const m = src.match(/outDir:\s*['"]([^'"]+)['"]/)
    if (m?.[1]) return m[1]
  } catch {
    /* ignore */
  }
  return 'build0'
}
const ORCHESTRATOR_BUILD_STAMP = readExtensionOutDirStamp()

const oauthId =
  process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ||
  process.env.WR_DESK_GOOGLE_OAUTH_CLIENT_ID?.trim() ||
  ''
const oauthSecret =
  process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ||
  process.env.WR_DESK_GOOGLE_OAUTH_CLIENT_SECRET?.trim() ||
  ''

export default defineConfig({
  base: './',
  publicDir: 'public',
  resolve: {
    alias: [
      { find: /^@shared\/(.+)$/, replacement: path.resolve(root, '../../packages/shared/src/$1') },
      { find: '@repo/shared-beap-ui', replacement: path.resolve(root, '../../packages/shared-beap-ui/src/index.ts') },
      { find: '@ext/handshake/handshakeRpc', replacement: path.resolve(root, 'src/shims/handshakeRpc.ts') },
      { find: '@ext/vault/hsContextProfilesRpc', replacement: path.resolve(root, 'src/shims/hsContextProfilesRpc.ts') },
      { find: '@ext/reconstruction', replacement: path.resolve(root, 'src/shims/reconstruction.ts') },
      { find: '@ext/audit', replacement: path.resolve(root, 'src/shims/audit.ts') },
      { find: '@ext/envelope-evaluation', replacement: path.resolve(root, 'src/shims/envelope-evaluation.ts') },
      { find: '@ext/ingress', replacement: path.resolve(root, 'src/shims/ingress.ts') },
      { find: /^@ext\/(.+)$/, replacement: `${extSrc}/$1` },
    ],
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        onstart({ startup }) {
          // vite-plugin-electron: `startup` is a function; argv default is ['.', '--no-sandbox'].
          void startup(['.', '--no-sandbox', '--hidden'])
        },
        vite: {
          define: {
            __ORCHESTRATOR_BUILD_STAMP__: JSON.stringify(ORCHESTRATOR_BUILD_STAMP),
            __WRDESK_HOST_AI_P2P_BUNDLE_DEFAULTS_ON__: true,
            __BUILD_TIME_GOOGLE_OAUTH_CLIENT_ID__: JSON.stringify(oauthId),
            __BUILD_TIME_GOOGLE_OAUTH_CLIENT_SECRET__: JSON.stringify(oauthSecret),
          },
          plugins: [
            {
              name: 'externalize-ws-and-native-optional',
              enforce: 'pre',
              resolveId(id) {
                if (id === 'ws' || id === 'bufferutil' || id === 'utf-8-validate') {
                  return { id, external: true }
                }
              },
            },
            {
              // Compile the validator subprocess as a standalone CJS file so that
              // child_process.fork() can find it at dist-electron/validator-process/index.js.
              // The main Vite bundle cannot serve as the fork target because
              // import.meta.url in the bundle resolves to dist-electron/main-*.js,
              // not to the validator-process subdirectory.
              name: 'build-validator-subprocess',
              closeBundle: async () => {
                const { build } = await import('esbuild')
                const outFile = path.join(root, 'dist-electron', 'validator-process', 'index.js')
                await build({
                  entryPoints: [path.join(root, 'electron/main/validator-process/index.ts')],
                  outfile: outFile,
                  bundle: true,
                  platform: 'node',
                  format: 'cjs',
                  target: 'node20',
                  // Resolve @repo/ingestion-core from source — no pre-built dist required.
                  alias: {
                    '@repo/ingestion-core': path.resolve(root, '../../packages/ingestion-core/src/index.ts'),
                  },
                })
                console.log('[build-validator-subprocess] Emitted:', outFile)
              },
            },
          ],
          build: {
            // ws relies on dynamic prototype methods (Sender.mask / Receiver.mask).
            // Esbuild minification rewrites them to t.mask and the runtime crashes
            // with "t.mask is not a function" on every received frame, freezing
            // the coordination WebSocket. Disable minify on the main bundle.
            minify: false,
            rollupOptions: {
              external: [
                'canvas',
                /** Also listed here; `resolveId` above ensures Vite does not bundle `ws` (avoids broken optional peer stubs). */
                'ws',
                'bufferutil',
                'utf-8-validate',
                'better-sqlite3',
                'keytar',
                'tesseract.js',
                'pg',
                'pdfjs-dist',
                'pdfjs-dist/legacy/build/pdf.mjs',
                'node-fetch',
                'whatwg-url',
                'tr46',
                'webidl-conversions',
                /** CJS packages that use __dirname — must not be bundled into ESM main (ReferenceError at runtime) */
                'open',
                // Must be required at runtime, not bundled. Bundling+minifying ws
                // mangles its internal Sender.mask/Receiver.mask prototype methods.
                'ws',
                'bufferutil',
                'utf-8-validate',
              ],
            },
          },
        },
      },
      preload: {
        input: {
          'preload.cjs': path.join(root, 'electron/preload.ts'),
          'webrtc-transport.cjs': path.join(root, 'electron/preload/webrtcTransportPreload.ts'),
        },
        vite: {
          build: {
            rollupOptions: {
              output: {
                entryFileNames: '[name]',
                chunkFileNames: 'webrtc-tp-prel-chunk.cjs',
                /** Two preload entries: cannot use `inlineDynamicImports: true` (Rollup). */
                inlineDynamicImports: false,
              },
            },
          },
        },
      },
      renderer: {},
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: [path.join(root, 'index.html'), path.join(root, 'src/internal-inference-p2p-transport.html')],
      output: {
        /** Required for MPA: Rollup disallows `inlineDynamicImports: true` with multiple inputs. */
        inlineDynamicImports: false,
      },
    },
  },
})
