import type { SessionUserInfo } from './session'

let cachedUserInfo: SessionUserInfo | null = null

/** RAM-only user profile mirror — safe to import from renderer (no keytar / tokenStore). */
export function getCachedUserInfo(): SessionUserInfo | null {
  return cachedUserInfo
}

/** @internal */
export function setCachedUserInfo(info: SessionUserInfo | null): void {
  cachedUserInfo = info
}
