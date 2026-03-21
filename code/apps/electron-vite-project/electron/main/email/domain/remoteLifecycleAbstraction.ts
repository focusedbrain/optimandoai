/**
 * Shared remote lifecycle model — orchestrator buckets ↔ provider-native mechanics.
 *
 * **Baseline (IMAP):** real mailboxes `Pending Review`, `Pending Delete`, `Archive` (+ `Trash` for final delete).
 * **Gmail:** same *workflow* via user **labels** + remove `INBOX` for archive (`applyOrchestratorRemoteOperation` in `gmail.ts`).
 * **Microsoft 365:** same *workflow* via **Graph mailFolder move** to child folders under Inbox + well-known `archive` (`outlook.ts`).
 *
 * Providers implement `IEmailProvider.applyOrchestratorRemoteOperation` today; this module is the **single place**
 * for documentation, mechanism classification, and resolved target snapshots. Future work: optional
 * `ensureRemoteLifecycleTargets` / `reconcileRemoteLifecycleState` on the gateway aligned with this model.
 */

import type { EmailAccountConfig, EmailProvider } from '../types'
import type {
  OrchestratorRemoteApplyResult,
  OrchestratorRemoteOperation,
} from './orchestratorRemoteTypes'
import { resolveOrchestratorRemoteNames } from './mailboxLifecycleMapping'

/** Product-facing bucket names (aligned with IMAP folder names). */
export const CANONICAL_LIFECYCLE_BUCKET_LABELS = {
  pendingReview: 'Pending Review',
  pendingDelete: 'Pending Delete',
  archive: 'Archive',
} as const

/** How the provider realizes the three lifecycle operations on the server. */
export type RemoteLifecycleBackendKind =
  | 'gmail_api_labels'
  | 'microsoft_graph_mailfolder_move'
  | 'zoho_mail_api_folder_move'
  | 'imap_uid_move'

export function remoteLifecycleBackendForProvider(provider: EmailProvider): RemoteLifecycleBackendKind {
  switch (provider) {
    case 'gmail':
      return 'gmail_api_labels'
    case 'microsoft365':
      return 'microsoft_graph_mailfolder_move'
    case 'zoho':
      return 'zoho_mail_api_folder_move'
    case 'imap':
      return 'imap_uid_move'
  }
}

/**
 * Resolved provider-native targets for logging, UI hints, and future reconciliation.
 * - Gmail `archive` is **label IDs to remove** (default `INBOX`), not a display folder name.
 * - Outlook `archive` is a sentinel describing Graph well-known folder (see `outlook.ts`).
 */
export interface ResolvedRemoteLifecycleSnapshot {
  providerType: EmailProvider
  backend: RemoteLifecycleBackendKind
  targets: {
    pendingReview: string
    pendingDelete: string
    /** Gmail: INBOX + optional ids; Outlook: description; IMAP: mailbox name */
    archive: string | readonly string[]
    /** IMAP final-delete destination only */
    trashMailbox?: string
  }
}

export function resolveRemoteLifecycleSnapshot(account: EmailAccountConfig): ResolvedRemoteLifecycleSnapshot {
  const r = resolveOrchestratorRemoteNames(account)
  const p = account.provider
  if (p === 'gmail') {
    return {
      providerType: 'gmail',
      backend: 'gmail_api_labels',
      targets: {
        pendingReview: r.gmail.pendingReviewLabel,
        pendingDelete: r.gmail.pendingDeleteLabel,
        archive: r.gmail.archiveRemoveLabelIds,
      },
    }
  }
  if (p === 'microsoft365') {
    return {
      providerType: 'microsoft365',
      backend: 'microsoft_graph_mailfolder_move',
      targets: {
        pendingReview: r.outlook.pendingReviewFolder,
        pendingDelete: r.outlook.pendingDeleteFolder,
        archive: 'graph:wellKnown:archive',
      },
    }
  }
  if (p === 'zoho') {
    return {
      providerType: 'zoho',
      backend: 'zoho_mail_api_folder_move',
      targets: {
        pendingReview: r.zoho.pendingReviewFolder,
        pendingDelete: r.zoho.pendingDeleteFolder,
        archive: r.zoho.archiveFolder,
        trashMailbox: r.zoho.trashFolder,
      },
    }
  }
  return {
    providerType: 'imap',
    backend: 'imap_uid_move',
    targets: {
      pendingReview: r.imap.pendingReviewMailbox,
      pendingDelete: r.imap.pendingDeleteMailbox,
      archive: r.imap.archiveMailbox,
      trashMailbox: r.imap.trashMailbox,
    },
  }
}

/**
 * Future-facing adapter shape: one implementation per provider class.
 * Today, `EmailGateway.applyOrchestratorRemoteOperation` calls `provider.applyOrchestratorRemoteOperation` directly.
 */
export interface RemoteLifecycleAdapter {
  ensureRemoteLifecycleTargets(): Promise<{ ok: boolean; error?: string }>
  applyRemoteLifecycleOperation(
    messageId: string,
    operation: OrchestratorRemoteOperation,
  ): Promise<OrchestratorRemoteApplyResult>
  /** Optional: compare server state to SQLite / queue (IMAP has `reconcileImapLifecycleFromLocalState`; Graph/Gmail TBD). */
  reconcileRemoteLifecycleState?(): Promise<{ ok: boolean; detail?: string }>
}
