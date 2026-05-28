/**
 * Session-scoped consent grants (in-memory only; cleared on app restart).
 *
 * Scopes are arbitrary strings identifying the operation class the user consented to
 * for the current session. To add a new scope (e.g. `office_document_parsing`), use the
 * same grant/has/revoke API with a new scope string consistently in the dialog and
 * decision tree. Grants do not persist across app restart.
 */

/** Known scope for inbox/chat PDF parsing consent (Workstream 4). */
export type SessionConsentScope = 'pdf_parsing' | (string & {})

const grantedScopes = new Set<string>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      /* ignore listener errors */
    }
  }
}

export function grantSessionConsent(scope: string): void {
  grantedScopes.add(scope)
  notify()
}

export function hasSessionConsent(scope: string): boolean {
  return grantedScopes.has(scope)
}

export function revokeSessionConsent(scope: string): void {
  grantedScopes.delete(scope)
  notify()
}

/** Tests only — reset all session grants. */
export function _clearAllSessionConsentForTests(): void {
  grantedScopes.clear()
  notify()
}

export function onSessionConsentChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
