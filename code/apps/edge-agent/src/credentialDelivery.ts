import { parseAccountKeyHex, zeroizeBuffer } from '@repo/email-fetch'

import { decryptAtRest } from './accountAtRest.js'
import { mailFetcherLocalRequest } from './mailFetcherLocal.js'
import type { AgentStorage, AgentStoredAccount } from './storage.js'

function emit(event: string, fields: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: 'info', source: 'credential-delivery', event, ...fields }))
}

async function deliverOneAccount(
  podAuthSecret: string,
  account: AgentStoredAccount,
  storage: AgentStorage,
): Promise<void> {
  let accountKeyHex = ''
  try {
    accountKeyHex = await decryptAtRest(storage, account.accountKeyEncB64)
    const keyBuf = parseAccountKeyHex(accountKeyHex)
    try {
      const start = await mailFetcherLocalRequest(podAuthSecret, 'POST', '/accounts/start', {
        account_id: account.accountId,
        provider: account.provider,
        encrypted_bundle: account.encryptedBundle,
        wrapped_account_key: account.wrappedAccountKey ?? '',
      })
      if (start.status !== 200) {
        throw new Error(String(start.json.error ?? `start failed (${start.status})`))
      }

      const deliver = await mailFetcherLocalRequest(podAuthSecret, 'POST', '/accounts/deliver_key', {
        account_id: account.accountId,
        account_key: accountKeyHex,
      })
      if (deliver.status !== 200) {
        throw new Error(String(deliver.json.error ?? `deliver_key failed (${deliver.status})`))
      }
    } finally {
      zeroizeBuffer(keyBuf)
    }
  } finally {
    accountKeyHex = ''
  }
}

export async function deliverAllAccountsToMailFetcher(
  storage: AgentStorage,
  podAuthSecret: string | null,
): Promise<void> {
  if (!podAuthSecret?.trim()) {
    emit('delivery_skipped', { reason: 'no_pod_auth_secret' })
    return
  }
  const state = await storage.loadState()
  const accounts = Object.values(state.accounts ?? {})
  if (accounts.length === 0) {
    emit('delivery_skipped', { reason: 'no_accounts' })
    return
  }

  for (const account of accounts) {
    try {
      await deliverOneAccount(podAuthSecret, account, storage)
      emit('account_delivered', { account_id: account.accountId })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      emit('account_delivery_failed', { account_id: account.accountId, message })
      const next = await storage.loadState()
      const row = next.accounts?.[account.accountId]
      if (row) {
        row.lastError = message
        row.lastRemoteState = 'degraded'
        await storage.saveState(next)
      }
    }
  }
}

export async function pollMailFetcherAccountStatus(
  podAuthSecret: string,
): Promise<Array<Record<string, unknown>>> {
  const res = await mailFetcherLocalRequest(podAuthSecret, 'GET', '/accounts/status')
  if (res.status !== 200) return []
  const accounts = res.json.accounts
  return Array.isArray(accounts) ? (accounts as Array<Record<string, unknown>>) : []
}
