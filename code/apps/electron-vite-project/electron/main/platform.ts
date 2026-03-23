/**
 * Platform detection for cross-platform Electron builds.
 * Single codebase runs on Linux and Windows without platform-specific build steps.
 * Use at runtime (process.platform) — not at build time.
 */
import path from 'node:path'
import { app } from 'electron'

export const isLinux = process.platform === 'linux'
export const isWindows = process.platform === 'win32'
export const isMac = process.platform === 'darwin'

/**
 * Resolve the path to the renderer index.html for loadFile().
 * Path resolution differs by platform when packaged (AppImage vs NSIS).
 * Windows: app.getAppPath() works correctly.
 * Linux: __dirname-relative path is more reliable — AppImage mount paths
 * can cause getAppPath()/resourcesPath to resolve incorrectly.
 */
export function getRendererIndexPath(
  __dirnameVal: string,
  rendererDist: string,
  isPackaged: boolean
): string {
  if (!isPackaged) {
    return path.join(rendererDist, 'index.html')
  }
  if (isLinux) {
    // Linux AppImage: use __dirname-relative path. Main process runs from
    // app.asar/dist-electron/, so ../dist/index.html resolves correctly.
    return path.join(__dirnameVal, '..', 'dist', 'index.html')
  }
  // Windows (and macOS): app.getAppPath() works correctly
  return path.join(app.getAppPath(), 'dist', 'index.html')
}
