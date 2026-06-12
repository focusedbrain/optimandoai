/**
 * Regression: email accounts must rehydrate from custom userData after restart.
 * Root cause was eager `emailGateway` init before `app.setPath('userData')` in main.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const FIXTURE_ACCOUNT_ID = 'fixture-account-001'

type ElectronMockState = {
  userData: string
  bootstrapped: boolean
}

function makeElectronMock(state: ElectronMockState) {
  return {
    app: {
      getPath: (name: string): string => {
        if (name === 'userData') return state.userData
        if (name === 'home') return os.homedir()
        return path.join(state.userData, name)
      },
      setPath: (name: string, p: string): void => {
        if (name === 'userData') {
          state.userData = p
          state.bootstrapped = true
        }
      },
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from(`enc:${s}`),
      decryptString: (b: Buffer) => {
        const raw = b.toString()
        return raw.startsWith('enc:') ? raw.slice(4) : raw
      },
    },
  }
}

function writeEmailAccountsFixture(userDataDir: string, accountId = FIXTURE_ACCOUNT_ID): void {
  fs.mkdirSync(userDataDir, { recursive: true })
  const payload = {
    accounts: [
      {
        id: accountId,
        email: 'fixture@example.com',
        displayName: 'Fixture',
        provider: 'imap',
        authType: 'password',
        status: 'active',
        createdAt: 1,
        updatedAt: 1,
        imap: {
          host: 'imap.example.com',
          port: 993,
          security: 'ssl',
          username: 'fixture@example.com',
          password: 'fixture-pass',
          _encrypted: false,
        },
        folders: {
          monitored: ['INBOX'],
          inbox: 'INBOX',
        },
      },
    ],
  }
  fs.writeFileSync(path.join(userDataDir, 'email-accounts.json'), JSON.stringify(payload, null, 2), 'utf-8')
}

describe('userData bootstrap — email account persistence', () => {
  let tmpRoot: string
  let electronState: ElectronMockState
  let defaultUserData: string
  let customUserData: string

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wrdesk-ud-bootstrap-'))
    defaultUserData = path.join(tmpRoot, 'default-electron-userdata')
    customUserData = path.join(tmpRoot, '.opengiraffe', 'electron-data')
    fs.mkdirSync(defaultUserData, { recursive: true })
    electronState = { userData: defaultUserData, bootstrapped: false }
    vi.resetModules()
    const { resetUserDataBootstrapStateForTests } = await import('../../../userDataBootstrapState')
    resetUserDataBootstrapStateForTests()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    vi.doUnmock('node:os')
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  function installElectronMock(): void {
    vi.doMock('electron', () => makeElectronMock(electronState))
  }

  async function applyCustomUserDataPath(): Promise<void> {
    const { app } = await import('electron')
    app.setPath('userData', customUserData)
    const { markUserDataPathBootstrapped } = await import('../../../userDataBootstrapState')
    markUserDataPathBootstrapped()
  }

  async function runBootstrapModule(): Promise<void> {
    vi.doMock('node:os', () => ({
      default: {
        homedir: () => tmpRoot,
        hostname: () => 'test-host',
      },
    }))
    await import('../../../bootstrapUserData')
  }

  it('loads rows when bootstrap runs before gateway import (fixture under custom userData)', async () => {
    installElectronMock()
    writeEmailAccountsFixture(customUserData)
    await runBootstrapModule()
    expect(electronState.userData).toBe(customUserData)

    const { emailGateway } = await import('../gateway')
    const accounts = await emailGateway.listAccounts()
    expect(accounts).toHaveLength(1)
    expect(accounts[0]?.id).toBe(FIXTURE_ACCOUNT_ID)
    expect(emailGateway.getPersistenceDiagnostics().accountsFilePath).toBe(
      path.join(customUserData, 'email-accounts.json'),
    )
  })

  it('loads 0 rows when gateway imports before setPath (negative — documents the bug)', async () => {
    installElectronMock()
    writeEmailAccountsFixture(customUserData)

    const { emailGateway } = await import('../gateway')
    const accounts = await emailGateway.listAccounts()
    expect(accounts).toHaveLength(0)
    expect(electronState.userData).toBe(defaultUserData)
  })

  it('accounts survive simulated restart (re-init gateway after bootstrap)', async () => {
    installElectronMock()
    writeEmailAccountsFixture(customUserData)
    await applyCustomUserDataPath()

    const { emailGateway: gw1 } = await import('../gateway')
    expect((await gw1.listAccounts()).length).toBe(1)

    vi.resetModules()
    installElectronMock()
    electronState.userData = customUserData
    electronState.bootstrapped = true
    await applyCustomUserDataPath()

    const { emailGateway: gw2 } = await import('../gateway')
    const accounts = await gw2.listAccounts()
    expect(accounts).toHaveLength(1)
    expect(accounts[0]?.email).toBe('fixture@example.com')
  })

  it('unrelated setOrchestratorMode write does not clear email-accounts.json', async () => {
    installElectronMock()
    writeEmailAccountsFixture(customUserData)
    await applyCustomUserDataPath()

    const emailPath = path.join(customUserData, 'email-accounts.json')
    const before = fs.readFileSync(emailPath, 'utf-8')

    const { setOrchestratorMode } = await import('../../orchestrator/orchestratorModeStore')
    setOrchestratorMode({
      mode: 'sandbox',
      deviceName: 'test-device',
      instanceId: '11111111-1111-1111-1111-111111111111',
      pairingCode: '123456',
      connectedPeers: [],
      linked: [{ role: 'sandbox', handshakeId: 'hs-test-1', jobKinds: ['depackage-email'] }],
    })

    const after = fs.readFileSync(emailPath, 'utf-8')
    expect(after).toBe(before)
    expect(JSON.parse(after).accounts).toHaveLength(1)
  })

  it('deleteAccount is the path that removes rows from disk', async () => {
    installElectronMock()
    writeEmailAccountsFixture(customUserData)
    await runBootstrapModule()

    const { emailGateway } = await import('../gateway')
    expect((await emailGateway.listAccounts()).length).toBe(1)

    await emailGateway.deleteAccount(FIXTURE_ACCOUNT_ID)

    expect((await emailGateway.listAccounts()).length).toBe(0)
    const onDisk = JSON.parse(fs.readFileSync(path.join(customUserData, 'email-accounts.json'), 'utf-8'))
    expect(onDisk.accounts).toEqual([])
  })
})
