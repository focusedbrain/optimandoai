/**
 * Initialize BEAP PQ auth headers provider.
 * Call from sidepanel/popup on mount so qBEAP can reach Electron PQ API (port 51248).
 */
import { setPqAuthHeadersProvider } from './services/beapCrypto'

export function initBeapPqAuth(): void {
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    setPqAuthHeadersProvider(async () => {
      try {
        const r = await chrome.runtime.sendMessage({ type: 'BEAP_GET_PQ_HEADERS' })
        return (r?.headers ?? {}) as Record<string, string>
      } catch {
        return {}
      }
    })
  }
}
