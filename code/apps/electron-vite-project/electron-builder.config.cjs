/**
 * Electron Builder config with cross-platform output paths.
 * Auto-detects the OS at build time:
 *   - Windows: C:\build-output\build200
 *   - Linux / macOS: dist/release (relative, avoids path errors)
 *
 * This file is the single source of truth for the output directory.
 * Never hard-code OS-specific paths in electron-builder.json.
 */

const baseConfig = require('./electron-builder.json')
const path = require('path')

function getOutputDir() {
  if (process.platform === 'win32') {
    return 'C:\\build-output\\build200'
  }
  // Linux and macOS: relative path avoids "path must not start with .." errors
  return path.join(__dirname, 'dist', 'release')
}

module.exports = {
  ...baseConfig,
  directories: {
    ...baseConfig.directories,
    output: getOutputDir(),
  },
  // Exclude the output dir itself from the packaged files to prevent nesting
  files: [
    'dist/**/*',
    '!dist/release{,/**/*}',
    'dist-electron/**/*',
    'package.json',
  ],
}
