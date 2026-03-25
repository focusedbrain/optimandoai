/**
 * Packaged-app OAuth resolution uses mocked `electron` + `fs` (hoisted).
 * Verifies resource file wins for standard builtin id and assert catches inline mismatch.
 */
import path from 'path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const oauthTestState = vi.hoisted(() => ({
  files: new Map<string, string>(),
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

import {
  resolveBuiltinGoogleOAuthClientWithMeta,
  resolveBuiltinGoogleOAuthClientSecret,
  assertBuiltinPublicClientMatchesShippedResource,
  type BuiltinGoogleOAuthClientResolution,
} from './googleOAuthBuiltin'

const PACKAGED_RESOURCE_ID = '143694338843-packagedfileid.apps.googleusercontent.com'

describe('packaged builtin OAuth resolution', () => {
  beforeEach(() => {
    oauthTestState.files.clear()
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
