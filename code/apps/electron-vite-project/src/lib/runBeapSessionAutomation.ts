/**
 * Shared Run Automation handler for native inbox list + detail views.
 */

import type { InboxMessage } from '../stores/useEmailInboxStore'
import { resolveInboxSessionArtefact } from './inboxSessionArtefact'

export type RunBeapSessionAutomationResult =
  | { ok: true; sessionKey?: string; sessionName?: string; executed?: string[] }
  | { ok: false; error: string }

/** Maps raw IPC error codes / strings to user-facing messages with actionable hints. */
function mapAutomationError(raw: string): string {
  if (raw === 'EXTENSION_NOT_CONNECTED') {
    return 'Extension is not connected. Open a web tab with WR enabled, then retry Run Automation.'
  }
  if (raw === 'RUN_AUTOMATION_TIMEOUT') {
    return 'Run Automation timed out. Ensure a normal web tab is active with the extension loaded, then retry.'
  }
  if (raw === 'STORAGE_PERSIST_FAILED') {
    return 'Session could not be saved to local storage. Check available browser storage and retry.'
  }
  if (raw === 'BROADCAST_FAILED' || raw === 'SEND_FAILED') {
    return 'Activation broadcast failed. Open the WR orchestrator browser tab and retry.'
  }
  if (raw === 'NO_SESSION_ARTEFACT' || raw === 'No session artefact on this message') {
    return 'This message has no embedded session. Nothing to run.'
  }
  if (raw === 'Orchestrator bridge unavailable') {
    return 'Orchestrator bridge is unavailable. Restart the app and retry.'
  }
  // Pass through unknown strings — strip any internal prefixes.
  return raw
}

export async function runBeapSessionAutomationForMessage(
  message: InboxMessage,
): Promise<RunBeapSessionAutomationResult> {
  const api = window.orchestrator
  if (!api?.importSessionFromBeap) {
    const err = 'Orchestrator bridge unavailable'
    console.warn(`[BEAP_RUN] error messageId=${message.id} error=${err}`)
    return { ok: false, error: mapAutomationError(err) }
  }

  const { artefact, refs } = resolveInboxSessionArtefact(message)
  if (!artefact || refs.length === 0) {
    const err = 'No session artefact on this message'
    console.warn(`[BEAP_RUN] error messageId=${message.id} error=${err}`)
    return { ok: false, error: mapAutomationError(err) }
  }

  const primary = refs[0]
  const sessionId = primary.sessionId
  const sessionName = primary.sessionName || sessionId

  console.log(`[BEAP_RUN] start messageId=${message.id} sessionId=${sessionId} sessionName=${sessionName}`)

  const result = await api.importSessionFromBeap({
    sessionId,
    sessionName,
    importArtefact: artefact,
    sourceMessageId: message.id,
    handshakeId: message.handshake_id ?? null,
  })

  if (!result?.success) {
    const raw = result?.error || 'Import failed'
    const mapped = mapAutomationError(raw)
    console.warn(`[BEAP_RUN] error messageId=${message.id} sessionId=${sessionId} raw=${raw}`)
    return { ok: false, error: mapped }
  }

  console.log(`[BEAP_RUN] dispatched messageId=${message.id} sessionKey=${result.sessionKey}`)
  return {
    ok: true,
    sessionKey: result.sessionKey,
    sessionName,
    executed: result.executed,
  }
}
