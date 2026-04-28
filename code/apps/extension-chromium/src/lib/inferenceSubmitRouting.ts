/**
 * Host vs local vs cloud chat submit: shared formatting and IPC resolution (WR Chat + orchestrator top chat).
 * Do not log prompt/result here.
 */

import { isHostInferenceRouteId, parseAnyHostInferenceModelId } from './hostInferenceRouteIds'

/** Dashboard / top chat: Host AI row (route id or `hostAi` / `section: host`). */
export function isHostInternalChatModelId(
  modelId: string,
  available?: ReadonlyArray<{ name: string; hostAi?: boolean; section?: 'local' | 'host' | 'cloud' }>,
): boolean {
  if (isHostInferenceRouteId(modelId)) return true
  const row = available?.find((m) => m.name === modelId)
  return row?.hostAi === true || row?.section === 'host'
}

export type ChatInferenceKind = 'local_ollama' | 'host_internal' | 'cloud'

type AvailableOrchestratorModel = { id: string; type: 'local' | 'cloud' | 'host_internal' }

/** Orchestrator `getAvailableModels` rows — `local` = Ollama, `cloud` = API providers. */
export function resolveChatInferenceKind(
  selectedModel: string,
  availableModels: AvailableOrchestratorModel[],
): ChatInferenceKind {
  if (!selectedModel) return 'local_ollama'
  if (isHostInferenceRouteId(selectedModel)) return 'host_internal'
  const m = availableModels.find((x) => x.id === selectedModel)
  if (m?.type === 'host_internal') return 'host_internal'
  if (m?.type === 'cloud') return 'cloud'
  return 'local_ollama'
}

export function formatInternalInferenceErrorCode(
  code: string | undefined,
  messageFallback?: string,
): string {
  const c = (code ?? '').trim()
  const M: Record<string, string> = {
    HOST_INFERENCE_DISABLED:
      'That model is turned off on your Host. On the Host machine, enable AI in settings, or ask your admin.',
    HOST_DIRECT_P2P_UNAVAILABLE:
      'Host AI · P2P unavailable. The Host could not be reached on the current path. Check that the Host is online, then try again, or pick another model here.',
    HOST_NO_ACTIVE_LOCAL_LLM:
      'Host AI · no active model. On the Host, pick an active local Ollama model, then try again, or choose another model here.',
    MODEL_UNAVAILABLE:
      'Host AI · no active model, or the chosen model is missing on the Host. On the Host, pick a working model, or choose another model here.',
    PROVIDER_TIMEOUT: 'The model on your Host took too long. Try a shorter message or a different model.',
    PROVIDER_UNAVAILABLE: 'The model software on your Host (for example Ollama) is not running or not reachable. Check the Host machine.',
    REQUEST_TIMEOUT: 'The request to your Host timed out. Try again.',
    PAYLOAD_TOO_LARGE: 'The request is too large for this model. Shorten the message or remove attachments.',
    POLICY_FORBIDDEN:
      "This request isn't allowed for the Host model you selected. Try a different model or check settings on the Host.",
    OLLAMA_UNAVAILABLE: 'Ollama is not running or not reachable on your Host. Start it on the Host machine and try again.',
    PROBE_AUTH_REJECTED: 'Authentication failed. Re-pair to refresh tokens.',
    PROBE_RATE_LIMITED: 'Host is throttling requests. Try again in a moment.',
    PROBE_HOST_ERROR: 'Host orchestrator returned an error.',
    PROBE_HOST_UNREACHABLE: "Host machine isn't reachable on the network.",
    PROBE_INVALID_RESPONSE: "Host responded but the format wasn't recognized.",
    PROBE_TRANSPORT_NOT_READY:
      'Host AI is still connecting. Wait a moment, use Refresh (↻) in the model menu, or pick another model.',
    PROBE_NO_MODELS: 'Host has no AI models installed.',
    PROBE_OLLAMA_UNAVAILABLE: "Host's local AI provider isn't running.",
    MALFORMED_SERVICE_MESSAGE: 'The request could not be sent. Try again or restart the app.',
    SERVICE_RPC_NOT_SUPPORTED:
      'Host AI · P2P unavailable. Check that the Host is online, on a reachable path, and that firewalls or VPN allow the connection, then try again.',
    INTERNAL_INFERENCE_FAILED: 'The Host could not run this request. Try again or pick a different model.',
    RATE_LIMITED: 'Too many requests to your Host. Wait a moment and try again.',
    REQUEST_EXPIRED: 'The request expired. Try again.',
    PROVIDER_BUSY: 'The model on your Host is busy. Try again in a few seconds.',
    NO_ACTIVE_INTERNAL_HOST_HANDSHAKE: 'No Host is paired for this account. In Settings, pair a Host, then select a Host model again here.',
    OLLAMA_DIRECT_INVALID_ENDPOINT:
      'Host AI · LAN Ollama address is missing or invalid. Refresh Host capabilities or check pairing.',
    OLLAMA_DIRECT_CHAT_UNREACHABLE:
      "Host AI · could not reach your Host's Ollama on the LAN. Check the network and that Ollama is running on the Host.",
    OLLAMA_DIRECT_MODEL_NOT_FOUND:
      'That model was not found on your Host Ollama. Pick another Host model or pull it on the Host.',
  }
  if (M[c]) return M[c]!
  const fb = messageFallback?.trim()
  if (fb) return fb
  return "This Host model couldn't complete the request. Try again."
}

