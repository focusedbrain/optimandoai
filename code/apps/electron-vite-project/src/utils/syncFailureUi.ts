/**
 * Parse sync warning lines like `[account-uuid] listMessages INBOX: authentication failed`
 * (see useEmailInboxStore syncAllAccounts).
 */
export function parseBracketedAccountSyncMessage(line: string): { accountId: string; message: string } | null {
  const m = line.match(/^\[([^\]]+)\]\s*(.*)$/)
  if (!m) return null
  return { accountId: m[1].trim(), message: m[2].trim() }
}

/** User-facing auth / credential failure in sync logs (matches main-process emailAuthErrors loosely). */
export function isAuthSyncFailureMessage(message: string): boolean {
  return /authentication failed|invalid credentials|login failed|not authenticated|unauthorized|invalid_grant|bad credentials|unable to authenticate|eauthentication/i.test(
    message || '',
  )
}
