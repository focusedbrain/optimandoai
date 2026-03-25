/**
 * App-owned Gmail OAuth client id (public identifier — safe to ship).
 * The client secret is NOT used for the end-user PKCE flow.
 *
 * Precedence depends on context:
 *
 * **Standard Gmail Connect** (`builtin_public`) in **packaged production** (not email developer mode):
 * 1. google-oauth-client-id.txt in `process.resourcesPath` (bundled Desktop client)
 * 2. Build-time Vite inline constant
 * 3. Sidecar `google-oauth-client-id.txt` beside the executable  
 * Runtime `WR_DESK_GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_ID` are **not** applied (they caused wrong-client / `client_secret is missing` when set to a Web or stale id).  
 * Enable **`WR_DESK_EMAIL_DEVELOPER_MODE=1`** or **`WR_DESK_DEVELOPER_MODE=1`** to allow env overrides in packaged builds for testing.
 *
 * **Advanced / builtin fallback / unpackaged dev** — **packaged** with developer mode on, or unpackaged:
 * 1. WR_DESK_GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_ID
 * 2. google-oauth-client-id.txt in `process.resourcesPath` (packaged) — wins over stale Vite inline when env unset
 * 3. Build-time inlined constant
 * 4. Dev resource files or sidecar (see below)
 *
 * **Development** (unpackaged) when using the generic resolver:
 * 1. Runtime env (same keys as above)
 * 2. Build-time Vite inline (fast local iteration when env unset)
 * 3. resources/google-oauth-client-id.txt under `app.getAppPath()` and `process.cwd()`
 * 4. Sidecar file beside the executable
 *
 * Placeholder values in the bundled file (e.g. REPLACE_WITH_…) are rejected so CI must inject a real id.
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

const ENV_KEYS = ['WR_DESK_GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_ID'] as const

/** Injected by Vite for the main-process bundle (see vite.config.ts). */
declare const __BUILD_TIME_GOOGLE_OAUTH_CLIENT_ID__: string | undefined

const PACKAGED_RESOURCE_BASENAME = 'google-oauth-client-id.txt'

export type BuiltinOAuthClientSourceKind =
  | 'runtime_env_WR_DESK_GOOGLE_OAUTH_CLIENT_ID'
  | 'runtime_env_GOOGLE_OAUTH_CLIENT_ID'
  | 'build_time_vite_inline'
  | 'packaged_resource_file'
  | 'dev_resource_app_path'
  | 'dev_resource_cwd'
  | 'sidecar_exe_directory'

export interface BuiltinGoogleOAuthClientResolution {
  clientId: string
  sourceKind: BuiltinOAuthClientSourceKind
  /** Absolute path when sourced from a file; null for env / Vite inline */
  sourcePath: string | null
  /** Env var key or file basename for logs */
  sourceName: string
  /** Distinct from Advanced `developer_saved` vault credentials */
  isBuiltinAppOwned: true
  fromBuildTimeInline: boolean
  fromPackagedResourceFile: boolean
  /**
   * Names only: OAuth client id env vars that had any non-empty value but were not used for resolution
   * (packaged production standard Connect only).
   */
  packagedStandardConnectIgnoredEnvVarNames?: string[]
}

/** True when Standard Connect uses bundled resource before env (packaged app, email developer mode off). */
export function isPackagedProductionGmailStandardConnect(): boolean {
  try {
    return app.isPackaged && !isEmailDeveloperModeEnabled()
  } catch {
    return false
  }
}

/** Env var names (not values) that are set non-empty for Google OAuth client id. */
export function getGoogleOauthClientIdEnvVarNamesPresent(): string[] {
  return ENV_KEYS.filter((k) => (process.env[k] ?? '').trim().length > 0)
}

function attachIgnoredEnvNames(
  res: BuiltinGoogleOAuthClientResolution,
): BuiltinGoogleOAuthClientResolution {
  const names = getGoogleOauthClientIdEnvVarNamesPresent()
  if (names.length === 0) return res
  return { ...res, packagedStandardConnectIgnoredEnvVarNames: [...names] }
}

/** Packaged production Standard Connect: resource → build-time → sidecar; never env. */
function resolvePackagedStandardConnectNoEnvFirst(): BuiltinGoogleOAuthClientResolution | null {
  const fromPackaged = tryPackagedResourceFile()
  if (fromPackaged) return attachIgnoredEnvNames(fromPackaged)
  const fromBuild = resolutionFromBuildTime()
  if (fromBuild) return attachIgnoredEnvNames(fromBuild)
  const side = trySidecar()
  if (side) return attachIgnoredEnvNames(side)
  return null
}

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

