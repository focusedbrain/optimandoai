/**
 * Sandbox Inbox Clone read gate — persisted-row markers only (no dedicated DB column).
 *
 * Clone rows are written by P2P ingest (`writeP2PInboxRow`) with
 * `metadata.inbox_response_path.sandbox_clone` / `sandbox_clone_provenance` in
 * `beap_package_json`, optional body lead-in, and depackaged metadata.
 *
 * Keep detection aligned with `src/lib/inboxMessageSandboxClone.ts`.
 */

/** Prepended to clone `body_text` on send — same string as renderer constant. */
export const SANDBOX_CLONE_INBOX_BODY_BANNER = '[BEAP sandbox clone — sent by you]'

const PROV_KEY = 'inbox_sandbox_clone_provenance'

function stringHintsSandboxClone(s: string): boolean {
  if (!s) return false
  if (s.includes(SANDBOX_CLONE_INBOX_BODY_BANNER)) return true
  if (s.includes(PROV_KEY)) return true
  if (s.includes('sandbox_clone_provenance')) return true
  if (s.includes('"beap_sandbox_clone"') && (s.includes('original_message_id') || s.includes('clone_reason'))) {
    return true
  }
  if (/sandbox_clone"?\s*:\s*true/.test(s) && /automation_sandbox_clone"?\s*:\s*true/.test(s)) return true
  if (s.includes('sandbox_clone_quarantine')) return true
  return false
}

/** True when a persisted inbox row is a Host→Sandbox BEAP clone (incl. quarantine-clone path). */
export function isPersistedInboxRowSandboxClone(row: {
  body_text?: string | null
  beap_package_json?: string | null
  depackaged_json?: string | null
}): boolean {
  if (stringHintsSandboxClone(row.body_text ?? '')) return true
  if (stringHintsSandboxClone(row.beap_package_json ?? '')) return true
  if (stringHintsSandboxClone(row.depackaged_json ?? '')) return true
  return false
}

/**
 * SQL predicate restricting inbox lists to sandbox-clone rows only.
 * Uses the same persisted markers as {@link isPersistedInboxRowSandboxClone}.
 */
export function sandboxCloneInboxSqlPredicate(tableAlias?: string): string {
  const p = tableAlias ? `${tableAlias}.` : ''
  const bt = `${p}body_text`
  const pkg = `${p}beap_package_json`
  const dep = `${p}depackaged_json`
  const banner = SANDBOX_CLONE_INBOX_BODY_BANNER.replace(/'/g, "''")
  return `(
    ${bt} LIKE '%${banner}%'
    OR ${pkg} LIKE '%inbox_sandbox_clone_provenance%'
    OR ${pkg} LIKE '%sandbox_clone_provenance%'
    OR (${pkg} LIKE '%sandbox_clone%' AND ${pkg} LIKE '%true%')
    OR ${pkg} LIKE '%sandbox_clone_quarantine%'
    OR ${dep} LIKE '%beap_sandbox_clone%'
    OR ${dep} LIKE '%inbox_sandbox_clone_provenance%'
    OR (${dep} LIKE '%sandbox_clone%' AND ${dep} LIKE '%automation_sandbox_clone%')
  )`
}
