/**
 * A2 display-layer dedupe: one mailbox (normalized email + provider) → one list/selectbox row.
 *
 * Identity key: `${provider}::${normalizedEmail}` (email trimmed + lowercased).
 *
 * Tie-break when multiple gateway rows share a key (deterministic):
 *   1. Prefer the row with a gateway oauth/bundled record (`config.oauth` on disk) — the
 *      canonical send/displayable account identity on host.
 *   2. Else prefer the row with a role-scoped read token (sandbox read client).
 *   3. On sandbox nodes, deprioritize a bundled-oauth send row when a sibling has a read token
 *      (never surface a separately-selectable write/send duplicate).
 *   4. Prefer `active` status, then newer `updatedAt`.
 *
 * A1 (one row per mailbox with scope as attribute) is deferred — see email/DEFERRED.md.
 */

import type { EmailAccountConfig, EmailAccountInfo } from '../types'

export type MailboxProvider = EmailAccountConfig['provider']

export type RoleTokenProbe = (accountId: string) => { read: boolean; send: boolean }

export function normalizeMailboxEmail(email: string | undefined | null): string {
  return (email || '').trim().toLowerCase()
}

/** Returns null when email is empty — such rows are not grouped by mailbox identity. */
export function mailboxIdentityKey(
  email: string | undefined | null,
  provider: string | undefined | null,
): string | null {
  const norm = normalizeMailboxEmail(email)
  const p = (provider || '').trim().toLowerCase()
  if (!norm || !p) return null
  return `${p}::${norm}`
}

function hasBundledOauth(config: Pick<EmailAccountConfig, 'oauth'>): boolean {
  return config.oauth != null && typeof config.oauth === 'object'
}

function scoreMailboxRow(
  config: EmailAccountConfig,
  tokens: { read: boolean; send: boolean },
  opts: { isSandbox?: boolean },
): number {
  let score = 0
  const bundled = hasBundledOauth(config)
  if (bundled) score += 100
  if (tokens.read && !bundled) score += 60
  if (tokens.send && !bundled) score += 40
  // Sandbox: bundled send-only ghost from role-split era loses to read-capable sibling.
  if (opts.isSandbox && bundled && !tokens.read) score -= 80
  if (config.status === 'active') score += 5
  if (typeof config.updatedAt === 'number') score += config.updatedAt / 1e15
  return score
}

/**
 * Pick the single surviving row for a mailbox identity group.
 */
export function pickMailboxWinnerRow(
  rows: EmailAccountConfig[],
  tokenProbe: RoleTokenProbe,
  opts: { isSandbox?: boolean } = {},
): EmailAccountConfig {
  if (rows.length === 1) return rows[0]
  return rows.reduce((best, row) => {
    const bestScore = scoreMailboxRow(best, tokenProbe(best.id), opts)
    const rowScore = scoreMailboxRow(row, tokenProbe(row.id), opts)
    return rowScore > bestScore ? row : best
  })
}

export function dedupeMailboxConfigsForDisplay(
  accounts: EmailAccountConfig[],
  tokenProbe: RoleTokenProbe,
  opts: { isSandbox?: boolean } = {},
): EmailAccountConfig[] {
  const unkeyed: EmailAccountConfig[] = []
  const groups = new Map<string, EmailAccountConfig[]>()

  for (const acc of accounts) {
    const key = mailboxIdentityKey(acc.email, acc.provider)
    if (!key) {
      unkeyed.push(acc)
      continue
    }
    const list = groups.get(key) ?? []
    list.push(acc)
    groups.set(key, list)
  }

  const winners: EmailAccountConfig[] = []
  for (const group of groups.values()) {
    winners.push(pickMailboxWinnerRow(group, tokenProbe, opts))
  }

  return [...winners, ...unkeyed]
}

export function dedupeMailboxInfosForDisplay(
  accounts: EmailAccountInfo[],
  tokenProbe: RoleTokenProbe,
  opts: { isSandbox?: boolean } = {},
): EmailAccountInfo[] {
  const asConfig = accounts as unknown as EmailAccountConfig[]
  const deduped = dedupeMailboxConfigsForDisplay(asConfig, tokenProbe, opts)
  return deduped as unknown as EmailAccountInfo[]
}

export interface MailboxDuplicateGroup {
  key: string
  winner: EmailAccountConfig
  losers: EmailAccountConfig[]
}

export function findDuplicateMailboxGroups(
  accounts: EmailAccountConfig[],
  tokenProbe: RoleTokenProbe,
  opts: { isSandbox?: boolean } = {},
): MailboxDuplicateGroup[] {
  const groups = new Map<string, EmailAccountConfig[]>()
  for (const acc of accounts) {
    const key = mailboxIdentityKey(acc.email, acc.provider)
    if (!key) continue
    const list = groups.get(key) ?? []
    list.push(acc)
    groups.set(key, list)
  }

  const out: MailboxDuplicateGroup[] = []
  for (const [key, rows] of groups) {
    if (rows.length <= 1) continue
    const winner = pickMailboxWinnerRow(rows, tokenProbe, opts)
    out.push({ key, winner, losers: rows.filter((r) => r.id !== winner.id) })
  }
  return out
}

/**
 * Connect-time dedupe: normalized email+provider match, or a single empty-email orphan per provider.
 */
export function findExistingMailboxAccountInList(
  accounts: EmailAccountConfig[],
  provider: MailboxProvider,
  email: string,
): EmailAccountConfig | undefined {
  const norm = normalizeMailboxEmail(email)
  if (norm) {
    const exact = accounts.find(
      (a) => a.provider === provider && normalizeMailboxEmail(a.email) === norm,
    )
    if (exact) return exact
  }
  const emptyRows = accounts.filter((a) => a.provider === provider && !normalizeMailboxEmail(a.email))
  if (emptyRows.length === 1) return emptyRows[0]
  return undefined
}
