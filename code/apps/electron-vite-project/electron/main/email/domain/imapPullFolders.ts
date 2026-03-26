/**
 * IMAP Pull — which mailboxes to list during sync (Pull / auto-sync).
 *
 * Uses `EmailAccountConfig.folders.monitored` when the user has customized it;
 * otherwise defaults to INBOX + Spam (web.de / GMX / many hosts use "Spam").
 * Folders that match resolved orchestrator lifecycle names are never pull sources
 * (sorted mail stays out of re-ingest loops).
 */

import { resolveOrchestratorRemoteNames } from './mailboxLifecycleMapping'
import type { EmailAccountConfig } from '../types'

/**
 * Folders to run `listMessages` / `fetchMessages` against for this account.
 * Non-IMAP: single inbox folder only.
 */
export function resolveImapPullFolders(account: EmailAccountConfig): string[] {
  if (account.provider !== 'imap') {
    return [account.folders?.inbox?.trim() || 'INBOX']
  }

  const monitored = account.folders?.monitored
  let base: string[]
  if (!monitored || monitored.length === 0) {
    base = ['INBOX', 'Spam']
  } else if (monitored.length === 1 && monitored[0]?.trim().toUpperCase() === 'INBOX') {
    /** Legacy single-INBOX accounts — add Spam so junk can be triaged without changing stored JSON. */
    base = ['INBOX', 'Spam']
  } else {
    base = monitored.map((f) => f.trim()).filter(Boolean)
  }

  try {
    const names = resolveOrchestratorRemoteNames(account)
    const im = names.imap
    const lifecycle = new Set(
      [im.archiveMailbox, im.pendingDeleteMailbox, im.pendingReviewMailbox, im.urgentMailbox, im.trashMailbox]
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean),
    )
    const filtered = base.filter((f) => f && !lifecycle.has(f.trim().toLowerCase()))
    return filtered.length > 0 ? filtered : ['INBOX', 'Spam']
  } catch {
    return base.length > 0 ? base : ['INBOX', 'Spam']
  }
}