export function appendHostAiAttributionLine(answer: string, hostComputerName: string): string {
  const h = (hostComputerName || 'Host').trim() || 'Host'
  return `${answer.trimEnd()}\n\n*Generated by Host AI on ${h}*`
}

export function hostModelDisplayNameFromSelection(args: {
  parsedModel: string | undefined
  targetLabel: string | undefined
}): string {
  const m = args.parsedModel?.trim()
  if (m) return m
  const label = args.targetLabel?.trim()
  if (label && /^host ai\s*·/i.test(label)) {
    return label.replace(/^host ai\s*·\s*/i, '').trim() || 'Model'
  }
  return 'Model'
}

/** Params for Host internal direct P2P completion (`internalInference.requestCompletion`). */
export type HostInternalCompletionParams = {
  /** Model row id (e.g. orchestrator route id) — correlation only; not sent as prompt content. */
  targetId: string
  handshakeId: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  model?: string
  /** Default 120_000 when using `requestCompletion`. */
  timeoutMs?: number
  /** LAN Host Ollama — skip BEAP/P2P when `ollama_direct`. */
  execution_transport?: 'ollama_direct'
}

type InternalInfApi = {
  requestCompletion?: (p: unknown) => Promise<unknown>
  requestHostCompletion?: (p: unknown) => Promise<unknown>
  runHostChat?: (p: unknown) => Promise<unknown>
}

/**
 * Host internal inference submit: prefers `requestCompletion` (STEP 5 payload);
 * falls back to `requestHostCompletion` / `runHostChat` on older preloads.
 */
export function getRequestHostCompletion(
  w: typeof window,
): ((params: HostInternalCompletionParams) => Promise<unknown>) | undefined {
  const inf = w.internalInference as InternalInfApi | undefined
  if (typeof inf?.requestCompletion === 'function') {
    return (params: HostInternalCompletionParams) =>
      inf.requestCompletion!({
        provider: 'host_internal' as const,
        target_id: params.targetId,
        handshake_id: params.handshakeId,
        model: params.model,
        messages: params.messages,
        timeout_ms: params.timeoutMs ?? 120_000,
        stream: false,
        execution_transport: params.execution_transport,
      })
  }
  if (typeof inf?.requestHostCompletion === 'function') {
    return (params: HostInternalCompletionParams) =>
      inf.requestHostCompletion!({
        handshakeId: params.handshakeId,
        messages: params.messages,
        model: params.model,
        timeoutMs: params.timeoutMs,
        execution_transport: params.execution_transport,
      })
  }
  if (typeof inf?.runHostChat === 'function') {
    return (params: HostInternalCompletionParams) =>
      inf.runHostChat!({
        handshakeId: params.handshakeId,
        messages: params.messages,
        model: params.model,
        timeoutMs: params.timeoutMs,
        execution_transport: params.execution_transport,
      })
  }
  return undefined
}
