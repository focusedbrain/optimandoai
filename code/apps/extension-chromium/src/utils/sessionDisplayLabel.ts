/**
 * Single source of truth for session display names in the extension UI.
 * Priority: sessionAlias (user-set) → tabName → name → sessionName (legacy blob) → fallbackKey → 'Unnamed session'
 *
 * Use for option labels, titles, and any user-visible session name. Do not use raw tabName/name for display elsewhere.
 */

export type SessionDisplayFields = {
  sessionAlias?: string | null
  tabName?: string | null
  name?: string | null
  /** Legacy field on some orchestrator blobs */
  sessionName?: string | null
}

function nonEmpty(val: string | null | undefined): string | null {
  if (val == null) return null
  const trimmed = val.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function sessionDisplayLabel(
  session: SessionDisplayFields | null | undefined,
  fallbackKey?: string | null,
): string {
  if (session == null) {
    return nonEmpty(fallbackKey) ?? 'Unnamed session'
  }
  return (
    nonEmpty(session.sessionAlias) ??
    nonEmpty(session.tabName) ??
    nonEmpty(session.name) ??
    nonEmpty(session.sessionName) ??
    nonEmpty(fallbackKey) ??
    'Unnamed session'
  )
}
