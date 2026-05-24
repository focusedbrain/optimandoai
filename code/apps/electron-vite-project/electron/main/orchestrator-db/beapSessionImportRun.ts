/**
 * Secure BEAP session import + Run Automation dispatch (Electron native inbox).
 *
 * - Re-validates `session_import_artefact` via ingestion-core (validator authority).
 * - Enforces handshake binding when present.
 * - Unwraps artefact → tab-import shape before extension dispatch.
 * - Persists working copy to orchestrator KV before run.
 * - Broadcasts PRESENT_ORCHESTRATOR_DISPLAY_GRID — the same pipeline used by the
 *   dashboard and session-history row — so activation is tab-focus-independent.
 */

import { validateSessionImportArtefact } from '@repo/ingestion-core'
import type { OrchestratorService } from './service'
import {
  newBeapImportSessionKey,
  unwrapSessionImportPayloadForTab,
} from './sessionImportArtefactUnwrap'

/** @deprecated Electron no longer sends this — kept for old-build backward compat references only. */
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
}

function readHandshakeIdFromBinding(binding: unknown): string | null {
  if (binding == null || typeof binding !== 'object' || Array.isArray(binding)) return null
  const id = (binding as Record<string, unknown>).handshake_id
  return typeof id === 'string' && id.trim() ? id.trim() : null
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
    sessionOrigin: 'beap_import' as const,
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

  // Use the same pipeline as the dashboard and session-history row:
  // broadcast PRESENT_ORCHESTRATOR_DISPLAY_GRID with the full session blob so
  // background.ts mirrors it to chrome.storage.local and calls
  // maybePresentOrchestratorDisplayGridSession — no active-tab query involved.
  deps.broadcastToExtensions({
    type: 'PRESENT_ORCHESTRATOR_DISPLAY_GRID',
    sessionKey,
    session: tabPayload,
    source: 'beap-inbox',
    fallbackModel: 'tinyllama',
  })

  return {
    success: true,
    dispatched: true,
    sessionKey,
  }
}
