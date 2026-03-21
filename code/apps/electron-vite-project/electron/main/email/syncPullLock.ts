/**
 * Per-account Pull lock: while list+fetch runs for a provider mailbox, remote orchestrator
 * queue processing must not move messages for that account (avoids INBOX list → mirror move → fetch miss).
 */

const pullActiveAccountIds = new Set<string>()

export function isPullActive(accountId: string): boolean {
  return pullActiveAccountIds.has(accountId)
}

export function markPullActive(accountId: string): void {
  pullActiveAccountIds.add(accountId)
}

export function markPullInactive(accountId: string): void {
  pullActiveAccountIds.delete(accountId)
}