function resolutionFromEnv(): BuiltinGoogleOAuthClientResolution | null {
  for (const k of ENV_KEYS) {
    const v = process.env[k]?.trim()
    const n = normalizeGoogleOAuthClientId(v)
    if (n) {
      const kind: BuiltinOAuthClientSourceKind =
        k === 'WR_DESK_GOOGLE_OAUTH_CLIENT_ID'
          ? 'runtime_env_WR_DESK_GOOGLE_OAUTH_CLIENT_ID'
          : 'runtime_env_GOOGLE_OAUTH_CLIENT_ID'
      return {
        clientId: n,
        sourceKind: kind,
        sourcePath: null,
        sourceName: k,
        isBuiltinAppOwned: true,
        fromBuildTimeInline: false,
        fromPackagedResourceFile: false,
      }
    }
  }
  return null
}

function resolutionFromBuildTime(): BuiltinGoogleOAuthClientResolution | null {
  const fromBuild = getBuildTimeGoogleOAuthClientId()
  if (!fromBuild) return null
  return {
    clientId: fromBuild,
    sourceKind: 'build_time_vite_inline',
    sourcePath: null,
    sourceName: '__BUILD_TIME_GOOGLE_OAUTH_CLIENT_ID__',
    isBuiltinAppOwned: true,
    fromBuildTimeInline: true,
    fromPackagedResourceFile: false,
  }
}

function tryPackagedResourceFile(): BuiltinGoogleOAuthClientResolution | null {
  try {
    if (!app.isPackaged) return null
    const inResources = path.join(process.resourcesPath || '', PACKAGED_RESOURCE_BASENAME)
    const fromResources = normalizeGoogleOAuthClientId(readFirstNonCommentLine(inResources))
    if (!fromResources) return null
    return {
      clientId: fromResources,
      sourceKind: 'packaged_resource_file',
      sourcePath: inResources,
      sourceName: PACKAGED_RESOURCE_BASENAME,
      isBuiltinAppOwned: true,
      fromBuildTimeInline: false,
      fromPackagedResourceFile: true,
    }
  } catch {
    return null
  }
}

