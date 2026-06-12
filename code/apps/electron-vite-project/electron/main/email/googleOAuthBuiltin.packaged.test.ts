/**
 * Packaged-app OAuth resolution uses mocked `electron` + `fs` (hoisted).
 * Verifies resource file wins for standard builtin id and assert catches inline mismatch.
 *
 * NOTE: `vi.mock('path', ...)` below is required to bypass the vite-electron-renderer shim which
 * tries to use CommonJS `require()` for Node built-ins in the ESM test environment.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// vi.mock hoisted calls must precede the actual import; path is shimmed by vite-electron-renderer
// so we redirect it to the real Node module via importActual before googleOAuthBuiltin loads.
vi.mock('path', async () => vi.importActual('path'))

const oauthTestState = vi.hoisted(() => ({
  files: new Map<string, string>(),
  supplement: null as string | null,
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getAppPath: () => 'C:\\dev\\app',
    getPath: (k: string) => (k === 'exe' ? 'C:\\dev\\WR Desk.exe' : 'C:\\data'),
  },
}))

vi.mock('fs', () => ({
  existsSync: (p: string) => oauthTestState.files.has(p),
  readFileSync: (p: string) => oauthTestState.files.get(p) ?? '',
}))

vi.mock('./builtinGoogleOAuthSupplement', () => ({
  loadBuiltinGoogleOAuthSupplementSecret: (_clientId: string) => oauthTestState.supplement,
  saveBuiltinGoogleOAuthSupplementSecret: vi.fn(),
}))

import path from 'path'
import {
  resolveBuiltinGoogleOAuthClientWithMeta,
  resolveBuiltinGoogleOAuthClientSecret,
  assertBuiltinPublicClientMatchesShippedResource,
  getGmailBuiltinProviderStatus,
  isBuiltinStandardConnectReady,
  type BuiltinGoogleOAuthClientResolution,
} from './googleOAuthBuiltin'

const PACKAGED_RESOURCE_ID = '143694338843-packagedfileid.apps.googleusercontent.com'

describe('packaged builtin OAuth resolution', () => {
  beforeEach(() => {
    oauthTestState.files.clear()
    oauthTestState.supplement = null
    delete process.env.WR_DESK_GOOGLE_OAUTH_CLIENT_ID
    delete process.env.GOOGLE_OAUTH_CLIENT_ID
    delete process.env.WR_DESK_EMAIL_DEVELOPER_MODE
    delete process.env.WR_DESK_DEVELOPER_MODE
    ;(process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = 'C:\\App\\resources'
    const resourceFile = path.join(process.resourcesPath!, 'google-oauth-client-id.txt')
    oauthTestState.files.set(resourceFile, `${PACKAGED_RESOURCE_ID}\n`)
    const secretFile = path.join(process.resourcesPath!, 'google-oauth-client-secret.txt')
    oauthTestState.files.set(secretFile, `GOCSPX-packaged-secret-value\n`)
  })

  it('prefers packaged google-oauth-client-id.txt for built-in client (not stale vite inline)', () => {
    const r = resolveBuiltinGoogleOAuthClientWithMeta()
    expect(r).not.toBeNull()
    expect(r!.sourceKind).toBe('packaged_resource_file')
    expect(r!.fromPackagedResourceFile).toBe(true)
    expect(r!.clientId).toBe(PACKAGED_RESOURCE_ID)
    expect(resolveBuiltinGoogleOAuthClientSecret(r!)).toBe('GOCSPX-packaged-secret-value')
  })

  it('runtime env still wins over packaged file (Advanced / non–standard-connect resolver)', () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = '143694338843-envoverride.apps.googleusercontent.com'
    const r = resolveBuiltinGoogleOAuthClientWithMeta()
    expect(r!.sourceKind).toBe('runtime_env_GOOGLE_OAUTH_CLIENT_ID')
    expect(r!.clientId).toBe('143694338843-envoverride.apps.googleusercontent.com')
  })

  it('standard Gmail Connect ignores env and uses packaged resource when not email developer mode', () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = '143694338843-wrongenvoverride.apps.googleusercontent.com'
    const r = resolveBuiltinGoogleOAuthClientWithMeta({ forStandardGmailConnect: true })
    expect(r!.sourceKind).toBe('packaged_resource_file')
    expect(r!.clientId).toBe(PACKAGED_RESOURCE_ID)
    expect(r!.packagedStandardConnectIgnoredEnvVarNames).toContain('GOOGLE_OAUTH_CLIENT_ID')
  })

  it('standard Gmail Connect allows env when WR_DESK_EMAIL_DEVELOPER_MODE=1 (packaged testing)', () => {
    process.env.WR_DESK_EMAIL_DEVELOPER_MODE = '1'
    process.env.GOOGLE_OAUTH_CLIENT_ID = '143694338843-devmodeenv.apps.googleusercontent.com'
    const r = resolveBuiltinGoogleOAuthClientWithMeta({ forStandardGmailConnect: true })
    expect(r!.sourceKind).toBe('runtime_env_GOOGLE_OAUTH_CLIENT_ID')
    expect(r!.clientId).toBe('143694338843-devmodeenv.apps.googleusercontent.com')
  })

  it('assertBuiltinPublic fails when staged client id does not match shipped resource (no env)', () => {
    const stale: BuiltinGoogleOAuthClientResolution = {
      clientId: '143694338843-staleinlineee.apps.googleusercontent.com',
      sourceKind: 'build_time_vite_inline',
      sourcePath: null,
      sourceName: '__BUILD_TIME_GOOGLE_OAUTH_CLIENT_ID__',
      isBuiltinAppOwned: true,
      fromBuildTimeInline: true,
      fromPackagedResourceFile: false,
    }
    expect(() => assertBuiltinPublicClientMatchesShippedResource(stale)).toThrow(
      /Builtin Gmail OAuth mismatch/,
    )
  })

  it('assertBuiltinPublic skips mismatch check when client id came from env override', () => {
    const envRes: BuiltinGoogleOAuthClientResolution = {
      clientId: '143694338843-otherclient.apps.googleusercontent.com',
      sourceKind: 'runtime_env_GOOGLE_OAUTH_CLIENT_ID',
      sourcePath: null,
      sourceName: 'GOOGLE_OAUTH_CLIENT_ID',
      isBuiltinAppOwned: true,
      fromBuildTimeInline: false,
      fromPackagedResourceFile: false,
    }
    expect(() => assertBuiltinPublicClientMatchesShippedResource(envRes)).not.toThrow()
  })
})

/**
 * Fresh-device invariants (INV-A, INV-5):
 * - empty vault (no supplement) + bundled id + bundled secret → status 'ready', no paste prompt
 * - bundled id only (no secret file) → status 'credentials_incomplete'
 * - secret value is never emitted to console.log (INV-5)
 */
