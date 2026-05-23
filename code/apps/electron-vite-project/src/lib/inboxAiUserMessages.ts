/**
 * Maps main-process `inboxErrorCode` + IPC payload to user-facing inbox / BEAP AI strings.
 */

export type InboxAiErrorDebugPayload = {
  lane?: string
  baseUrl?: string
  model?: string
  operation?: string
  failureCode?: string
  inferenceRoutingReason?: string
}

function userMessageForInboxAiCode(
  code: string | undefined,
  payload: { error?: string; message?: string },
): string | null {
  switch (code) {
    case 'no_model_selected':
      return 'Select an AI model first.'
    case 'local_ollama_unreachable': {
      const raw = payload.message ?? ''
      if (raw.includes('circuit open') || raw.includes('repeated timeouts')) {
        // Extract "retries in ~Xm" hint if present so the user knows when to expect recovery.
        const retryHint = raw.match(/retries in ~[^)]+/)?.[0]
        return retryHint
          ? `Local Ollama is temporarily paused after repeated timeouts (${retryHint}).`
          : 'Local Ollama is temporarily paused after repeated timeouts — it will recover automatically.'
      }
      if (raw.includes('GPU inference') || raw.includes('CPU-only') || raw.includes('Inbox AI is disabled')) {
        return 'Inbox AI is paused — GPU inference is unavailable on this device.'
      }
      return 'Local Ollama is not reachable.'
    }
    case 'remote_ollama_unreachable':
      return 'Remote Ollama is not reachable on the host device.'
    case 'beap_endpoint_missing':
      return 'Top-chat BEAP tools are unavailable because the host BEAP endpoint is not advertised. Remote Ollama direct can still be used.'
    case 'generation_failed':
    case 'llm_error': {
      // Surface the backend error detail when it is more specific than the generic label.
      // This covers Ollama API errors (e.g. context length exceeded, model not found) that
      // are not caught by any other classification branch.
      const detail = payload.message?.trim()
      if (detail && detail !== 'AI generation failed for the selected model.' && detail.length < 200) {
        return `AI generation failed: ${detail}`
      }
      return 'AI generation failed for the selected model.'
    }
    case 'inference_routing_unavailable':
      return payload.message?.trim() || 'Inference is not available on this device.'
    case 'database_error':
      return payload.message?.trim() || 'Database error.'
    case 'timeout':
      return 'Analysis timed out. Ollama may be slow or unavailable.'
    default:
      return null
  }
}

/** Stream / analyze error: non-fatal semantic retrieval uses dev-only note; no red banner. */
export function inboxAiAnalyzeStreamErrorDisplay(payload: {
  error?: string
  message?: string
  inboxErrorCode?: string
}): { fatalMessage: string | null; semanticDevNote: string | null } {
  if (payload.error === 'inference_routing_unavailable' && payload.message?.trim()) {
    return { fatalMessage: payload.message.trim(), semanticDevNote: null }
  }
  const code = payload.inboxErrorCode
  if (code === 'semantic_context_unavailable') {
    return {
      fatalMessage: null,
      semanticDevNote: import.meta.env.DEV
        ? 'Semantic context unavailable; continuing without retrieval.'
        : null,
    }
  }
  const msg =
    userMessageForInboxAiCode(code, { error: payload.error, message: payload.message }) ??
    ((payload.message?.trim() ?? '') || 'AI generation failed for the selected model.')
  return { fatalMessage: msg || 'AI generation failed for the selected model.', semanticDevNote: null }
}

export function inboxAiDraftReplyErrorDisplay(res: {
  ok: boolean
  inboxErrorCode?: string
  message?: string
  error?: string
  debug?: InboxAiErrorDebugPayload
}): { userMessage: string; debug?: InboxAiErrorDebugPayload } {
  if (res.ok) return { userMessage: '' }
  const code = res.inboxErrorCode
  const msg =
    userMessageForInboxAiCode(code, { error: res.error, message: res.message }) ??
    ((res.message?.trim() ?? '') || 'AI generation failed for the selected model.')
  return { userMessage: msg || 'AI generation failed for the selected model.', debug: res.debug }
}
