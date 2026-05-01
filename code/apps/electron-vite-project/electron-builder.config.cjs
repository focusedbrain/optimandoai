'use strict'

const path = require('path')
const fs = require('fs')

const appDir = __dirname

/**
 * Parsed by scripts/kill-wr-desk.cjs — must contain a line matching:
 *   return 'C:\\build-output\\build161'
 */
function windowsOutputDirMarker() {
  return 'C:\\build-output\\build161'
}

const workspaceRoot = path.resolve(appDir, '../..')

function findFile(candidates) {
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

function tesseractCoreWasmPath() {
  return findFile([
    path.join(appDir, 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js'),
    path.join(workspaceRoot, 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js'),
    path.join(workspaceRoot, 'node_modules/.pnpm/tesseract.js-core@5.1.1/node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js'),
  ])
}

// worker.min.js is the browser build — NOT used in Electron (Node worker_threads).
// tesseract.js resolves its own Node-compatible worker from the asarUnpacked package.
// Only the WASM core needs to be extracted as an extraResource.

/** Includes gitignored `google-oauth-client-id.txt` / `google-oauth-client-secret.txt` (filled by prepare-google-oauth-resource.cjs) outside asar. */
const extraResources = [
  { from: 'resources', to: '.', filter: ['**/*'] },
]

const wasm = tesseractCoreWasmPath()
if (wasm) {
  extraResources.push({
    from: wasm,
    to: 'tesseract-worker/tesseract-core-simd-lstm.wasm.js',
  })
}

const tesseractLang = path.join(appDir, 'tesseract-lang')
if (fs.existsSync(tesseractLang)) {
  extraResources.push({ from: 'tesseract-lang', to: 'tesseract-lang', filter: ['**/*'] })
}

module.exports = {
  /** pnpm hoists `electron` to the workspace root; electron-builder looks in app/node_modules first. */
  electronVersion: '30.5.1',
  appId: 'com.optimandoai.wrdesk',
  productName: 'WR Desk™',
  copyright: 'Copyright © Optimando AI',
  /** Avoid winCodeSign tool download/extract (fails on Windows without symlink privilege for darwin symlinks in the archive). */
  forceCodeSigning: false,
  directories: {
    output: process.platform === 'win32' ? windowsOutputDirMarker() : path.join(appDir, 'dist', 'release'),
    buildResources: 'build',
  },
  files: [
    'dist/**/*',
    '!dist/release/**',
    'dist-electron/**/*',
    'package.json',
    'node_modules/**/*',
  ],
  asarUnpack: [
    // pdfjs worker: file-URL load + Node fake-worker; unpacked avoids edge cases inside app.asar
    'node_modules/pdfjs-dist/**',
    'node_modules/pg/**',
    'node_modules/pg-*/**',
    'node_modules/pgpass/**',
    'node_modules/postgres-*/**',
    'node_modules/pg-int8/**',
    'node_modules/tesseract.js/**',
    'node_modules/tesseract.js-core/**',
    'node_modules/node-fetch/**',
    'node_modules/whatwg-url/**',
    'node_modules/tr46/**',
    'node_modules/webidl-conversions/**',
  ],
  extraResources,
  win: {
    /**
     * Use `dir` (unpacked) only as the default Windows artifact. It always fills
     * `win-unpacked` with `WRDeskT.exe` and Electron DLLs.
     * Do NOT add `portable` here: the follow-up NSIS/portable step can leave `win-unpacked`
     * incomplete on some machines (only locales/resources). For a one-file build run
     * `pnpm run build:portable` separately.
     */
    target: ['dir'],
    /** ASCII-only, no spaces — spaces in the .exe name have caused 0-byte or broken PE files on some Windows pack runs. */
    artifactName: 'WR-Desk-Setup-${version}.${ext}',
    executableName: 'WRDeskT',
    signAndEditExecutable: false,
    signDlls: false,
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
  /**
   * Host AI HTTP safety net: `p2pInferenceFlags.ts` defaults `WRDESK_P2P_INFERENCE_HTTP_FALLBACK`
   * and `WRDESK_P2P_INFERENCE_HTTP_INTERNAL_COMPAT` to **on** when unset (direct-LAN HTTP + compat;
   * WebRTC for cross-network; HTTP fallback catches transient DC failures).
   * Electron-builder cannot inject main-process env — for packaged installs that must pin behavior,
   * set explicitly at launch, e.g. `WRDESK_P2P_INFERENCE_HTTP_FALLBACK=1` and
   * `WRDESK_P2P_INFERENCE_HTTP_INTERNAL_COMPAT=1` (redundant with defaults but documents intent).
   * See `docs/HOST_AI_DIAGNOSTIC_LOGS.md`.
   */
}
