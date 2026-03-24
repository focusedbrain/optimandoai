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
  return /authentication failed|invalid credentials|login failed|not authenticated|unauthorized|invalid_grant|bad credentials|unable to authenticate|eauthentication|anmeldung fehlgeschlagen|authentifizierung fehlgeschlagen|ungültige anmeldedaten|ungueltige anmeldedaten|zugriff verweigert|falsches passwort|ungültiges passwort|ungueltiges passwort/i.test(
    message || '',
  )
}

export type SyncFailureKind = 'auth' | 'tls' | 'network' | 'timeout' | 'generic'

/**
 * Classify a sync warning line for inbox UI (auth vs TLS vs network vs timeout vs generic).
 * Order: auth first, then timeout, TLS, network (some messages overlap; prefer the most actionable).
 */
export function classifySyncFailureMessage(message: string): SyncFailureKind {
  const raw = message || ''
  if (isAuthSyncFailureMessage(raw)) return 'auth'
  const m = raw.toLowerCase()
  if (/timed out|timeout|etimedout|deadline exceeded|syncaccountemails timed out/i.test(m)) return 'timeout'
  if (
    /certificate|x509|self[- ]signed|ssl alert|tls alert|wrong version|handshake|unable to verify|unable to verify the first certificate|cert\.? has expired|hostname\/ip does not match/i.test(
      m,
    )
  ) {
    return 'tls'
  }
  if (
    /econnreset|econnrefused|enetunreach|ehostunreach|socket hang up|getaddrinfo|enotfound|network is unreachable|connection reset|dns|eai_again/i.test(
      m,
    )
  ) {
    return 'network'
  }
  return 'generic'
}
