/**
 * Legacy / typo IMAP mailboxes (pre–canonical WR Desk names).
 * These must never satisfy "does canonical X exist?" checks — we CREATE the correct folder instead.
 */

/** Case-insensitive exact match for configured logical names (trimmed). */
export function imapFoldersMatchExact(serverName: string, wantedName: string): boolean {
  return serverName.trim().toLowerCase() === wantedName.trim().toLowerCase()
}

/**
 * True for typo "Archieve", WRDesk-* lifecycle clones, etc.
 * Full path or display name — substring check on normalized compact form.
 */
export function isLegacyImapMailboxLabel(pathOrName: string): boolean {
  const compact = pathOrName.trim().toLowerCase().replace(/\s+/g, '')
  if (!compact) return false
  if (compact.includes('archieve')) return true
  if (compact.includes('wrdesk')) return true
  return false
}
