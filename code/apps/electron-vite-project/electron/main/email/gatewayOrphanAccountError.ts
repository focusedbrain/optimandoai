/**
 * Detects gateway errors when `emailGateway.getProviderSync(account_id)` fails because
 * the persisted inbox `account_id` no longer exists in the in-memory gateway list.
 */

export function isGatewayOrphanAccountError(message: string): boolean {
  const m = (message || '').trim()
  if (!m) return false
  return m.includes('Account not found')
}
