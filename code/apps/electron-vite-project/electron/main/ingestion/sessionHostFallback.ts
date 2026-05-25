/**
 * Session-scoped host fallback authorization (edge enabled + unreachable).
 * Revoked on app quit — no persistent "remember forever".
 */

let _sessionHostFallbackAuthorized = false

export function isSessionHostFallbackAuthorized(): boolean {
  return _sessionHostFallbackAuthorized
}

export function authorizeSessionHostFallback(): void {
  _sessionHostFallbackAuthorized = true
}

export function revokeSessionHostFallback(): void {
  _sessionHostFallbackAuthorized = false
}

/** Tests only. */
export function _resetSessionHostFallbackForTest(): void {
  _sessionHostFallbackAuthorized = false
}
