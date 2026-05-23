/**
 * Session origin — classifies where a persisted session came from.
 *
 * - 'local'       : session the user created themselves in WR Chat (default for legacy rows).
 * - 'beap_import' : session received from another user via a BEAP capsule ("Run Automation").
 * - 'file_import' : session loaded from a local .json / .yaml / .md export file.
 *
 * The field is written at persist time and never changed after that.
 * Legacy sessions that pre-date this field have no `sessionOrigin` key; they
 * MUST be treated as `'local'` at read time — no migration is required.
 */

export type SessionOrigin = 'local' | 'beap_import' | 'file_import'

/**
 * Read-time default: sessions without the field are treated as locally created.
 * Call this whenever you need to display or filter by origin.
 */
export function resolveSessionOrigin(session: Record<string, unknown>): SessionOrigin {
  const o = session.sessionOrigin
  if (o === 'beap_import' || o === 'file_import') return o
  return 'local'
}
