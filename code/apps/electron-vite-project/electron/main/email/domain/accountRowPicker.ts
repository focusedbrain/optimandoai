/**
 * Pick a sensible default **saved account row** (not mailbox slice) for send/sync fallbacks.
 */

export function pickDefaultEmailAccountRowId(
  accounts: Array<{ id: string; status?: 'active' | 'error' | 'disabled' | 'auth_error' | string }>,
): string | undefined {
  if (!accounts.length) return undefined
  const active = accounts.filter((a) => a.status === 'active')
  if (active.length) return active[0].id
  const notBroken = accounts.filter(
    (a) => a.status !== 'error' && a.status !== 'disabled' && a.status !== 'auth_error',
  )
  if (notBroken.length) return notBroken[0].id
  /** All rows are error/disabled/auth_error — do not default to a broken account for send/sync UI. */
  return undefined
}
