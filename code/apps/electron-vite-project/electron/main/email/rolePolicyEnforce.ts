/**
 * Role policy enforcement helpers — logging + throws (Stream B).
 */

import {
  rolePolicy,
  type AccountSummary,
  type RolePolicyDecision,
  type RolePolicyModeSnapshot,
} from '@repo/role-policy'

import { RoleSendForbidden } from './rolePolicyErrors.js'
import {
  accountSummaryForPolicy,
  accountSummaryFromConfig,
  currentRolePolicyModeSnapshot,
} from './rolePolicySnapshot.js'
import type { EmailAccountInfo } from './types.js'

export type FetchBlockedResult = {
  ok: true
  blocked: true
  reason: RolePolicyDecision['reason']
}

function logDecision(
  op: 'fetch' | 'send',
  accountId: string,
  decision: RolePolicyDecision,
): void {
  const payload = { accountId, reason: decision.reason, allowed: decision.allowed }
  if (decision.allowed) {
    console.debug(`[ROLE_POLICY_DECISION] ${op} allowed`, payload)
  } else {
    console.warn(`[ROLE_POLICY_DECISION] ${op} blocked`, payload)
  }
}

export function assertRolePolicyCanFetch(
  account: AccountSummary,
  mode: RolePolicyModeSnapshot = currentRolePolicyModeSnapshot(),
): RolePolicyDecision {
  const decision = rolePolicy.canFetch(account, mode)
  logDecision('fetch', account.id, decision)
  return decision
}

export function assertRolePolicyCanSend(
  account: AccountSummary,
  mode: RolePolicyModeSnapshot = currentRolePolicyModeSnapshot(),
): RolePolicyDecision {
  const decision = rolePolicy.canSend(account, mode)
  logDecision('send', account.id, decision)
  return decision
}

export function enforceFetchPolicyForAccountId(
  accountId: string,
  cfg: { edgeFetch?: { state?: import('./edgeFetch/types.js').EdgeFetchLocalState } } | null,
): FetchBlockedResult | null {
  const decision = assertRolePolicyCanFetch(accountSummaryFromConfig(accountId, cfg))
  if (decision.allowed) return null
  return { ok: true, blocked: true, reason: decision.reason }
}

export function enforceFetchPolicyForAccount(account: EmailAccountInfo): FetchBlockedResult | null {
  const decision = assertRolePolicyCanFetch(accountSummaryForPolicy(account))
  if (decision.allowed) return null
  return { ok: true, blocked: true, reason: decision.reason }
}

export function enforceSendPolicyForAccountId(
  accountId: string,
  cfg: { edgeFetch?: { state?: import('./edgeFetch/types.js').EdgeFetchLocalState } } | null,
): void {
  const decision = assertRolePolicyCanSend(accountSummaryFromConfig(accountId, cfg))
  if (!decision.allowed) {
    throw new RoleSendForbidden(accountId, decision.reason)
  }
}

export function enforceSendPolicyForAccount(account: EmailAccountInfo): void {
  const decision = assertRolePolicyCanSend(accountSummaryForPolicy(account))
  if (!decision.allowed) {
    throw new RoleSendForbidden(account.id, decision.reason)
  }
}
