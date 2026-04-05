'use strict'

const path = require('path')
const fs = require('fs')

const appDir = __dirname

/**
 * Parsed by scripts/kill-wr-desk.cjs — must contain a line matching:
 *   return 'C:\\build-output\\build555'
 */
function windowsOutputDirMarker() {
  return 'C:\\build-output\\build555'
}

function tesseractCoreWasmPath() {
  const candidates = [
    path.join(appDir, 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js'),
    path.join(appDir, '../../node_modules/.pnpm/tesseract.js-core@5.1.1/node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

const extraResources = [
  { from: 'resources', to: '.', filter: ['**/*'] },
  {
    from: path.join(appDir, 'node_modules/tesseract.js/dist/worker.min.js'),
    to: 'tesseract-worker/worker.min.js',
  },
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
  extraResources,
  win: {
    target: ['nsis'],
    executableName: 'WR DeskT',
    signAndEditExecutable: false,
    signDlls: false,
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
}
