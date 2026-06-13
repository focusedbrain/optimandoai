/**
 * REGRESSION — Prompt 2 optional origin-mailbox trash (destructive, opt-in).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../sealed-storage/index', () => ({
  prepareSealedOperationalUpdate: (db: { prepare: (sql: string) => unknown }, sql: string) =>
    db.prepare(sql),
}))

const { deleteMessageMock, getAccountConfigMock, isEffectiveSandboxNodeMock, loadRoleScopedTokensMock } =
  vi.hoisted(() => ({
    deleteMessageMock: vi.fn(),
    getAccountConfigMock: vi.fn(),
    isEffectiveSandboxNodeMock: vi.fn(async () => false),
    loadRoleScopedTokensMock: vi.fn(),
  }))

vi.mock('../gateway', () => ({
  emailGateway: {
    deleteMessage: deleteMessageMock,
    getAccountConfig: getAccountConfigMock,
  },
}))

vi.mock('../resolveConnectOAuthScopeRole', () => ({
  isEffectiveSandboxNode: () => isEffectiveSandboxNodeMock(),
}))

vi.mock('../roleScopedTokenStore', () => ({
  loadRoleScopedTokens: (...args: unknown[]) => loadRoleScopedTokensMock(...args),
}))

import { assessOriginDeleteCapability } from '../originMailboxDeleteCapability'
import { trashOnOriginAfterLocalDelete } from '../originMailboxDelete'

function makeDb(rows: Record<string, unknown>[]) {
  const byId = new Map(rows.map((r) => [String(r.id), { ...r }]))
  return {
    prepare(sql: string) {
      return {
        get(id: string) {
          if (sql.includes('FROM inbox_messages WHERE id')) return byId.get(id)
          return undefined
        },
        run() {},
      }
    },
  }
}

describe('REGRESSION — origin mailbox delete (Prompt 2)', () => {
  beforeEach(() => {
    deleteMessageMock.mockReset()
    getAccountConfigMock.mockReset()
    isEffectiveSandboxNodeMock.mockReset()
    isEffectiveSandboxNodeMock.mockResolvedValue(false)
    loadRoleScopedTokensMock.mockReturnValue(null)
  })

  it('toggle OFF (default) — no provider call', async () => {
    getAccountConfigMock.mockReturnValue({
      id: 'acc-1',
      provider: 'gmail',
      deleteFromProviderOnLocalDelete: false,
      oauth: {
        accessToken: 't',
        refreshToken: 'r',
        expiresAt: Date.now() + 99999,
        scope: 'https://www.googleapis.com/auth/gmail.modify',
      },
    })
    const db = makeDb([
      {
        id: 'm1',
        account_id: 'acc-1',
        email_message_id: 'gmail-abc',
        source_type: 'email',
      },
    ])
    const r = await trashOnOriginAfterLocalDelete(db, ['m1'], { originDeleteConfirmed: true })
    expect(deleteMessageMock).not.toHaveBeenCalled()
    expect(r.skipped).toBe(1)
  })

  it('toggle ON + modify scope — provider trash issued (Gmail /trash)', async () => {
    getAccountConfigMock.mockReturnValue({
      id: 'acc-1',
      provider: 'gmail',
      deleteFromProviderOnLocalDelete: true,
      oauth: {
        accessToken: 't',
        refreshToken: 'r',
        expiresAt: Date.now() + 99999,
        scope:
          'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify',
      },
    })
    const db = makeDb([
      {
        id: 'm1',
        account_id: 'acc-1',
        email_message_id: 'gmail-abc',
        source_type: 'email',
      },
    ])
    const r = await trashOnOriginAfterLocalDelete(db, ['m1'], { originDeleteConfirmed: true })
    expect(deleteMessageMock).toHaveBeenCalledWith('acc-1', 'gmail-abc', expect.any(Object))
    expect(r.trashed).toBe(1)
  })

  it('toggle ON but insufficient scope — fails closed with clear message', async () => {
    getAccountConfigMock.mockReturnValue({
      id: 'acc-send',
      provider: 'gmail',
      deleteFromProviderOnLocalDelete: true,
    })
    loadRoleScopedTokensMock.mockImplementation((_id: string, role: string) =>
      role === 'send'
        ? {
            tokens: {
              scope: 'https://www.googleapis.com/auth/gmail.send',
            },
          }
        : null,
    )
    const cap = await assessOriginDeleteCapability({
      id: 'acc-send',
      provider: 'gmail',
    })
    expect(cap.canTrashOnProvider).toBe(false)
    expect(cap.blockReason).toMatch(/send-only/i)

    const db = makeDb([
      {
        id: 'm1',
        account_id: 'acc-send',
        email_message_id: 'gmail-abc',
        source_type: 'email',
      },
    ])
    const r = await trashOnOriginAfterLocalDelete(db, ['m1'], { originDeleteConfirmed: true })
    expect(deleteMessageMock).not.toHaveBeenCalled()
    expect(r.failed).toBe(1)
    expect(r.results[0]?.error).toMatch(/send-only|modify/i)
  })

  it('sandbox read-only node — capability blocked, no provider call', async () => {
    isEffectiveSandboxNodeMock.mockResolvedValue(true)
    const cap = await assessOriginDeleteCapability({
      id: 'acc-read',
      provider: 'gmail',
      oauth: {
        accessToken: 't',
        refreshToken: 'r',
        expiresAt: 0,
        scope: 'https://www.googleapis.com/auth/gmail.readonly',
      },
    })
    expect(cap.canTrashOnProvider).toBe(false)
    expect(cap.blockReason).toMatch(/read-only|Sandbox/i)

    getAccountConfigMock.mockReturnValue({
      id: 'acc-read',
      provider: 'gmail',
      deleteFromProviderOnLocalDelete: true,
      oauth: {
        accessToken: 't',
        refreshToken: 'r',
        expiresAt: 0,
        scope: 'https://www.googleapis.com/auth/gmail.readonly',
      },
    })
    const db = makeDb([
      {
        id: 'm1',
        account_id: 'acc-read',
        email_message_id: 'gmail-abc',
        source_type: 'email',
      },
    ])
    const r = await trashOnOriginAfterLocalDelete(db, ['m1'], { originDeleteConfirmed: true })
    expect(deleteMessageMock).not.toHaveBeenCalled()
    expect(r.failed).toBe(1)
  })

  it('requires originDeleteConfirmed when toggle ON', async () => {
    getAccountConfigMock.mockReturnValue({
      id: 'acc-1',
      provider: 'gmail',
      deleteFromProviderOnLocalDelete: true,
      oauth: {
        accessToken: 't',
        refreshToken: 'r',
        expiresAt: Date.now() + 99999,
        scope: 'https://www.googleapis.com/auth/gmail.modify',
      },
    })
    const db = makeDb([
      {
        id: 'm1',
        account_id: 'acc-1',
        email_message_id: 'gmail-abc',
        source_type: 'email',
      },
    ])
    const r = await trashOnOriginAfterLocalDelete(db, ['m1'], { originDeleteConfirmed: false })
    expect(deleteMessageMock).not.toHaveBeenCalled()
    expect(r.results[0]?.error).toMatch(/confirmation required/i)
  })
})
