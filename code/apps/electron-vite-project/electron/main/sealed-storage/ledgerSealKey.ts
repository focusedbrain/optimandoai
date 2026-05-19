import { createHmac } from 'crypto'

/**
 * Fixed context string that binds the derived key to sealed inbox storage.
 * Different from the ledger DB key's info string ('beap-handshake-ledger-v1'),
 * ensuring the two keys are cryptographically independent even though they
 * share the same source material.
 */
const LEDGER_SEAL_KEY_INFO = 'ledger-seal-key-v1'

/**
 * Derive the ledger seal key from the SSO session token.
 *
 * Pure function: same input → same output. The session token used here must be
 * stable across bearer-token refreshes within a single login session — use the
 * output of `buildLedgerSessionToken(sub, iss)` (a SHA-256 hash of the stable
 * OIDC subject + issuer), NOT a rotating access token.
 *
 * Different login sessions produce different keys, so rows sealed under one
 * session are unreadable after re-login with a new session identity. This
 * matches the outer-vault lifecycle: the outer provider is unbound on SSO
 * logout (closeLedger), so stale rows are never silently decrypted under a
 * new session's key.
 */
export function deriveLedgerSealKey(sessionToken: string): Buffer {
  return createHmac('sha256', sessionToken)
    .update(LEDGER_SEAL_KEY_INFO)
    .digest()
}
