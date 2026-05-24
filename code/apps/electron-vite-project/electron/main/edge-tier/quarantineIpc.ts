/**
 * Quarantine dashboard IPC — P5.6.
 */

import { ipcMain } from 'electron'
import type { EdgeTierPodVault } from './podLifecycle.js'
import { assertNoSecretsInRendererPayload } from '../wizard/handlers.js'
import {
  buildQuarantineDashboardSummary,
  listQuarantineItems,
  prepareSandboxViewPayload,
  type SandboxPrepareMode,
} from './quarantineDashboard.js'
import { discardQuarantineEntry, parseDiscardQuarantinePayload } from './quarantineDiscard.js'
import { notifyDashboardUpdated } from './dashboard.js'

let _vault: EdgeTierPodVault | null = null

export function initQuarantineDashboardIpc(vault: EdgeTierPodVault): void {
  _vault = vault
}

function getVault(): EdgeTierPodVault {
  if (!_vault) {
    throw new Error('Quarantine dashboard IPC not initialized — vault unavailable')
  }
  return _vault
}

function parseSandboxMode(raw: unknown): SandboxPrepareMode {
  if (raw === 'diagnostic_report' || raw === 'raw_email_body') {
    return raw
  }
  throw new Error('mode: expected diagnostic_report or raw_email_body')
}

export function registerQuarantineDashboardIpcHandlers(): void {
  ipcMain.handle('dashboard:getQuarantineSummary', async () => buildQuarantineDashboardSummary())

  ipcMain.handle('dashboard:listQuarantine', async (_event, replicaId?: unknown) => {
    const id = typeof replicaId === 'string' && replicaId.length > 0 ? replicaId : undefined
    return listQuarantineItems(id)
  })

  ipcMain.handle('dashboard:prepareSandboxView', async (_event, raw: unknown) => {
    assertNoSecretsInRendererPayload(raw)
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('Invalid prepareSandboxView input')
    }
    const o = raw as Record<string, unknown>
    const mode = parseSandboxMode(o.mode)
    const replicaId = o.replicaId
    const hash = o.hash
    if (typeof replicaId !== 'string' || replicaId.length === 0 || replicaId.length > 200) {
      throw new Error('replicaId: expected non-empty string')
    }
    if (typeof hash !== 'string' || hash.length === 0 || hash.length > 128) {
      throw new Error('hash: expected non-empty string')
    }
    return prepareSandboxViewPayload(mode, replicaId, hash, getVault())
  })

  ipcMain.handle('dashboard:discardQuarantine', async (_event, raw: unknown) => {
    assertNoSecretsInRendererPayload(raw)
    const input = parseDiscardQuarantinePayload(raw)
    const result = await discardQuarantineEntry(input, getVault())
    if (result.ok) {
      notifyDashboardUpdated()
    }
    return result
  })

  console.log(
    '[MAIN] IPC handlers registered: dashboard:getQuarantineSummary, dashboard:listQuarantine, dashboard:prepareSandboxView, dashboard:discardQuarantine',
  )
}
