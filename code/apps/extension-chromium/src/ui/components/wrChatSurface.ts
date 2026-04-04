// SOURCE OF TRUTH for WrChatSurface constants.
// A LOCAL COPY exists at:
//   code/apps/electron-vite-project/electron/wrChatSurface.ts
// If you change SOURCE_TO_SURFACE or WrChatSurface here, update that file too.
// DO NOT import this file from electron/main.ts — it crosses a package boundary.

/**
 * Canonical WR Chat surface identity — shared by extension UI and Electron main (LmGTFY).
 */

export type WrChatSurface = 'sidepanel' | 'popup' | 'dashboard'

/** Maps `WrChatCaptureButton` / `startWrChatScreenCapture` `source` strings to a surface. */
export const SOURCE_TO_SURFACE: Record<string, WrChatSurface> = {
  'sidepanel-docked-chat': 'sidepanel',
  'wr-chat-popup': 'popup',
  'wr-chat-dashboard': 'dashboard',
}

export function surfaceFromSource(source: string | undefined): WrChatSurface {
  return SOURCE_TO_SURFACE[(source ?? '').toLowerCase()] ?? 'sidepanel'
}

/** `promptContext` / IPC payload field — one string per surface (single source of truth). */
export function promptContextForSurface(s: WrChatSurface): string {
  return s
}
