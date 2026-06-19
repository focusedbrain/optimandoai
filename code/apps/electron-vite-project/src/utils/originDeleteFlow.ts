/**
 * Prompt 2 — confirmation guard before optional origin-mailbox trash.
 */

const SESSION_PREFIX = 'wrdesk:originDeleteConfirm:'

export type OriginDeleteAccountRow = {
  id: string
  email?: string
  deleteFromProviderOnLocalDelete?: boolean
  originDeleteFromProviderCapable?: boolean
  originDeleteBlockReason?: string
}

function accountById(
  accounts: OriginDeleteAccountRow[],
  id: string,
): OriginDeleteAccountRow | undefined {
  return accounts.find((a) => a.id === id)
}

export function messageAccountIds(
  ids: string[],
  messages: Array<{ id: string; account_id?: string | null }>,
): string[] {
  const idSet = new Set(ids)
  const out = new Set<string>()
  for (const m of messages) {
    if (idSet.has(m.id) && m.account_id) out.add(m.account_id)
  }
  return [...out]
}

/** True when any selected message belongs to an account with origin delete enabled. */
export function needsOriginDeleteForSelection(
  ids: string[],
  messages: Array<{ id: string; account_id?: string | null }>,
  accounts: OriginDeleteAccountRow[],
): boolean {
  for (const accountId of messageAccountIds(ids, messages)) {
    const acc = accountById(accounts, accountId)
    if (acc?.deleteFromProviderOnLocalDelete === true) return true
  }
  return false
}

function sessionConfirmed(accountId: string): boolean {
  try {
    return sessionStorage.getItem(`${SESSION_PREFIX}${accountId}`) === '1'
  } catch {
    return false
  }
}

function markSessionConfirmed(accountId: string): void {
  try {
    sessionStorage.setItem(`${SESSION_PREFIX}${accountId}`, '1')
  } catch {
    /* ignore */
  }
}

/**
 * Shows a destructive confirm when origin delete applies and session has not confirmed yet.
 * Returns true to proceed with delete (local always; origin only when toggle on + confirmed).
 */
export function confirmOriginDeleteIfNeeded(
  ids: string[],
  messages: Array<{ id: string; account_id?: string | null }>,
  accounts: OriginDeleteAccountRow[],
): boolean {
  const relevantAccountIds = messageAccountIds(ids, messages).filter((accountId) => {
    const acc = accountById(accounts, accountId)
    return acc?.deleteFromProviderOnLocalDelete === true
  })
  if (relevantAccountIds.length === 0) return true

  const needsPrompt = relevantAccountIds.some((id) => !sessionConfirmed(id))
  if (!needsPrompt) return true

  const lines: string[] = [
    'Smart Sync is enabled for this account.',
    '',
    'WRDesk will remove the message locally AND move it to Trash / Deleted Items on your mail provider (recoverable there, not permanent).',
    '',
  ]

  for (const accountId of relevantAccountIds) {
    const acc = accountById(accounts, accountId)
    const label = acc?.email?.trim() || accountId
    if (acc?.originDeleteFromProviderCapable === false) {
      lines.push(
        `• ${label}: provider trash is NOT available on this device — ${acc.originDeleteBlockReason ?? 'insufficient scope'}. Local remove will still run.`,
      )
    } else {
      lines.push(`• ${label}: will trash on the provider when scope allows.`)
    }
  }

  lines.push('', 'Continue?')
  const ok = window.confirm(lines.join('\n'))
  if (ok) {
    for (const accountId of relevantAccountIds) {
      markSessionConfirmed(accountId)
    }
  }
  return ok
}

export function originDeleteConfirmedForSelection(
  ids: string[],
  messages: Array<{ id: string; account_id?: string | null }>,
  accounts: OriginDeleteAccountRow[],
): boolean {
  return needsOriginDeleteForSelection(ids, messages, accounts)
}
