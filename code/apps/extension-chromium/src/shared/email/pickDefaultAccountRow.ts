/**
 * Default **saved account row** for extension UI (same rules as main-process `accountRowPicker`).
 * Does not select mailbox slices — only `EmailAccountConfig` row id.
 */

export function pickDefaultEmailAccountRowId(
  accounts: Array<{ id: string; status?: string }>,
): string | undefined {
  if (!accounts.length) return undefined
  const active = accounts.filter((a) => a.status === 'active')
  if (active.length) return active[0].id
  const notBroken = accounts.filter(
    (a) => a.status !== 'error' && a.status !== 'disabled' && a.status !== 'auth_error',
  )
  if (notBroken.length) return notBroken[0].id
  return undefined
}
