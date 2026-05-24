/**
 * Edge fetch IPC — per-account migration UI (P4.5.7).
 */

import { ipcMain } from 'electron'
import { assertNoSecretsInRendererPayload } from '../../wizard/handlers.js'
import type { EdgeTierPodVault } from '../../edge-tier/podLifecycle.js'
import {
  migrateAccountBackToDesktop,
  migrateAccountToEdge,
  reauthorizeEdgeAccount,
  initEdgeFetchMigration,
} from './migration.js'
import { resolveEdgeFetchEligibility, edgeFetchEligibilityForAccount } from './eligibility.js'
import { buildEdgeFetchSnapshots } from './snapshots.js'
import { manualRefreshEdgeFetchStatus } from './supervisorPoll.js'
import { emailGateway } from '../gateway.js'
import type { EdgeFetchMigrationInput } from './types.js'

export function initEdgeFetchIpc(vault: EdgeTierPodVault): void {
  initEdgeFetchMigration(vault)
}

function parseSshPort(raw: unknown): number {
  if (typeof raw === 'number' && raw > 0 && raw <= 65535) return raw
  if (typeof raw === 'string' && raw.trim()) {
    const n = parseInt(raw.trim(), 10)
    if (n > 0 && n <= 65535) return n
  }
  return 22
}

function parseMigrationInput(raw: unknown): EdgeFetchMigrationInput {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid payload')
  const o = raw as Record<string, unknown>
  const accountId = typeof o.accountId === 'string' ? o.accountId.trim() : ''
  const replicaId = typeof o.replicaId === 'string' ? o.replicaId.trim() : ''
  const sshUser = typeof o.sshUser === 'string' ? o.sshUser.trim() : ''
  const sshKey = typeof o.sshKey === 'string' ? o.sshKey : ''
  if (!accountId || !replicaId || !sshUser || !sshKey.trim()) {
    throw new Error('accountId, replicaId, sshUser, and sshKey are required')
  }
  return {
    accountId,
    replicaId,
    sshUser,
    sshPort: parseSshPort(o.sshPort),
    sshKey,
    passphrase: typeof o.passphrase === 'string' && o.passphrase ? o.passphrase : undefined,
  }
}

export function registerEdgeFetchIpcHandlers(): void {
  ipcMain.handle('email:edgeFetch:getEligibility', async () => {
    try {
      const eligibility = await resolveEdgeFetchEligibility()
      assertNoSecretsInRendererPayload(eligibility)
      return { ok: true, data: eligibility }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('email:edgeFetch:getSnapshots', async () => {
    try {
      const data = buildEdgeFetchSnapshots()
      return { ok: true, data }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('email:edgeFetch:migrateToEdge', async (_e, raw: unknown) => {
    try {
      const input = parseMigrationInput(raw)
      const account = await emailGateway.getAccount(input.accountId)
      if (!account) return { ok: false, error: 'Account not found' }
      const eligibility = await resolveEdgeFetchEligibility()
      const gate = edgeFetchEligibilityForAccount(account, eligibility)
      if (!gate.allowed) return { ok: false, error: gate.reason ?? 'Not eligible' }
      await migrateAccountToEdge(input)
      return { ok: true, data: buildEdgeFetchSnapshots() }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('email:edgeFetch:migrateBack', async (_e, raw: unknown) => {
    try {
      const input = parseMigrationInput(raw)
      await migrateAccountBackToDesktop(input)
      return { ok: true, data: buildEdgeFetchSnapshots() }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('email:edgeFetch:reauthorize', async (_e, raw: unknown) => {
    try {
      const input = parseMigrationInput(raw)
      await reauthorizeEdgeAccount(input)
      return { ok: true, data: buildEdgeFetchSnapshots() }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('email:edgeFetch:refreshStatus', async (_e, raw: unknown) => {
    try {
      const input = parseMigrationInput(raw)
      await manualRefreshEdgeFetchStatus(input)
      return { ok: true, data: buildEdgeFetchSnapshots() }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  console.log(
    '[Email IPC] Registered edge fetch handlers: email:edgeFetch:getEligibility, getSnapshots, migrateToEdge, migrateBack, reauthorize, refreshStatus',
  )
}
