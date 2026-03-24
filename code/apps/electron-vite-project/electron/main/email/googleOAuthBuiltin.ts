/**
 * App-owned Gmail OAuth client id (public identifier — safe to ship).
 * The client secret is NOT used for the end-user PKCE flow.
 *
 * Single source of truth (first match wins):
 * 1. WR_DESK_GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_ID (runtime env, main process)
 * 2. Build-time: GOOGLE_OAUTH_CLIENT_ID / WR_DESK_GOOGLE_OAUTH_CLIENT_ID at `vite build` (inlined)
 * 3. resources/google-oauth-client-id.txt (packaged: extraResources → process.resourcesPath; dev: app.getAppPath()/resources)
 * 4. google-oauth-client-id.txt beside the executable (portable / sidecar)
 *
 * Placeholder values in the bundled file (e.g. REPLACE_WITH_…) are rejected so CI must inject a real id.
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

const ENV_KEYS = ['WR_DESK_GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_ID'] as const

/** Injected by Vite for the main-process bundle (see vite.config.ts). */
declare const __BUILD_TIME_GOOGLE_OAUTH_CLIENT_ID__: string | undefined

function readFirstNonCommentLine(p: string): string | null {
  try {
    if (!fs.existsSync(p)) return null
    const text = fs.readFileSync(p, 'utf8')
    const lines = text.split(/\r?\n/)
    for (const line of lines) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      return t
    }
    return null
  } catch {
    return null
  }
}

/** Google OAuth client ids end with this suffix (public client). */
const SUFFIX = '.apps.googleusercontent.com'

/**
 * Returns null if the value is missing, malformed, or a known placeholder / template.
 */
export function normalizeGoogleOAuthClientId(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const id = String(raw).trim()
  if (!id) return null
  const lower = id.toLowerCase()
  if (
    lower.includes('replace_with') ||
    lower.includes('your_client') ||
    lower.includes('xxx') ||
    lower.includes('placeholder') ||
    lower.startsWith('unconfigured') ||
    lower.includes('__') ||
    lower.includes('paste_') ||
    lower === 'none'
  ) {
    return null
  }
  if (!id.endsWith(SUFFIX)) return null
  return id
}

export function isPlaceholderGoogleOAuthClientId(raw: string | null | undefined): boolean {
  return normalizeGoogleOAuthClientId(raw) == null && String(raw ?? '').trim().length > 0
}

export function getBuildTimeGoogleOAuthClientId(): string | null {
  try {
    if (typeof __BUILD_TIME_GOOGLE_OAUTH_CLIENT_ID__ === 'undefined') return null
    return normalizeGoogleOAuthClientId(__BUILD_TIME_GOOGLE_OAUTH_CLIENT_ID__)
  } catch {
    return null
  }
}

/**
 * True when Advanced Gmail OAuth (custom client id/secret) should be exposed in the UI.
 * Packaged production builds hide it unless WR_DESK_EMAIL_DEVELOPER_MODE=1 (or WR_DESK_DEVELOPER_MODE=1).
 * Unpackaged dev always allows Advanced so engineers can test self-hosted OAuth.
 */
export function isEmailDeveloperModeEnabled(): boolean {
  const e = process.env.WR_DESK_EMAIL_DEVELOPER_MODE ?? process.env.WR_DESK_DEVELOPER_MODE
  if (e === '1' || String(e).toLowerCase() === 'true') return true
  try {
    return !app.isPackaged
  } catch {
    return false
  }
}

export function getBuiltinGmailOAuthClientId(): string | null {
  for (const k of ENV_KEYS) {
    const v = process.env[k]?.trim()
    const n = normalizeGoogleOAuthClientId(v)
    if (n) return n
  }

  const fromBuild = getBuildTimeGoogleOAuthClientId()
  if (fromBuild) return fromBuild

  try {
    if (app.isPackaged) {
      const inResources = path.join(process.resourcesPath || '', 'google-oauth-client-id.txt')
      const fromResources = normalizeGoogleOAuthClientId(readFirstNonCommentLine(inResources))
      if (fromResources) return fromResources
    } else {
      const fromProject = path.join(app.getAppPath(), 'resources', 'google-oauth-client-id.txt')
      const fromProjectLine = normalizeGoogleOAuthClientId(readFirstNonCommentLine(fromProject))
      if (fromProjectLine) return fromProjectLine
      const fromCwd = path.join(process.cwd(), 'resources', 'google-oauth-client-id.txt')
      const fromCwdLine = normalizeGoogleOAuthClientId(readFirstNonCommentLine(fromCwd))
      if (fromCwdLine) return fromCwdLine
    }
  } catch {
    /* ignore */
  }

  try {
    const beside = path.join(path.dirname(app.getPath('exe')), 'google-oauth-client-id.txt')
    return normalizeGoogleOAuthClientId(readFirstNonCommentLine(beside))
  } catch {
    return null
  }
}

/** True when a non-placeholder built-in client id is available for end-user PKCE connect. */
export function isBuiltinGmailOAuthConfigured(): boolean {
  return !!getBuiltinGmailOAuthClientId()
}

/** Structured OAuth diagnostics — never log tokens or secrets. */
export function logOAuthDiagnostic(event: string, payload: Record<string, unknown>): void {
  const safe = { ...payload }
  for (const k of Object.keys(safe)) {
    if (/secret|token|password|refresh/i.test(k)) delete safe[k]
  }
  console.log(`[oauth_diag] ${event}`, JSON.stringify(safe))
}
