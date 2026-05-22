/**
 * Shared Run Automation handler for native inbox list + detail views.
 */

import type { InboxMessage } from '../stores/useEmailInboxStore'
import { resolveInboxSessionArtefact } from './inboxSessionArtefact'

export type RunBeapSessionAutomationResult =
  | { ok: true }
  | { ok: false; error: string }

export async function runBeapSessionAutomationForMessage(
  message: InboxMessage,
): Promise<RunBeapSessionAutomationResult> {
  const api = window.orchestrator
  if (!api?.importSessionFromBeap) {
    return { ok: false, error: 'Orchestrator bridge unavailable' }
  }

  const { artefact, refs } = resolveInboxSessionArtefact(message)
  if (!artefact || refs.length === 0) {
    return { ok: false, error: 'No session artefact on this message' }
  }

  const primary = refs[0]
  const sessionId = primary.sessionId
  const sessionName = primary.sessionName || sessionId

  const result = await api.importSessionFromBeap({
    sessionId,
    sessionName,
    importArtefact: artefact,
    sourceMessageId: message.id,
    handshakeId: message.handshake_id ?? null,
  })

  if (!result?.success) {
    const err = result?.error || 'Import failed'
    if (err === 'EXTENSION_NOT_CONNECTED') {
      return {
        ok: false,
        error:
          'Chromium extension is not connected. Open a web tab with WR enabled, then retry Run Automation.',
      }
    }
    return { ok: false, error: err }
  }

  return { ok: true }
}
