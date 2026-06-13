import { describe, it, expect } from 'vitest'
import type { EmailAccountConfig } from '../types'
import {
  mailboxIdentityKey,
  pickMailboxWinnerRow,
  dedupeMailboxConfigsForDisplay,
  findDuplicateMailboxGroups,
  findExistingMailboxAccountInList,
} from './mailboxAccountDedupe'

function row(
  partial: Partial<EmailAccountConfig> & Pick<EmailAccountConfig, 'id' | 'email' | 'provider'>,
): EmailAccountConfig {
  return {
    displayName: partial.displayName ?? partial.email,
    authType: 'oauth',
    folders: { monitored: ['INBOX'], inbox: 'INBOX' },
    sync: { maxAgeDays: 0, batchSize: 50 },
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

const probe =
  (map: Record<string, { read?: boolean; send?: boolean }>) =>
  (id: string) => ({
    read: map[id]?.read === true,
    send: map[id]?.send === true,
  })

describe('mailboxIdentityKey', () => {
  it('normalizes email case and whitespace', () => {
    expect(mailboxIdentityKey('  User@Gmail.COM ', 'gmail')).toBe('gmail::user@gmail.com')
  })

  it('returns null for empty email', () => {
    expect(mailboxIdentityKey('', 'gmail')).toBeNull()
  })
})

describe('dedupeMailboxConfigsForDisplay', () => {
  it('collapses same mailbox to one entry (bundled oauth wins)', () => {
    const bundled = row({
      id: 'host-send',
      email: 'a@gmail.com',
      provider: 'gmail',
      oauth: { accessToken: 'x', refreshToken: 'y', expiresAt: 9, scope: 'send' },
      updatedAt: 100,
    })
    const readOnly = row({
      id: 'sandbox-read',
      email: 'a@gmail.com',
      provider: 'gmail',
      updatedAt: 200,
    })
    const out = dedupeMailboxConfigsForDisplay(
      [readOnly, bundled],
      probe({ 'sandbox-read': { read: true } }),
      { isSandbox: false },
    )
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('host-send')
  })

  it('keeps two different mailboxes as two entries', () => {
    const a = row({ id: 'a', email: 'a@gmail.com', provider: 'gmail' })
    const b = row({ id: 'b', email: 'b@gmail.com', provider: 'gmail' })
    const out = dedupeMailboxConfigsForDisplay([a, b], probe({}), {})
    expect(out).toHaveLength(2)
    expect(out.map((r) => r.id).sort()).toEqual(['a', 'b'])
  })

  it('on sandbox prefers read-capable row over bundled send-only ghost', () => {
    const bundled = row({
      id: 'send-ghost',
      email: 'a@gmail.com',
      provider: 'gmail',
      oauth: { accessToken: 'x', refreshToken: 'y', expiresAt: 9, scope: 'send' },
    })
    const readRow = row({ id: 'read-row', email: 'a@gmail.com', provider: 'gmail' })
    const winner = pickMailboxWinnerRow(
      [bundled, readRow],
      probe({ 'read-row': { read: true } }),
      { isSandbox: true },
    )
    expect(winner.id).toBe('read-row')
    const listed = dedupeMailboxConfigsForDisplay(
      [bundled, readRow],
      probe({ 'read-row': { read: true } }),
      { isSandbox: true },
    )
    expect(listed).toHaveLength(1)
    expect(listed[0].id).toBe('read-row')
  })
})

describe('findDuplicateMailboxGroups', () => {
  it('groups losers for cleanup', () => {
    const bundled = row({
      id: 'winner',
      email: 'x@gmail.com',
      provider: 'gmail',
      oauth: { accessToken: 'a', refreshToken: 'b', expiresAt: 1, scope: 'all' },
    })
    const loser = row({ id: 'loser', email: 'x@gmail.com', provider: 'gmail' })
    const groups = findDuplicateMailboxGroups([bundled, loser], probe({ loser: { read: true } }), {})
    expect(groups).toHaveLength(1)
    expect(groups[0].winner.id).toBe('winner')
    expect(groups[0].losers.map((l) => l.id)).toEqual(['loser'])
  })
})

describe('findExistingMailboxAccountInList — connect dedupe', () => {
  it('reuses row with matching normalized email', () => {
    const existing = row({ id: 'keep', email: 'User@Gmail.com', provider: 'gmail' })
    const found = findExistingMailboxAccountInList([existing], 'gmail', 'user@gmail.com')
    expect(found?.id).toBe('keep')
  })

  it('reuses single empty-email orphan for same provider (reconnect after role-split)', () => {
    const orphan = row({ id: 'orphan', email: '', provider: 'gmail' })
    const found = findExistingMailboxAccountInList([orphan], 'gmail', 'user@gmail.com')
    expect(found?.id).toBe('orphan')
  })

  it('connecting same mailbox twice yields one identity in deduped list', () => {
    const first = row({ id: 'first', email: 'a@gmail.com', provider: 'gmail', oauth: { accessToken: 'x', refreshToken: 'y', expiresAt: 1, scope: 'all' } })
    const second = row({ id: 'second', email: 'a@gmail.com', provider: 'gmail' })
    const listed = dedupeMailboxConfigsForDisplay(
      [first, second],
      probe({ second: { read: true } }),
      { isSandbox: true },
    )
    expect(listed).toHaveLength(1)
  })
})
