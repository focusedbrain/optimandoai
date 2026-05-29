/**
 * Cached WSL diagnosis for Windows status UI (English copy derived separately).
 * Full WSL shell-out is expensive — run once at startup / user action, not on every probe tick.
 */

import { diagnoseWslState, type WslDiagnosis } from './wslProbe.js'

export type WslCacheRefreshReason = 'startup' | 'user_setup' | 'post_remediation' | 'manual'

export interface RefreshWslStatusCacheOptions {
  /** When false (default), return cached diagnosis without re-shelling wsl.exe. */
  force?: boolean
  reason?: WslCacheRefreshReason
}

let _cached: WslDiagnosis | null = null
let _refreshPromise: Promise<WslDiagnosis | null> | null = null

export function getWslStatusCache(): WslDiagnosis | null {
  return _cached
}

export function hasWslStatusCache(): boolean {
  return _cached != null
}

export function invalidateWslStatusCache(): void {
  _cached = null
}

export async function refreshWslStatusCache(
  options?: RefreshWslStatusCacheOptions,
): Promise<WslDiagnosis | null> {
  if (process.platform !== 'win32') {
    _cached = null
    return null
  }

  if (!options?.force && _cached != null) {
    return _cached
  }

  if (_refreshPromise) return _refreshPromise

  const reason = options?.reason ?? (options?.force ? 'manual' : 'startup')
  _refreshPromise = diagnoseWslState(reason)
    .then((diagnosis) => {
      _cached = diagnosis
      return diagnosis
    })
    .finally(() => {
      _refreshPromise = null
    })

  return _refreshPromise
}

/** Startup / first modal paint — at most one WSL diagnosis until user action. */
export async function ensureWslStatusCachedOnce(): Promise<WslDiagnosis | null> {
  return refreshWslStatusCache({ force: false, reason: 'startup' })
}

export function clearWslStatusCacheForTest(): void {
  _cached = null
  _refreshPromise = null
}
