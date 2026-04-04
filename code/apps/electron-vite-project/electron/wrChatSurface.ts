// Canonical surface identity for WRChat — Electron-local copy.
// The extension-chromium package holds the source of truth for the UI side.
// This file must stay in sync manually; it exists here to avoid a
// cross-package import in electron/main.ts that breaks vite-plugin-electron
// dev mode (Rollup sub-pipeline does not share renderer resolve.alias).

export type WrChatSurface = 'sidepanel' | 'popup' | 'dashboard'

export const SOURCE_TO_SURFACE: Record<string, WrChatSurface> = {
  'sidepanel-docked-chat': 'sidepanel',
  'wr-chat-popup':         'popup',
  'wr-chat-dashboard':     'dashboard',
}

export function surfaceFromSource(source: string | undefined): WrChatSurface {
  return SOURCE_TO_SURFACE[(source ?? '').toLowerCase()] ?? 'sidepanel'
}
