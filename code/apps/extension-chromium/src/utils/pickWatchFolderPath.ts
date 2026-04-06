/**
 * Resolves an absolute folder path for WR Chat diff watchers.
 * Prefers WR Desk / Electron native picker; returns null if unavailable or cancelled.
 */

import { getElectronPickDirectory } from './electronPickDirectory'

export async function pickWatchFolderPath(): Promise<string | null> {
  const fn = getElectronPickDirectory()
  if (typeof fn !== 'function') return null
  try {
    return await fn()
  } catch {
    return null
  }
}

export function hasNativeFolderPicker(): boolean {
  return typeof getElectronPickDirectory() === 'function'
}
