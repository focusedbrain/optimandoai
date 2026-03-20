/**
 * Mailbox lifecycle mapping — internal WR Desk lifecycle targets ↔ provider-specific remote representation.
 *
 * - **Gmail:** user labels + system label ids (`INBOX` removal = archive).
 * - **Microsoft 365:** Graph `mailFolders` moves under well-known Inbox / archive.
 * - **IMAP:** mailbox names for `MOVE` / `addBox` (configurable per account).
 *
 * Provider code should consume only `resolveOrchestratorRemoteNames(account)` and avoid hardcoded strings.
 */

import type { EmailAccountConfig, OrchestratorRemoteNamesInput } from '../types'
import type { OrchestratorRemoteOperation } from './orchestratorRemoteTypes'

/**
 * Product defaults — single place to change branding/paths for new installs.
 * Accounts may override via `orchestratorRemote`.
 */
export const DEFAULT_ORCHESTRATOR_REMOTE_NAMES = {
  gmail: {
    pendingReviewLabel: 'WRDesk/PendingReview',
    pendingDeleteLabel: 'WRDesk/PendingDelete',
    archiveRemoveLabelIds: ['INBOX'] as readonly string[],
  },
  outlook: {
    pendingReviewFolder: 'WR Desk — Pending Review',
    pendingDeleteFolder: 'WR Desk — Pending Delete',
  },
  imap: {
    archiveMailbox: 'Archive',
    pendingReviewMailbox: 'Pending Review',
    pendingDeleteMailbox: 'Pending Delete',
    trashMailbox: 'Trash',
  },
} as const

/** Fully resolved names for all providers (callers read only the slice for `account.provider`). */
export interface ResolvedOrchestratorRemoteNames {
  gmail: {
    pendingReviewLabel: string
    pendingDeleteLabel: string
    archiveRemoveLabelIds: string[]
  }
  outlook: {
    pendingReviewFolder: string
    pendingDeleteFolder: string
  }
  imap: {
    archiveMailbox: string
    pendingReviewMailbox: string
    pendingDeleteMailbox: string
    trashMailbox: string
  }
}

function coalesceTrim(s: string | undefined, fallback: string): string {
  const t = s?.trim()
  return t && t.length > 0 ? t : fallback
}

/**
 * Merge account overrides with product defaults. Safe to call with any `EmailAccountConfig`.
 */
export function resolveOrchestratorRemoteNames(account: EmailAccountConfig): ResolvedOrchestratorRemoteNames {
  const o = account.orchestratorRemote
  const g = DEFAULT_ORCHESTRATOR_REMOTE_NAMES.gmail
  const ms = DEFAULT_ORCHESTRATOR_REMOTE_NAMES.outlook
  const im = DEFAULT_ORCHESTRATOR_REMOTE_NAMES.imap

  const archiveRemove =
    Array.isArray(o?.gmailArchiveRemoveLabelIds) && o!.gmailArchiveRemoveLabelIds!.length > 0
      ? [...o!.gmailArchiveRemoveLabelIds!]
      : [...g.archiveRemoveLabelIds]

  return {
    gmail: {
      pendingReviewLabel: coalesceTrim(o?.gmailPendingReviewLabel, g.pendingReviewLabel),
      pendingDeleteLabel: coalesceTrim(o?.gmailPendingDeleteLabel, g.pendingDeleteLabel),
      archiveRemoveLabelIds: archiveRemove,
    },
    outlook: {
      pendingReviewFolder: coalesceTrim(o?.outlookPendingReviewFolder, ms.pendingReviewFolder),
      pendingDeleteFolder: coalesceTrim(o?.outlookPendingDeleteFolder, ms.pendingDeleteFolder),
    },
    imap: {
      archiveMailbox: coalesceTrim(o?.imapArchiveMailbox, im.archiveMailbox),
      pendingReviewMailbox: coalesceTrim(o?.imapPendingReviewMailbox, im.pendingReviewMailbox),
      pendingDeleteMailbox: coalesceTrim(o?.imapPendingDeleteMailbox, im.pendingDeleteMailbox),
      trashMailbox: coalesceTrim(o?.imapTrashMailbox, im.trashMailbox),
    },
  }
}

/** Build persisted `orchestratorRemote` from optional IMAP connect payload fields. */
export function orchestratorRemoteFromImapLifecycleFields(input: {
  imapLifecycleArchiveMailbox?: string
  imapLifecyclePendingReviewMailbox?: string
  imapLifecyclePendingDeleteMailbox?: string
  imapLifecycleTrashMailbox?: string
}): OrchestratorRemoteNamesInput | undefined {
  const a = input.imapLifecycleArchiveMailbox?.trim()
  const r = input.imapLifecyclePendingReviewMailbox?.trim()
  const d = input.imapLifecyclePendingDeleteMailbox?.trim()
  const t = input.imapLifecycleTrashMailbox?.trim()
  if (!a && !r && !d && !t) return undefined
  return {
    ...(a ? { imapArchiveMailbox: a } : {}),
    ...(r ? { imapPendingReviewMailbox: r } : {}),
    ...(d ? { imapPendingDeleteMailbox: d } : {}),
    ...(t ? { imapTrashMailbox: t } : {}),
  }
}

/** Human-readable map from internal orchestrator operations to lifecycle intent (logging / diagnostics). */
export function describeOrchestratorRemoteOperation(op: OrchestratorRemoteOperation): string {
  switch (op) {
    case 'archive':
      return 'lifecycle:archive (remove from inbox / archive on server)'
    case 'pending_review':
      return 'lifecycle:pending_review (quarantine for human review on server)'
    case 'pending_delete':
      return 'lifecycle:pending_delete (mark for deletion bucket on server)'
    default:
      return `lifecycle:${op}`
  }
}

/**
 * Remote **deletion** targets (separate from `OrchestratorRemoteOperation` — uses `deleteMessage` APIs).
 * Centralized constants so providers do not scatter magic strings.
 */
export const REMOTE_DELETION_TARGETS = {
  gmail: {
    /** POST .../trash — message remains recoverable from Trash */
    trashApiSuffix: '/trash' as const,
  },
  outlook: {
    /** Graph well-known folder name segment for deleted items */
    deletedItemsFolderId: 'deleteditems' as const,
  },
} as const
