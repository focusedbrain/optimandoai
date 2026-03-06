/**
 * Electron Builder config with platform-specific output paths.
 * - Windows: C:\build-output\build32 (CI/build machine)
 * - Linux/macOS: dist/release (relative, avoids path errors)
 */

const baseConfig = require('./electron-builder.json')
const path = require('path')

function getOutputDir() {
  if (process.platform === 'win32') {
    return 'C:\\build-output\\build32'
  }
  // Linux and macOS: use relative path to avoid "path must not start with .." errors
  return path.join(__dirname, 'dist', 'release')
}

module.exports = {
  ...baseConfig,
  directories: {
    ...baseConfig.directories,
    output: getOutputDir(),
  },
}
