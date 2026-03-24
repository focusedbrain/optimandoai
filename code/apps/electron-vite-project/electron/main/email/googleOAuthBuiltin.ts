/**
 * App-owned Gmail OAuth client id (public identifier — safe to ship).
 * The client secret is NOT used for the end-user PKCE flow.
 *
 * Resolution order:
 * 1. WR_DESK_GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_ID (env, main process)
 * 2. resources/google-oauth-client-id.txt next to the packaged app (first line)
 * 3. google-oauth-client-id.txt beside the executable (Windows dev / portable)
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

const ENV_KEYS = ['WR_DESK_GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_ID'] as const

function readFirstLine(p: string): string | null {
  try {
    if (!fs.existsSync(p)) return null
    const line = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/)[0]?.trim()
    return line || null
  } catch {
    return null
  }
}

export function getBuiltinGmailOAuthClientId(): string | null {
  for (const k of ENV_KEYS) {
    const v = process.env[k]?.trim()
    if (v) return v
  }
  try {
    const inResources = path.join(process.resourcesPath || '', 'google-oauth-client-id.txt')
    const fromResources = readFirstLine(inResources)
    if (fromResources) return fromResources
  } catch {
    /* ignore */
  }
  try {
    const beside = path.join(path.dirname(app.getPath('exe')), 'google-oauth-client-id.txt')
    return readFirstLine(beside)
  } catch {
    return null
  }
}

/** Structured OAuth diagnostics — never log tokens or secrets. */
export function logOAuthDiagnostic(event: string, payload: Record<string, unknown>): void {
  const safe = { ...payload }
  for (const k of Object.keys(safe)) {
    if (/secret|token|password|refresh/i.test(k)) delete safe[k]
  }
  console.log(`[oauth_diag] ${event}`, JSON.stringify(safe))
}
