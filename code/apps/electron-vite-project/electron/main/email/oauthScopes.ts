/**
 * Prompt 2 — per-node OAuth scope split (the A2 model).
 *
 * Each fetching node runs its OWN OAuth client with a narrow scope; tokens never
 * cross the handshake (INV-2). This module is the single source of truth for the
 * scope sets, so the split is auditable in one place.
 *
 *   role 'send' → HOST: can ONLY send. No read, no modify.
 *   role 'read' → SANDBOX: can ONLY read. No send, no modify. (Ingestion node.)
 *   role 'all'  → SINGLE-MACHINE legacy/inert-courier: one client that both
 *                 fetches (opaque) and sends. Unchanged from before Prompt 2.
 *
 * The split applies to the MULTI-MACHINE / appliance A2 path. Single-machine
 * inert ingestion (Prompt 1) keeps using ONE 'all' client and is byte-identical.
 *
 * Invariants enforced here (and asserted by oauthScopes.test.ts):
 *   - the 'read' set contains NO send and NO modify/write scope;
 *   - the 'send' set contains NO read scope;
 *   - 'all' is a strict superset that preserves the pre-split bundle.
 *
 * IMAP is not OAuth: the host uses the SMTP-send credential and the sandbox uses
 * the IMAP-read credential (already split in `EmailAccountConfig.smtp` / `.imap`).
 * `imapCredentialFieldForRole` maps a role to the credential it may use.
 */

export type OAuthScopeRole = 'send' | 'read' | 'all'
export type ScopedProvider = 'gmail' | 'microsoft365' | 'imap'

// ── Gmail ────────────────────────────────────────────────────────────────────

const GMAIL_READONLY = 'https://www.googleapis.com/auth/gmail.readonly'
const GMAIL_MODIFY = 'https://www.googleapis.com/auth/gmail.modify'
const GMAIL_SEND = 'https://www.googleapis.com/auth/gmail.send'

/** SANDBOX (ingestion): read-only. `gmail.send` automatically files into Sent, so
 *  the read client never needs send or modify. */
export const GMAIL_READ_SCOPES: readonly string[] = [GMAIL_READONLY]

/** HOST (multi-machine A2): send only. `gmail.send` does NOT require `gmail.modify`
 *  — Gmail files the sent copy server-side — so no modify scope is requested. */
export const GMAIL_SEND_SCOPES: readonly string[] = [GMAIL_SEND]

/** SINGLE-MACHINE / legacy bundle (pre-Prompt-2 behavior, unchanged). */
export const GMAIL_ALL_SCOPES: readonly string[] = [GMAIL_READONLY, GMAIL_MODIFY, GMAIL_SEND]

// ── Outlook / Microsoft Graph ─────────────────────────────────────────────────

/** Identity + refresh scopes required by EVERY Graph flow regardless of role. */
const OUTLOOK_BASE_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'https://graph.microsoft.com/User.Read',
] as const

const GRAPH_MAIL_READ = 'https://graph.microsoft.com/Mail.Read'
const GRAPH_MAIL_READWRITE = 'https://graph.microsoft.com/Mail.ReadWrite'
const GRAPH_MAIL_SEND = 'https://graph.microsoft.com/Mail.Send'

/** SANDBOX (ingestion): Mail.Read only — no send, no write. */
export const OUTLOOK_READ_SCOPES: readonly string[] = [...OUTLOOK_BASE_SCOPES, GRAPH_MAIL_READ]

/** HOST (multi-machine A2): Mail.Send only — no read, no write. */
export const OUTLOOK_SEND_SCOPES: readonly string[] = [...OUTLOOK_BASE_SCOPES, GRAPH_MAIL_SEND]

/** SINGLE-MACHINE / legacy bundle (pre-Prompt-2 behavior, unchanged). */
export const OUTLOOK_ALL_SCOPES: readonly string[] = [
  ...OUTLOOK_BASE_SCOPES,
  GRAPH_MAIL_READ,
  GRAPH_MAIL_READWRITE,
  GRAPH_MAIL_SEND,
]

// ── Resolver ──────────────────────────────────────────────────────────────────

/**
 * Resolve the OAuth scope set for a provider + role. `role` defaults to 'all' so
 * existing single-machine connect paths are unchanged unless they explicitly opt
 * into the narrow split.
 */
export function resolveOAuthScopes(provider: 'gmail' | 'microsoft365', role: OAuthScopeRole = 'all'): readonly string[] {
  if (provider === 'gmail') {
    return role === 'read' ? GMAIL_READ_SCOPES : role === 'send' ? GMAIL_SEND_SCOPES : GMAIL_ALL_SCOPES
  }
  // microsoft365
  return role === 'read' ? OUTLOOK_READ_SCOPES : role === 'send' ? OUTLOOK_SEND_SCOPES : OUTLOOK_ALL_SCOPES
}

/** Space-joined scope string for an authorize/token request. */
export function resolveOAuthScopeString(provider: 'gmail' | 'microsoft365', role: OAuthScopeRole = 'all'): string {
  return resolveOAuthScopes(provider, role).join(' ')
}

// ── IMAP role→credential mapping ──────────────────────────────────────────────

/**
 * IMAP has no OAuth scopes: the host's send capability is the SMTP credential and
 * the sandbox's read capability is the IMAP credential. The role determines which
 * credential field a node is allowed to use; the other must be absent on that node.
 */
export function imapCredentialFieldForRole(role: OAuthScopeRole): 'smtp' | 'imap' | 'both' {
  return role === 'send' ? 'smtp' : role === 'read' ? 'imap' : 'both'
}

// ── Scope-isolation assertions (used at consent time + in tests) ──────────────

const SEND_SCOPE_MATCHER = /(gmail\.send|mail\.send)/i
const READ_SCOPE_MATCHER = /(gmail\.readonly|gmail\.modify|mail\.read|mail\.readwrite)/i
const MODIFY_WRITE_MATCHER = /(gmail\.modify|mail\.readwrite)/i

/** True iff any scope in the set grants the ability to SEND mail. */
export function scopeSetCanSend(scopes: readonly string[]): boolean {
  return scopes.some((s) => SEND_SCOPE_MATCHER.test(s))
}

/** True iff any scope in the set grants the ability to READ mailbox content. */
export function scopeSetCanRead(scopes: readonly string[]): boolean {
  return scopes.some((s) => READ_SCOPE_MATCHER.test(s))
}

/** True iff any scope in the set grants modify/write (mutating mailbox state). */
export function scopeSetCanModify(scopes: readonly string[]): boolean {
  return scopes.some((s) => MODIFY_WRITE_MATCHER.test(s))
}
