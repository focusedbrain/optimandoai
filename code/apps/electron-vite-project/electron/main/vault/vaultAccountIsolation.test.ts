/**
 * Regression: account-scoped vault list, ownership metadata, and legacy handling.
 * (No SQLCipher / full VaultService unlock — those stay in other suites.)
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  getCurrentAccountIdentity,
  hasVaultOwnerMetadata,
  assertVaultOwnerMatchesSession,
  VAULT_ACCOUNT_ERROR,
  VAULT_OWNER_SCHEMA_VERSION,
} from './vaultOwnerIdentity'
import type { SessionUserInfo } from '../../../src/auth/session'

// Isolate vault storage under a temp "home" directory
const paths = { home: join(tmpdir(), `og-vault-iso-${Date.now()}`) }
vi.mock('os', async (importOriginal) => {
  const mod = await importOriginal<typeof import('os')>()
  return { ...mod, homedir: () => paths.home }
})

import { listVaultsForAccount, readVaultOwnerFromMetaFile } from './db'

function makeOwner(prefix: string) {
  return {
    owner_wrdesk_user_id: `${prefix}-w`,
    owner_sub: `${prefix}-sub`,
    owner_iss: 'https://issuer.example/realms/x',
    owner_email: `${prefix}@example.com`,
    owner_email_verified: true,
    owner_claimed_at: '2020-01-01T00:00:00.000Z',
    vault_schema_version: VAULT_OWNER_SCHEMA_VERSION,
  }
}

const sessionA: SessionUserInfo = {
  sub: 'a-sub',
  iss: 'https://issuer.example/realms/x',
  wrdesk_user_id: 'a-w',
  email: 'a@x.com',
}

const sessionB: SessionUserInfo = {
  sub: 'b-sub',
  iss: 'https://issuer.example/realms/x',
  wrdesk_user_id: 'b-w',
  email: 'b@x.com',
}

describe('vault account identity', () => {
  it('getCurrentAccountIdentity requires sub+iss', () => {
    expect(getCurrentAccountIdentity({ sub: 's', iss: 'i' } as SessionUserInfo)).toMatchObject({
      owner_sub: 's',
      owner_iss: 'i',
    })
    expect(getCurrentAccountIdentity(null)).toBeNull()
    expect(getCurrentAccountIdentity({ sub: '', iss: 'i' } as any)).toBeNull()
  })

  it('hasVaultOwnerMetadata is false without sub+iss', () => {
    expect(hasVaultOwnerMetadata({})).toBe(false)
    expect(
      hasVaultOwnerMetadata({ owner_sub: 'x', owner_iss: 'y', owner_wrdesk_user_id: 'z' }),
    ).toBe(true)
  })

  it('assertVaultOwnerMatchesSession throws ERR_VAULT_ACCOUNT_MISMATCH on wrong sub', () => {
    const owner = makeOwner('a')
    expect(() => assertVaultOwnerMatchesSession(owner, sessionB, VAULT_ACCOUNT_ERROR.MISMATCH_UNLOCK)).toThrow(
      VAULT_ACCOUNT_ERROR.MISMATCH_UNLOCK,
    )
  })
})

describe('listVaultsForAccount (isolated home)', () => {
  const dataDir = () => join(paths.home, '.opengiraffe', 'electron-data')
  const vaultA = 'vault_100_aabbccdd'
  const vaultB = 'vault_200_eeffeedd'
  const legacy = 'vault_300_11223344'

  beforeAll(() => {
    mkdirSync(dataDir(), { recursive: true })

    const reg = {
      vaults: [
        { id: vaultA, name: 'VA', created: 1, ...makeOwner('a') },
        { id: vaultB, name: 'VB', created: 2, ...makeOwner('b') },
        { id: legacy, name: 'Legacy', created: 3 },
      ],
    }
    writeFileSync(join(dataDir(), 'vaults.json'), JSON.stringify(reg, null, 2), 'utf-8')

    for (const id of [vaultA, vaultB, legacy]) {
      writeFileSync(join(dataDir(), `vault_${id}.db`), '', 'utf-8')
    }

    const ownerJson = (o: ReturnType<typeof makeOwner> | null) => {
      if (!o) return { name: 'L', activeProviderType: 'passphrase' as const, salt: 'YQ==', wrappedDEK: 'YQ==', kdfParams: {} }
      return {
        name: 'x',
        activeProviderType: 'passphrase' as const,
        salt: 'YQ==',
        wrappedDEK: 'YQ==',
        kdfParams: {},
        ...o,
      }
    }
    writeFileSync(join(dataDir(), `vault_${vaultA}.meta.json`), JSON.stringify(ownerJson(makeOwner('a'))), 'utf-8')
    writeFileSync(join(dataDir(), `vault_${vaultB}.meta.json`), JSON.stringify(ownerJson(makeOwner('b'))), 'utf-8')
    // Legacy: no owner_* in file (name-only meta will still be read by list as legacy if no owner in registry for row — registry row for legacy has no owner, file has no owner)
    writeFileSync(
      join(dataDir(), `vault_${legacy}.meta.json`),
      JSON.stringify({ name: 'Old', activeProviderType: 'passphrase', salt: 'YQ==', wrappedDEK: 'YQ==', kdfParams: {} }),
      'utf-8',
    )
  })

  afterAll(() => {
    try {
      rmSync(paths.home, { recursive: true, force: true })
    } catch {
      /* */
    }
  })

  it('Account A only sees their vault, not B; legacy is not listed as a normal vault', () => {
    const r = listVaultsForAccount(sessionA)
    expect(r.vaults.map((v) => v.id)).toEqual([vaultA])
    expect(r.legacyUnclaimed.length).toBe(1)
    expect(r.legacyUnclaimed[0]!.id).toBe(legacy)
    expect(r.legacyUnclaimed[0]!.legacy_unclaimed).toBe(true)
    expect(r.hiddenForeignCount).toBe(1)
  })

  it('Account B only sees their vault (foreign A hidden)', () => {
    const r = listVaultsForAccount(sessionB)
    expect(r.vaults.map((v) => v.id)).toEqual([vaultB])
    expect(r.hiddenForeignCount).toBe(1)
  })

  it('readVaultOwnerFromMetaFile returns owner for migration checks', () => {
    const a = readVaultOwnerFromMetaFile(vaultA)
    expect(a?.owner_sub).toBe('a-sub')
  })
})
