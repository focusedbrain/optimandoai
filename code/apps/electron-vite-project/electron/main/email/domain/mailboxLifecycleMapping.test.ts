/**
 * Provider mapping for orchestrator remote ops — no network / Electron.
 */
import { describe, it, expect } from 'vitest'
import type { EmailAccountConfig } from '../types'
import {
  DEFAULT_ORCHESTRATOR_REMOTE_NAMES,
  resolveOrchestratorRemoteNames,
  orchestratorRemoteFromImapLifecycleFields,
  describeOrchestratorRemoteOperation,
  REMOTE_DELETION_TARGETS,
} from './mailboxLifecycleMapping'

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

describe('resolveOrchestratorRemoteNames', () => {
  it('IMAP defaults use exact lifecycle folder names (no app prefix)', () => {
    expect(DEFAULT_ORCHESTRATOR_REMOTE_NAMES.imap.pendingReviewMailbox).toBe('Pending Review')
    expect(DEFAULT_ORCHESTRATOR_REMOTE_NAMES.imap.pendingDeleteMailbox).toBe('Pending Delete')
    expect(DEFAULT_ORCHESTRATOR_REMOTE_NAMES.imap.archiveMailbox).toBe('Archive')
    expect(DEFAULT_ORCHESTRATOR_REMOTE_NAMES.imap.urgentMailbox).toBe('Urgent')
  })

  it('Gmail + Outlook defaults match IMAP-style Pending Review / Pending Delete names', () => {
    expect(DEFAULT_ORCHESTRATOR_REMOTE_NAMES.gmail.pendingReviewLabel).toBe('Pending Review')
    expect(DEFAULT_ORCHESTRATOR_REMOTE_NAMES.gmail.pendingDeleteLabel).toBe('Pending Delete')
    expect(DEFAULT_ORCHESTRATOR_REMOTE_NAMES.gmail.urgentLabel).toBe('Urgent')
    expect(DEFAULT_ORCHESTRATOR_REMOTE_NAMES.outlook.pendingReviewFolder).toBe('Pending Review')
    expect(DEFAULT_ORCHESTRATOR_REMOTE_NAMES.outlook.pendingDeleteFolder).toBe('Pending Delete')
    expect(DEFAULT_ORCHESTRATOR_REMOTE_NAMES.outlook.urgentFolder).toBe('Urgent')
  })

  it('uses product defaults for Gmail labels and archive remove list', () => {
    const r = resolveOrchestratorRemoteNames(baseAccount({ provider: 'gmail' }))
    expect(r.gmail.pendingReviewLabel).toBe(DEFAULT_ORCHESTRATOR_REMOTE_NAMES.gmail.pendingReviewLabel)
    expect(r.gmail.pendingDeleteLabel).toBe(DEFAULT_ORCHESTRATOR_REMOTE_NAMES.gmail.pendingDeleteLabel)
    expect(r.gmail.archiveRemoveLabelIds).toEqual(['INBOX'])
  })

  it('merges Gmail overrides (trim + custom archive label ids)', () => {
    const r = resolveOrchestratorRemoteNames(
      baseAccount({
        orchestratorRemote: {
          gmailPendingReviewLabel: '  Custom/Review  ',
          gmailArchiveRemoveLabelIds: ['INBOX', 'CATEGORY_PROMOTIONS'],
        },
      }),
    )
    expect(r.gmail.pendingReviewLabel).toBe('Custom/Review')
    expect(r.gmail.archiveRemoveLabelIds).toEqual(['INBOX', 'CATEGORY_PROMOTIONS'])
  })

  it('Microsoft 365: resolves pending folder display names with defaults', () => {
    const r = resolveOrchestratorRemoteNames(baseAccount({ provider: 'microsoft365' }))
    expect(r.outlook.pendingReviewFolder).toBe(DEFAULT_ORCHESTRATOR_REMOTE_NAMES.outlook.pendingReviewFolder)
    expect(r.outlook.pendingDeleteFolder).toBe(DEFAULT_ORCHESTRATOR_REMOTE_NAMES.outlook.pendingDeleteFolder)
    expect(r.outlook.urgentFolder).toBe(DEFAULT_ORCHESTRATOR_REMOTE_NAMES.outlook.urgentFolder)
  })

  it('IMAP: merges lifecycle mailbox overrides from orchestratorRemote', () => {
    const r = resolveOrchestratorRemoteNames(
      baseAccount({
        provider: 'imap',
        orchestratorRemote: {
          imapArchiveMailbox: 'MyArchive',
          imapTrashMailbox: 'Deleted',
        },
      }),
    )
    expect(r.imap.archiveMailbox).toBe('MyArchive')
    expect(r.imap.trashMailbox).toBe('Deleted')
    expect(r.imap.pendingReviewMailbox).toBe(DEFAULT_ORCHESTRATOR_REMOTE_NAMES.imap.pendingReviewMailbox)
  })
})

describe('orchestratorRemoteFromImapLifecycleFields', () => {
  it('returns undefined when no lifecycle fields set', () => {
    expect(orchestratorRemoteFromImapLifecycleFields({})).toBeUndefined()
  })

  it('maps trimmed IMAP lifecycle fields to orchestratorRemote input', () => {
    expect(
      orchestratorRemoteFromImapLifecycleFields({
        imapLifecycleArchiveMailbox: ' A ',
        imapLifecycleTrashMailbox: 'Bin',
      }),
    ).toEqual({
      imapArchiveMailbox: 'A',
      imapTrashMailbox: 'Bin',
    })
  })
})

describe('describeOrchestratorRemoteOperation', () => {
  it('covers archive / pending_review / pending_delete / urgent', () => {
    expect(describeOrchestratorRemoteOperation('archive')).toContain('archive')
    expect(describeOrchestratorRemoteOperation('pending_review')).toContain('pending_review')
    expect(describeOrchestratorRemoteOperation('pending_delete')).toContain('pending_delete')
    expect(describeOrchestratorRemoteOperation('urgent')).toContain('urgent')
  })
})

describe('REMOTE_DELETION_TARGETS (Gmail / Outlook regression)', () => {
  it('Gmail trash API suffix matches Gmail REST shape', () => {
    const id = 'abc123'
    expect(`/users/me/messages/${id}${REMOTE_DELETION_TARGETS.gmail.trashApiSuffix}`).toBe(
      '/users/me/messages/abc123/trash',
    )
  })

  it('Outlook deleted items uses Graph well-known folder id segment', () => {
    expect(REMOTE_DELETION_TARGETS.outlook.deletedItemsFolderId).toBe('deleteditems')
  })
})
