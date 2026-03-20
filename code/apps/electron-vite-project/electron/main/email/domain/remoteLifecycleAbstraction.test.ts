/**
 * Remote lifecycle abstraction — no network.
 */
import { describe, it, expect } from 'vitest'
import type { EmailAccountConfig } from '../types'
import {
  CANONICAL_LIFECYCLE_BUCKET_LABELS,
  remoteLifecycleBackendForProvider,
  resolveRemoteLifecycleSnapshot,
} from './remoteLifecycleAbstraction'

function baseAccount(overrides: Partial<EmailAccountConfig> = {}): EmailAccountConfig {
  const now = Date.now()
  return {
    id: 'acc1',
    displayName: 'Test',
    email: 'u@example.com',
    provider: 'gmail',
    authType: 'oauth',
    folders: { monitored: ['INBOX'], inbox: 'INBOX', sent: 'Sent' },
    sync: { maxAgeDays: 30, analyzePdfs: true, batchSize: 50 },
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as EmailAccountConfig
}

describe('resolveRemoteLifecycleSnapshot', () => {
  it('aligns Gmail / Outlook / IMAP default display targets with canonical bucket labels', () => {
    const g = resolveRemoteLifecycleSnapshot(baseAccount({ provider: 'gmail' }))
    const o = resolveRemoteLifecycleSnapshot(baseAccount({ provider: 'microsoft365' }))
    const i = resolveRemoteLifecycleSnapshot(baseAccount({ provider: 'imap' }))

    expect(g.targets.pendingReview).toBe(CANONICAL_LIFECYCLE_BUCKET_LABELS.pendingReview)
    expect(g.targets.pendingDelete).toBe(CANONICAL_LIFECYCLE_BUCKET_LABELS.pendingDelete)
    expect(g.targets.archive).toEqual(['INBOX'])

    expect(o.targets.pendingReview).toBe(CANONICAL_LIFECYCLE_BUCKET_LABELS.pendingReview)
    expect(o.targets.pendingDelete).toBe(CANONICAL_LIFECYCLE_BUCKET_LABELS.pendingDelete)
    expect(o.targets.archive).toBe('graph:wellKnown:archive')

    expect(i.targets.pendingReview).toBe(CANONICAL_LIFECYCLE_BUCKET_LABELS.pendingReview)
    expect(i.targets.pendingDelete).toBe(CANONICAL_LIFECYCLE_BUCKET_LABELS.pendingDelete)
    expect(i.targets.archive).toBe(CANONICAL_LIFECYCLE_BUCKET_LABELS.archive)
  })

  it('classifies backend per provider', () => {
    expect(remoteLifecycleBackendForProvider('gmail')).toBe('gmail_api_labels')
    expect(remoteLifecycleBackendForProvider('microsoft365')).toBe('microsoft_graph_mailfolder_move')
    expect(remoteLifecycleBackendForProvider('imap')).toBe('imap_uid_move')
  })
})
