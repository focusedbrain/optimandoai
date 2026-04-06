import type { BrowserWindow } from 'electron'

let getWindow: (() => BrowserWindow | null) | null = null

// ── Called once from main.ts after `win` is created ────────────────────────────
export function registerMainWindowAccessor(fn: () => BrowserWindow | null): void {
  getWindow = fn
}

export function getMainBrowserWindow(): BrowserWindow | null {
  try {
    return getWindow?.() ?? null
  } catch {
    return null
  }
}
