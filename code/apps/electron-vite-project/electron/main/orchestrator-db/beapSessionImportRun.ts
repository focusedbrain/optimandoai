/**
 * Secure BEAP session import + Run Automation dispatch (Electron native inbox).
 *
 * - Re-validates `session_import_artefact` via ingestion-core (validator authority).
 * - Enforces handshake binding when present.
 * - Dispatches execution to the Chromium extension over the localhost WS bridge only
 *   after validation passes — no trusted-read bypass.
 */

import { validateSessionImportArtefact } from '@repo/ingestion-core'
import type { OrchestratorService } from './service'

export const BEAP_DESKTOP_RUN_AUTOMATION_WS_TYPE = 'BEAP_DESKTOP_RUN_AUTOMATION' as const

export type BeapSessionImportRunRequest = {
  sessionId: string
  sessionName: string
  importArtefact: unknown
  sourceMessageId: string
  handshakeId: string | null
}

export type BeapSessionImportRunResult =
  | { success: true; dispatched: boolean }
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
 * Validate artefact and optionally dispatch Run Automation to the extension.
 * Does not persist a duplicate copy — the extension import pipeline owns working-copy storage.
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
    return { success: false, error: 'IMPORT_ONLY_ARTEFACT' }
  }
  if (artefactObj.requested_action !== 'import_and_offer_run') {
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

  // Audit metadata only — never log artefact body (Annex I).
  await deps.orchestrator.connect().catch(() => undefined)
  const auditKey = `beap_import_audit_${req.sourceMessageId.slice(0, 120)}`
  if (auditKey.length <= 512) {
    try {
      await deps.orchestrator.set(auditKey, {
        sourceMessageId: req.sourceMessageId,
        sourceSessionId: req.sessionId,
        sessionName: req.sessionName.slice(0, 500),
        handshakeId: req.handshakeId,
        importedAt: Date.now(),
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

  deps.broadcastToExtensions({
    type: BEAP_DESKTOP_RUN_AUTOMATION_WS_TYPE,
    importData: artefact,
    sourceMessageId: req.sourceMessageId,
    handshakeId: req.handshakeId,
    fallbackModel: 'tinyllama',
  })

  return { success: true, dispatched: true }
}
