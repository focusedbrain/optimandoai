/**
 * Mailbox / sync-target domain model.
 *
 * Distinguishes:
 * - **Provider account row** (`EmailAccountConfig.id`) — one persisted connection + credentials.
 * - **Mailbox** — logical mail store (one user's mailbox at the provider).
 * - **Sync target** — a folder/label/postbox slice that the app can sync or query.
 *
 * An account row may define **multiple mailbox slices** (`EmailAccountConfig.mailboxes`);
 * each slice has its own folder routing. Without `mailboxes`, resolution yields one implicit
 * `default` slice. Multiple **folders/labels** inside one slice still use `monitored[]`.
 */

import type { EmailAccountConfig } from '../types'

/** Role of a sync target within the mailbox (provider-agnostic). */
export type MailboxSyncTargetRole = 'inbox' | 'sent' | 'drafts' | 'trash' | 'archive' | 'label' | 'other'

/**
 * One sync-capable folder/label (or well-known mailbox slice) for ingestion or send routing.
 */
export interface MailboxSyncTarget {
  /** Stable id within this provider account row (not the provider's message id). */
  syncTargetId: string
  /** Provider-native folder id / label name / graph folder id. */
  providerFolderRef: string
  role: MailboxSyncTargetRole
  /** The default folder used when no folder override is passed to list/fetch. */
  isPrimaryInbox: boolean
}

/**
 * Full plan of what to sync / monitor for one provider account row.
 * v1: derived only from legacy `folders` on `EmailAccountConfig`.
 */
export interface MailboxSyncPlan {
  targets: MailboxSyncTarget[]
}

/**
 * Build a normalized sync plan from persisted `folders`.
 * Multiple targets = multiple folders/labels in the **same** connected mailbox.
 */
export function mailboxSyncPlanFromLegacyFolders(
  folders: EmailAccountConfig['folders'],
): MailboxSyncPlan {
  const inboxRef = folders.inbox
  const sentRef = folders.sent
  const monitored = folders.monitored?.length ? folders.monitored : [inboxRef]

  const targets: MailboxSyncTarget[] = []
  const seen = new Set<string>()

  const push = (t: MailboxSyncTarget) => {
    if (seen.has(t.providerFolderRef)) return
    seen.add(t.providerFolderRef)
    targets.push(t)
  }

  push({
    syncTargetId: 'inbox',
    providerFolderRef: inboxRef,
    role: 'inbox',
    isPrimaryInbox: true,
  })

  if (sentRef) {
    push({
      syncTargetId: 'sent',
      providerFolderRef: sentRef,
      role: 'sent',
      isPrimaryInbox: false,
    })
  }

  for (const ref of monitored) {
    if (ref === inboxRef) continue
    if (sentRef && ref === sentRef) continue
    push({
      syncTargetId: `monitored:${ref}`,
      providerFolderRef: ref,
      role: 'label',
      isPrimaryInbox: false,
    })
  }

  return { targets }
}

/**
 * Reverse mapping for future migrations / editors (not used for persistence yet).
 */
export function legacyFoldersFromMailboxSyncPlan(plan: MailboxSyncPlan): Pick<
  EmailAccountConfig['folders'],
  'inbox' | 'sent' | 'monitored'
> {
  const primary = plan.targets.find((t) => t.isPrimaryInbox && t.role === 'inbox')
  const sent = plan.targets.find((t) => t.role === 'sent')
  const inbox = primary?.providerFolderRef ?? plan.targets[0]?.providerFolderRef ?? 'INBOX'
  const monitored = plan.targets
    .filter((t) => t.providerFolderRef !== inbox && t.providerFolderRef !== sent?.providerFolderRef)
    .map((t) => t.providerFolderRef)
  const allMonitored = [inbox, ...monitored]
  return {
    inbox,
    sent: sent?.providerFolderRef,
    monitored: allMonitored,
  }
}