function tryDevResourceFiles(): BuiltinGoogleOAuthClientResolution | null {
  try {
    if (app.isPackaged) return null
    const fromProject = path.join(app.getAppPath(), 'resources', PACKAGED_RESOURCE_BASENAME)
    const fromProjectLine = normalizeGoogleOAuthClientId(readFirstNonCommentLine(fromProject))
    if (fromProjectLine) {
      return {
        clientId: fromProjectLine,
        sourceKind: 'dev_resource_app_path',
        sourcePath: fromProject,
        sourceName: PACKAGED_RESOURCE_BASENAME,
        isBuiltinAppOwned: true,
        fromBuildTimeInline: false,
        fromPackagedResourceFile: false,
      }
    }
    const fromCwd = path.join(process.cwd(), 'resources', PACKAGED_RESOURCE_BASENAME)
    const fromCwdLine = normalizeGoogleOAuthClientId(readFirstNonCommentLine(fromCwd))
    if (fromCwdLine) {
      return {
        clientId: fromCwdLine,
        sourceKind: 'dev_resource_cwd',
        sourcePath: fromCwd,
        sourceName: PACKAGED_RESOURCE_BASENAME,
        isBuiltinAppOwned: true,
        fromBuildTimeInline: false,
        fromPackagedResourceFile: false,
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

function trySidecar(): BuiltinGoogleOAuthClientResolution | null {
  try {
    const beside = path.join(path.dirname(app.getPath('exe')), PACKAGED_RESOURCE_BASENAME)
    const line = normalizeGoogleOAuthClientId(readFirstNonCommentLine(beside))
    if (!line) return null
    return {
      clientId: line,
      sourceKind: 'sidecar_exe_directory',
      sourcePath: beside,
      sourceName: PACKAGED_RESOURCE_BASENAME,
      isBuiltinAppOwned: true,
      fromBuildTimeInline: false,
      fromPackagedResourceFile: false,
    }
  } catch {
    return null
  }
}

export type ResolveBuiltinGoogleOAuthOptions = {
  /**
   * Standard Gmail Connect: in packaged production, use bundled resource before env overrides.
   * Advanced / `developer_saved` builtin fallback should omit this (env allowed).
   */
  forStandardGmailConnect?: boolean
}

/**
 * Resolve built-in app-owned Google OAuth client id with explicit source metadata.
 */
export function resolveBuiltinGoogleOAuthClientWithMeta(
  options?: ResolveBuiltinGoogleOAuthOptions,
): BuiltinGoogleOAuthClientResolution | null {
  const standardPackagedProduction =
    options?.forStandardGmailConnect === true && isPackagedProductionGmailStandardConnect()

  if (standardPackagedProduction) {
    return resolvePackagedStandardConnectNoEnvFirst()
  }

  const fromEnv = resolutionFromEnv()
  if (fromEnv) return fromEnv

  if (app.isPackaged) {
    const fromPackaged = tryPackagedResourceFile()
    if (fromPackaged) return fromPackaged
    const fromBuild = resolutionFromBuildTime()
    if (fromBuild) return fromBuild
    return trySidecar()
  }

  const fromBuildDev = resolutionFromBuildTime()
  if (fromBuildDev) return fromBuildDev
  const fromDevFiles = tryDevResourceFiles()
  if (fromDevFiles) return fromDevFiles
  return trySidecar()
}

export function getBuiltinGmailOAuthClientId(): string | null {
  const useStandardPackaged =
    isPackagedProductionGmailStandardConnect()
  return resolveBuiltinGoogleOAuthClientWithMeta(
    useStandardPackaged ? { forStandardGmailConnect: true } : undefined,
  )?.clientId ?? null
}

/** True when a non-placeholder built-in client id is available for end-user PKCE connect. */
export function isBuiltinGmailOAuthConfigured(): boolean {
  return !!getBuiltinGmailOAuthClientId()
}

/**
 * Client id read only from packaged `process.resourcesPath/google-oauth-client-id.txt` (startup / sanity checks).
 */
export function getPackagedResourceGoogleOAuthClientId(): string | null {
  try {
    if (!app.isPackaged) return null
    const inResources = path.join(process.resourcesPath || '', PACKAGED_RESOURCE_BASENAME)
    return normalizeGoogleOAuthClientId(readFirstNonCommentLine(inResources))
  } catch {
    return null
  }
}

/**
 * Standard Connect (`builtin_public`) only: if the running app is packaged and the client id did **not** come
 * from an explicit env override, require it to match the shipped resource file so a stale Vite-inlined Web
 * client cannot silently win after a repackage that updated only the resource file.
 *
 * Skips when env set ops override, unpackaged dev, or resource file missing / invalid.
 */
export function assertBuiltinPublicClientMatchesShippedResource(
  resolution: BuiltinGoogleOAuthClientResolution,
): void {
  if (!app.isPackaged) return
  if (
    resolution.sourceKind === 'runtime_env_WR_DESK_GOOGLE_OAUTH_CLIENT_ID' ||
    resolution.sourceKind === 'runtime_env_GOOGLE_OAUTH_CLIENT_ID'
  ) {
    return
  }
  const shipped = getPackagedResourceGoogleOAuthClientId()
  if (!shipped) return
  if (normalizeGoogleOAuthClientId(resolution.clientId) !== shipped) {
    throw new Error(
      'Builtin Gmail OAuth mismatch: runtime client_id does not match expected built-in Desktop client (shipped resource). ' +
        `Expected fingerprint ${oauthClientIdFingerprint(shipped)}, actual ${oauthClientIdFingerprint(resolution.clientId)}.`,
    )
  }
}

/**
 * Safe fingerprint for logs: first 12 + last 8 chars of a Google OAuth client id.
 * Never pass refresh tokens or auth codes here.
 */
export function oauthClientIdFingerprint(clientId: string | null | undefined): string {
  if (clientId == null || typeof clientId !== 'string') return '(none)'
  const t = clientId.trim()
  if (!t) return '(empty)'
  if (t.length <= 20) return `${t.slice(0, 6)}…(${t.length}ch)`
  return `${t.slice(0, 12)}…${t.slice(-8)}`
}

const OAUTH_DIAG_WHITELIST_KEYS = new Set([
  'hasCodeVerifier',
  'hasClientSecret',
  'error_description',
  'redirect_uri',
  'clientIdFingerprintAtExchange',
  'tokenExchangeShape',
  'httpStatus',
  'builtinSourceKind',
  'builtinSourceName',
  'builtinSourcePathBasename',
  'builtinFromBuildTimeInline',
  'builtinFromPackagedResourceFile',
  'packagedResourceFingerprint',
  'winningBuiltinSourceKind',
  'winningClientIdFingerprint',
  'gmailOAuthCredentialSource',
  'packagedProductionStandardConnect',
  'googleOauthEnvVarsPresent',
  'packagedStandardConnectIgnoredEnvVarNames',
  'packagedStandardConnectResourcePrecedenceEnforced',
])

/** Structured OAuth diagnostics — never log tokens, secrets, auth codes, or full client ids. */
export function logOAuthDiagnostic(event: string, payload: Record<string, unknown>): void {
  const safe: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(payload)) {
    if (!OAUTH_DIAG_WHITELIST_KEYS.has(k) && /secret|token|password|refresh/i.test(k)) continue
    if (k === 'code' && typeof v === 'string') continue
    if ((k === 'clientId' || k === 'oauthClientId') && typeof v === 'string') {
      safe[k] = oauthClientIdFingerprint(v)
      continue
    }
    safe[k] = v
  }
  console.log(`[oauth_diag] ${event}`, JSON.stringify(safe))
}
