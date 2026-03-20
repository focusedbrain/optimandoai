/**
 * Pick a sensible default **saved account row** (not mailbox slice) for send/sync fallbacks.
 */

export function pickDefaultEmailAccountRowId(
  accounts: Array<{ id: string; status?: 'active' | 'error' | 'disabled' | string }>,
): string | undefined {
  if (!accounts.length) return undefined
  const active = accounts.filter((a) => a.status === 'active')
  if (active.length) return active[0].id
  const notError = accounts.filter((a) => a.status !== 'error' && a.status !== 'disabled')
  if (notError.length) return notError[0].id
  return accounts[0].id
}
