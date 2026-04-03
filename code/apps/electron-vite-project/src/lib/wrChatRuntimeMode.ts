/**
 * Lightweight runtime context for WR Chat surfaces.
 * - Dashboard: set when `WRChatDashboardView` mounts (Electron renderer).
 * - Popup: extension `popup-chat.html` does not import this module (no `chrome.runtime.id` check in extension bundle).
 *
 * Remove this module by deleting imports and callers when the dashboard path is unified.
 */

export type WrChatRuntimeSurface = 'dashboard' | 'popup'

let surface: WrChatRuntimeSurface | null = null

export function setWrChatRuntimeSurface(next: WrChatRuntimeSurface | null): void {
  surface = next
}

export function getWrChatRuntimeSurface(): WrChatRuntimeSurface | null {
  return surface
}

export function isWrChatDashboardSurface(): boolean {
  return surface === 'dashboard'
}
