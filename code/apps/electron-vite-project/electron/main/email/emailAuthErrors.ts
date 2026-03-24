/**
 * Centralized detection of provider auth failures (IMAP LOGIN, OAuth refresh, Graph, etc.).
 * Used by sync orchestrator, gateway testConnection, and IPC handlers.
 */
export function isLikelyEmailAuthError(message: string): boolean {
  const m = (message || '').toLowerCase()
  return (
    /not authenticated|authentication failed|unauthorized|invalid_grant|invalid credentials|login failed|auth(?:orization)? failed|401|403|bad credentials|incorrect password|unable to authenticate|eauthentication|no password supplied|application-specific password|app password/i.test(
      m,
    ) ||
    m.includes('eauthentication') ||
    /** German IMAP (web.de / GMX / T-Online) */
    /anmeldung fehlgeschlagen|authentifizierung fehlgeschlagen|ungültige anmeldedaten|ungueltige anmeldedaten|zugriff verweigert|falsches passwort|ungültiges passwort|ungueltiges passwort/i.test(
      m,
    )
  )
}
