/**
 * Prefixed console helpers for in-dashboard WR Chat only (not popup, not HybridSearch).
 * Use warn for user-actionable / misconfiguration; debug for dev-only tracing.
 */

const PREFIX = '[WR Chat:Dashboard]'

export function wrChatDashboardWarn(...args: unknown[]): void {
  console.warn(PREFIX, ...args)
}

export function wrChatDashboardDebug(...args: unknown[]): void {
  if (import.meta.env.DEV) {
    console.debug(PREFIX, ...args)
  }
}
