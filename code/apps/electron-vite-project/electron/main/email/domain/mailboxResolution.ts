/**
 * Resolve persisted `mailboxes[]` + root `folders` into concrete folder routing per slice.
 * One **saved account row** may own one or more **mailbox/postbox slices** (same credentials).
 */

import type { EmailAccountConfig, ProviderMailboxSlice } from '../types'

export interface ResolvedMailboxSlice {
  mailboxId: string
  label: string
  providerMailboxResourceRef?: string
  folders: EmailAccountConfig['folders']
  isDefault: boolean
}

function mergeFolders(
  base: EmailAccountConfig['folders'],
  override?: ProviderMailboxSlice['folders'],
): EmailAccountConfig['folders'] {
  if (!override) return base
  return {
    inbox: override.inbox ?? base.inbox,
    sent: override.sent ?? base.sent,
    monitored: override.monitored && override.monitored.length > 0 ? override.monitored : base.monitored,
  }
}

function pickImplicitLabel(config: EmailAccountConfig): string {
  return config.displayName?.trim() || config.email?.trim() || 'Mailbox'
}

/**
 * Always returns at least one slice. Legacy rows without `mailboxes` → single implicit `default` slice.
 */
export function resolveMailboxesForAccount(config: EmailAccountConfig): ResolvedMailboxSlice[] {
  const slicesIn = config.mailboxes
  if (!slicesIn || slicesIn.length === 0) {
    return [
      {
        mailboxId: 'default',
        label: pickImplicitLabel(config),
        folders: config.folders,
        isDefault: true,
      },
    ]
  }

  const raw: ResolvedMailboxSlice[] = slicesIn.map((s) => ({
    mailboxId: s.mailboxId,
    label: s.label?.trim() || s.mailboxId,
    providerMailboxResourceRef: s.providerMailboxResourceRef,
    folders: mergeFolders(config.folders, s.folders),
    isDefault: s.isDefault === true,
  }))

  const defaultIndices = raw.map((r, i) => (r.isDefault ? i : -1)).filter((i) => i >= 0)
  if (defaultIndices.length === 0) {
    return raw.map((r, i) => ({ ...r, isDefault: i === 0 }))
  }
  if (defaultIndices.length === 1) {
    const keep = defaultIndices[0]
    return raw.map((r, i) => ({ ...r, isDefault: i === keep }))
  }
  const keep = defaultIndices[0]
  return raw.map((r, i) => ({ ...r, isDefault: i === keep }))
}

export function getDefaultMailboxSlice(config: EmailAccountConfig): ResolvedMailboxSlice {
  const slices = resolveMailboxesForAccount(config)
  return slices.find((s) => s.isDefault) ?? slices[0]
}

/**
 * Folder set to use for list/fetch/sync when operating on an account row.
 */
export function getFoldersForAccountOperation(
  config: EmailAccountConfig,
  mailboxId?: string,
): EmailAccountConfig['folders'] {
  const slices = resolveMailboxesForAccount(config)
  const slice = mailboxId ? slices.find((s) => s.mailboxId === mailboxId) : getDefaultMailboxSlice(config)
  return slice?.folders ?? config.folders
}
