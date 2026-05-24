/**
 * User-supplied Google OAuth client secret for the app's built-in Desktop client id.
 * Persisted under userData via Electron safeStorage (OS keychain/DPAPI) — never shipped in the app bundle.
 */

import * as fs from 'fs'
import * as path from 'path'

import { app } from 'electron'

import {
  decryptValue,
  encryptValue,
  isSecureStorageAvailable,
  SecureStorageUnavailableError,
} from './secure-storage'

const FILENAME = 'builtin-google-oauth-supplement.enc'

function supplementPath(): string {
  return path.join(app.getPath('userData'), FILENAME)
}

/** Same rejection rules as {@link normalizeGoogleOAuthClientSecret} without importing cycles. */
export function normalizeSupplementDesktopSecret(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  if (s.length < 10) return null
  const lower = s.toLowerCase()
  if (
    lower.includes('replace_with') ||
    lower.includes('your_secret') ||
    lower.includes('xxx') ||
    lower.includes('placeholder') ||
    lower.startsWith('unconfigured') ||
    lower.includes('__') ||
    lower.includes('paste_') ||
    lower === 'none'
  ) {
    return null
  }
  return s
}

export function loadBuiltinGoogleOAuthSupplementSecret(expectedClientId: string): string | undefined {
  const want = expectedClientId?.trim()
  if (!want) return undefined
  try {
    const p = supplementPath()
    if (!fs.existsSync(p)) return undefined
    const raw = fs.readFileSync(p, 'utf8')
    const outer = JSON.parse(raw) as Record<string, unknown>
    if (typeof outer._e !== 'string') return undefined
    const inner = JSON.parse(decryptValue(outer._e)) as { clientId?: string; clientSecret?: string }
    const cid = String(inner?.clientId ?? '').trim()
    if (!cid || cid !== want) return undefined
    const sec = normalizeSupplementDesktopSecret(inner?.clientSecret)
    return sec ?? undefined
  } catch {
    return undefined
  }
}

/** True only when decrypted payload matches {@link expectedClientId} and carries a usable secret (no value returned). */
export function hasBuiltinGoogleOAuthSupplementForClientId(expectedClientId: string): boolean {
  return !!loadBuiltinGoogleOAuthSupplementSecret(expectedClientId)
}

export type SaveBuiltinSupplementResult = { ok: true } | { ok: false; error: string }

/**
 * Persist secret for the app's built-in OAuth client id. Overwrites prior supplement for another client id.
 */
export function saveBuiltinGoogleOAuthSupplementSecret(
  bundledClientId: string,
  clientSecret: string,
): SaveBuiltinSupplementResult {
  const cid = bundledClientId?.trim()
  if (!cid) return { ok: false, error: 'Client id is required' }
  const sec = normalizeSupplementDesktopSecret(clientSecret)
  if (!sec) return { ok: false, error: 'Invalid or placeholder client secret' }
  try {
    if (!isSecureStorageAvailable()) {
      return {
        ok: false,
        error: new SecureStorageUnavailableError().message,
      }
    }
    const json = JSON.stringify({ clientId: cid, clientSecret: sec })
    const outer = JSON.stringify({ _e: encryptValue(json) })
    fs.writeFileSync(supplementPath(), outer, 'utf8')
    console.log(
      '[builtin_oauth_supplement] saved pairing for bundled client fingerprint (secret not logged)',
      { clientIdFingerprint: `${cid.slice(0, 12)}…${cid.slice(-8)}` },
    )
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[builtin_oauth_supplement] save failed:', msg)
    return { ok: false, error: msg }
  }
}

export function clearBuiltinGoogleOAuthSupplement(): void {
  try {
    const p = supplementPath()
    if (fs.existsSync(p)) {
      fs.unlinkSync(p)
      console.log('[builtin_oauth_supplement] cleared')
    }
  } catch (e) {
    console.warn('[builtin_oauth_supplement] clear failed:', e instanceof Error ? e.message : e)
  }
}
