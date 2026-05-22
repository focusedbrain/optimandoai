/**
 * Secure BEAP session import + Run Automation dispatch (Electron native inbox).
 *
 * - Re-validates `session_import_artefact` via ingestion-core (validator authority).
 * - Enforces handshake binding when present.
 * - Unwraps artefact → tab-import shape before extension dispatch.
 * - Persists working copy to orchestrator KV before run.
 * - Waits for extension execution result when waiter is configured.
 */

import { validateSessionImportArtefact } from '@repo/ingestion-core'
import type { OrchestratorService } from './service'
import {
  newBeapImportSessionKey,
  unwrapSessionImportPayloadForTab,
} from './sessionImportArtefactUnwrap'
import type { BeapRunAutomationWaitResult } from './beapRunAutomationWaiter'
import { registerBeapRunAutomationWaiter } from './beapRunAutomationWaiter'

export const BEAP_DESKTOP_RUN_AUTOMATION_WS_TYPE = 'BEAP_DESKTOP_RUN_AUTOMATION' as const
export const BEAP_DESKTOP_RUN_AUTOMATION_RESULT_WS_TYPE =
  'BEAP_DESKTOP_RUN_AUTOMATION_RESULT' as const

export type BeapSessionImportRunRequest = {
  sessionId: string
  sessionName: string
  importArtefact: unknown
  sourceMessageId: string
  handshakeId: string | null
}

export type BeapSessionImportRunResult =
  | { success: true; dispatched: boolean; sessionKey?: string; executed?: string[] }
  | { success: false; error: string }

export type BeapSessionImportRunDeps = {
  orchestrator: OrchestratorService
  broadcastToExtensions: (message: Record<string, unknown>) => void
  extensionClientCount: () => number
  /** When set, blocks until extension reports run outcome (or timeout). */
  waitForRunAutomationResult?: (
    requestId: string,
    timeoutMs: number,
  ) => Promise<BeapRunAutomationWaitResult>
}

function readHandshakeIdFromBinding(binding: unknown): string | null {
  if (binding == null || typeof binding !== 'object' || Array.isArray(binding)) return null
  const id = (binding as Record<string, unknown>).handshake_id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

function newRequestId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `beap_run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  }
}

/**
 * Validate artefact, persist working copy, dispatch Run Automation to extension, await result.
 */
export async function importAndRunBeapSessionFromArtefact(
  req: BeapSessionImportRunRequest,
  deps: BeapSessionImportRunDeps,
): Promise<BeapSessionImportRunResult> {
  if (!req.sourceMessageId.trim()) {
    return { success: false, error: 'MISSING_SOURCE_MESSAGE' }
  }
  if (!req.sessionId.trim()) {
    return { success: false, error: 'MISSING_SESSION_ID' }
  }

  const artefact = req.importArtefact
  if (artefact == null || typeof artefact !== 'object' || Array.isArray(artefact)) {
    return { success: false, error: 'INVALID_ARTEFACT' }
  }

  const validation = validateSessionImportArtefact(artefact)
  if (!validation.success) {
    return {
      success: false,
      error: validation.reason ?? 'ARTEFACT_VALIDATION_FAILED',
    }
  }

  const artefactObj = artefact as Record<string, unknown>
  if (artefactObj.requested_action === 'import_only') {
    // Explicit Run Automation click is user consent to import + execute anyway.
  } else if (artefactObj.requested_action !== 'import_and_offer_run') {
    return { success: false, error: 'UNSUPPORTED_REQUESTED_ACTION' }
  }

  const boundHandshakeId = readHandshakeIdFromBinding(artefactObj.handshake_binding)
  if (boundHandshakeId) {
    if (!req.handshakeId?.trim()) {
      return { success: false, error: 'HANDSHAKE_BINDING_REQUIRES_CONTEXT' }
    }
    if (boundHandshakeId !== req.handshakeId.trim()) {
      return { success: false, error: 'HANDSHAKE_BINDING_MISMATCH' }
    }
  }

  const unwrapped = unwrapSessionImportPayloadForTab(artefact)
  if (!unwrapped.ok) {
    return { success: false, error: unwrapped.reason }
  }

  const sessionKey = newBeapImportSessionKey()
  const tabPayload = {
    ...unwrapped.payload,
    tabName:
      typeof unwrapped.payload.tabName === 'string' && unwrapped.payload.tabName.trim()
        ? unwrapped.payload.tabName
        : req.sessionName || 'Imported Session',
    isLocked: true,
    lastOpenedAt: new Date().toISOString(),
    beapImportSourceMessageId: req.sourceMessageId,
    beapImportSourceSessionId: req.sessionId,
  }

  await deps.orchestrator.connect().catch(() => undefined)

  try {
    await deps.orchestrator.set(sessionKey, tabPayload)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { success: false, error: `ORCHESTRATOR_PERSIST_FAILED: ${msg}` }
  }

  const auditKey = `beap_import_audit_${req.sourceMessageId.slice(0, 120)}`
  if (auditKey.length <= 512) {
    try {
      await deps.orchestrator.set(auditKey, {
        sourceMessageId: req.sourceMessageId,
        sourceSessionId: req.sessionId,
        sessionName: req.sessionName.slice(0, 500),
        handshakeId: req.handshakeId,
        importedAt: Date.now(),
        workingSessionKey: sessionKey,
        artefactId:
          typeof artefactObj.artefact_id === 'string' ? artefactObj.artefact_id : undefined,
      })
    } catch {
      /* non-fatal audit write */
    }
  }

  if (deps.extensionClientCount() <= 0) {
    return { success: false, error: 'EXTENSION_NOT_CONNECTED' }
  }

  const requestId = newRequestId()
  const waitForResult =
    deps.waitForRunAutomationResult ??
    ((id: string, ms: number) => registerBeapRunAutomationWaiter(id, ms))

  const resultPromise = waitForResult(requestId, 120_000)

  deps.broadcastToExtensions({
    type: BEAP_DESKTOP_RUN_AUTOMATION_WS_TYPE,
    requestId,
    sessionKey,
    importData: tabPayload,
    sourceMessageId: req.sourceMessageId,
    handshakeId: req.handshakeId,
    fallbackModel: 'tinyllama',
  })

  const exec = await resultPromise
  if (!exec.ok) {
    return { success: false, error: exec.error ?? 'RUN_AUTOMATION_FAILED' }
  }

  return {
    success: true,
    dispatched: true,
    sessionKey: exec.sessionKey ?? sessionKey,
    executed: exec.executed,
  }
}
