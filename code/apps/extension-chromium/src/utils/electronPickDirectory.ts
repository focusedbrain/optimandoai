/**
 * Folder picker from Electron preload (WR Desk / embedded dashboard).
 */

export function getElectronPickDirectory(): (() => Promise<string | null>) | undefined {
  if (typeof window === 'undefined') return undefined
  const w = window as Window & {
    electronAPI?: { pickDirectory?: () => Promise<string | null> }
    wrChat?: { pickDirectory?: () => Promise<string | null> }
  }
  return w.electronAPI?.pickDirectory ?? w.wrChat?.pickDirectory
}
