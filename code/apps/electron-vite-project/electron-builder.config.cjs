/**
 * Electron Builder config with cross-platform output paths.
 * Auto-detects the OS at build time:
 *   - Windows: C:\\build-output\\build011
 *   - Linux / macOS: dist/release (relative, avoids path errors)
 *
 * This file is the single source of truth for the output directory.
 * Never hard-code OS-specific paths in electron-builder.json.
 */

const baseConfig = require('./electron-builder.json')
const path = require('path')
const fs = require('fs')

function getOutputDir() {
  if (process.platform === 'win32') {
    return 'C:\\\\build-output\\\\build009'
  }
  // Linux and macOS: relative path avoids "path must not start with .." errors
  return path.join(__dirname, 'dist', 'release')
}

// ── Tesseract extra resources ──────────────────────────────────────────────
// In a packaged Electron app, node_modules lives inside the ASAR archive and
// Node's worker_threads cannot spawn a worker from within it. We copy:
//   • worker.min.js  — the Tesseract.js worker script
//   • tesseract-core-simd-lstm.wasm.js — the WASM inference engine
// to resources/tesseract-worker/ so ocr-service.ts can reference them at
// process.resourcesPath when app.isPackaged is true.
//
// Language data (eng.traineddata) is bundled only when the file is present at
// apps/electron-vite-project/tesseract-lang/eng.traineddata (~12 MB).
// Without it the worker falls back to the projectnaptha CDN at runtime.
// To download: see tesseract-lang/README.md
const tesseractResources = [
  {
    from: 'node_modules/tesseract.js/dist/worker.min.js',
    to: 'tesseract-worker/worker.min.js',
  },
  // The .wasm.js file is a JS loader that requires the actual .wasm binary to
  // be in the same directory. Both files must be present together.
  {
    from: 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
    to: 'tesseract-worker/tesseract-core-simd-lstm.wasm.js',
  },
  {
    from: 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm',
    to: 'tesseract-worker/tesseract-core-simd-lstm.wasm',
  },
]

const localEngTraineddata = path.join(__dirname, 'tesseract-lang', 'eng.traineddata')
if (fs.existsSync(localEngTraineddata)) {
  tesseractResources.push({
    from: 'tesseract-lang/eng.traineddata',
    to: 'tesseract-lang/eng.traineddata',
  })
  console.log('[builder] Bundling tesseract-lang/eng.traineddata')
} else {
  console.log('[builder] tesseract-lang/eng.traineddata not found — OCR will use CDN at runtime')
}

module.exports = {
  ...baseConfig,
  directories: {
    ...baseConfig.directories,
    output: getOutputDir(),
  },
  // Unpack pg and sub-packages — asar path resolution fails for pg's dynamic requires
  // Unpack tesseract.js and node-fetch — tesseract uses node-fetch which requires whatwg-url;
  // with pnpm isolated layout, transitive deps live in .pnpm; unpacking ensures runtime resolution.
  asarUnpack: [
    ...(baseConfig.asarUnpack || []),
    'node_modules/pg/**',
    'node_modules/pg-*/**',
    'node_modules/pgpass/**',
    'node_modules/postgres-*/**',
    'node_modules/pg-int8/**',
    'node_modules/tesseract.js/**',
    'node_modules/node-fetch/**',
    'node_modules/whatwg-url/**',
    'node_modules/tr46/**',
    'node_modules/webidl-conversions/**',
  ],
  // Exclude the output dir itself from the packaged files to prevent nesting.
  // Include node_modules so pg and other runtime deps are bundled (files overrides default).
  // Transitive deps (whatwg-url for node-fetch) are copied by scripts/copy-pnpm-transitive-deps.cjs
  // before build — electron-builder rejects "from" paths with "..".
  files: [
    'dist/**/*',
    '!dist/release{,/**/*}',
    'dist-electron/**/*',
    'package.json',
    'node_modules/**/*',
  ],
  extraResources: [
    ...baseConfig.extraResources,
    ...tesseractResources,
    /** Gmail end-user OAuth: Desktop client id + secret (PKCE + Google-required secret). CI via prepare-google-oauth-resource.cjs */
    {
      from: 'resources/google-oauth-client-id.txt',
      to: 'google-oauth-client-id.txt',
    },
    {
      from: 'resources/google-oauth-client-secret.txt',
      to: 'google-oauth-client-secret.txt',
    },
  ],
}