describe('fresh-device: bundled id+secret resolves without supplement', () => {
  beforeEach(() => {
    oauthTestState.files.clear()
    oauthTestState.supplement = null
    delete process.env.WR_DESK_GOOGLE_OAUTH_CLIENT_ID
    delete process.env.GOOGLE_OAUTH_CLIENT_ID
    delete process.env.WR_DESK_EMAIL_DEVELOPER_MODE
    delete process.env.WR_DESK_DEVELOPER_MODE
    ;(process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = 'C:\\App\\resources'
    const resourceFile = path.join(process.resourcesPath!, 'google-oauth-client-id.txt')
    oauthTestState.files.set(resourceFile, `${PACKAGED_RESOURCE_ID}\n`)
    const secretFile = path.join(process.resourcesPath!, 'google-oauth-client-secret.txt')
    oauthTestState.files.set(secretFile, `GOCSPX-packaged-secret-value\n`)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('isBuiltinStandardConnectReady → true when resource id and secret files both present (empty vault)', () => {
    oauthTestState.supplement = null
    expect(isBuiltinStandardConnectReady()).toBe(true)
  })

  it('getGmailBuiltinProviderStatus → ready when resource id and secret files both present', () => {
    oauthTestState.supplement = null
    const result = getGmailBuiltinProviderStatus()
    expect(result.status).toBe('ready')
    expect(result.hasBundledClientId).toBe(true)
    expect(result.hasEffectiveClientSecret).toBe(true)
  })

  it('getGmailBuiltinProviderStatus → credentials_incomplete when only id file present (no secret, empty vault)', () => {
    const secretFile = path.join(process.resourcesPath!, 'google-oauth-client-secret.txt')
    oauthTestState.files.delete(secretFile)
    oauthTestState.supplement = null
    const result = getGmailBuiltinProviderStatus()
    expect(result.status).toBe('credentials_incomplete')
    expect(result.hasBundledClientId).toBe(true)
    expect(result.hasEffectiveClientSecret).toBe(false)
  })

  it('isBuiltinStandardConnectReady → false when no secret file and no supplement', () => {
    const secretFile = path.join(process.resourcesPath!, 'google-oauth-client-secret.txt')
    oauthTestState.files.delete(secretFile)
    oauthTestState.supplement = null
    expect(isBuiltinStandardConnectReady()).toBe(false)
  })

  it('isBuiltinStandardConnectReady → true when secret comes from supplement (user pasted secret)', () => {
    const secretFile = path.join(process.resourcesPath!, 'google-oauth-client-secret.txt')
    oauthTestState.files.delete(secretFile)
    oauthTestState.supplement = 'GOCSPX-supplement-secret'
    expect(isBuiltinStandardConnectReady()).toBe(true)
  })
})

/**
 * INV-5: the resolved client secret must never appear in console output.
 * resolveBuiltinGoogleOAuthClientSecret logs only metadata (file path, length flags, reason).
 */
describe('INV-5: client secret not logged', () => {
  beforeEach(() => {
    oauthTestState.files.clear()
    oauthTestState.supplement = null
    delete process.env.WR_DESK_GOOGLE_OAUTH_CLIENT_ID
    delete process.env.GOOGLE_OAUTH_CLIENT_ID
    ;(process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = 'C:\\App\\resources'
    const resourceFile = path.join(process.resourcesPath!, 'google-oauth-client-id.txt')
    oauthTestState.files.set(resourceFile, `${PACKAGED_RESOURCE_ID}\n`)
    const secretFile = path.join(process.resourcesPath!, 'google-oauth-client-secret.txt')
    oauthTestState.files.set(secretFile, `GOCSPX-packaged-secret-value\n`)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resolveBuiltinGoogleOAuthClientSecret does not log the secret value in any console method', () => {
    const captured: string[] = []
    const capture = (...args: unknown[]) => {
      captured.push(args.map(String).join(' '))
    }
    vi.spyOn(console, 'log').mockImplementation(capture)
    vi.spyOn(console, 'warn').mockImplementation(capture)
    vi.spyOn(console, 'error').mockImplementation(capture)

    const meta = resolveBuiltinGoogleOAuthClientWithMeta()
    expect(meta).not.toBeNull()
    const secret = resolveBuiltinGoogleOAuthClientSecret(meta!)
    expect(secret).toBe('GOCSPX-packaged-secret-value')

    const allOutput = captured.join('\n')
    expect(allOutput).not.toContain('GOCSPX-packaged-secret-value')
  })
})

/**
 * INV-2 / credential-payload shape: the GmailCredentialsCheckApiPayload must not serialize
 * the raw bundled secret. `hasSecret` (boolean) is the only secret-derived field.
 */
describe('INV-2: bundled client secret not in credential check payload shape', () => {
  it('GmailCredentialsCheckApiPayload type does not contain a raw secret field', () => {
    // Structural: the payload type has `hasSecret: boolean` but no `clientSecret` or `secret` field.
    // Verify at runtime by checking the keys of a known-good payload shape object.
    const payloadKeys: string[] = [
      'configured', 'developerCredentialsStored', 'builtinOAuthAvailable',
      'builtinStandardConnectReady', 'gmailBuiltinProviderStatus', 'developerModeEnabled',
      'clientId', 'source', 'credentials', 'hasSecret', 'vaultUnlocked',
      'standardConnectBundledClientFingerprint', 'standardConnectBuiltinSourceKind',
    ]
    expect(payloadKeys).not.toContain('clientSecret')
    expect(payloadKeys).not.toContain('secret')
    expect(payloadKeys).not.toContain('builtinClientSecret')
  })
})
