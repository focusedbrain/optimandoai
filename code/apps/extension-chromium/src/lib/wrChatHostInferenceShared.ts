/**
 * WR Chat Host / cross-device inference helpers (extension sidebar + popup).
 * Mirrors Hybrid Search + dashboard Host path: sandbox → `runSandboxHostInferenceChat` via HTTP when `window.internalInference` is absent.
 */

import { parseAnyHostInferenceModelId } from './hostInferenceRouteIds'
import {
  appendHostAiAttributionLine,
  formatInternalInferenceErrorCode,
  isHostInternalChatModelId,
} from './inferenceSubmitRouting'

export type WrChatSubmitOrigin = 'dashboard_wrchat' | 'sidebar_wrchat' | 'popup_wrchat'

export type ResolvedWrChatExecutionTransport =
  | 'host_cross_device'
  | 'local_ollama'
  | 'cloud_provider'
  | 'unavailable'

export type WrChatHostSelectorRow = {
  name: string
  hostAi?: boolean
  hostAvailable?: boolean
  section?: 'local' | 'host' | 'cloud'
  execution_transport?: 'ollama_direct'
  displayTitle?: string
  hostComputerName?: string
  /** When status merge includes bare tag (optional). */
  hostLocalModelName?: string
}

export function resolveWrChatExecutionTransport(
  selectedModelId: string,
  available?: readonly WrChatHostSelectorRow[],
): ResolvedWrChatExecutionTransport {
  const id = String(selectedModelId ?? '').trim()
  if (!id) return 'unavailable'
  if (isHostInternalChatModelId(id, available)) return 'host_cross_device'
  const row = available?.find((r) => r.name === id)
  if (row?.section === 'cloud') return 'cloud_provider'
  return 'local_ollama'
}

/** Prefer tag from `host-internal:…:<model>`; else optional row hint (legacy ids). */
export function wrChatHostInternalWireModel(
  parsed: { model?: string } | null | undefined,
  row: { hostLocalModelName?: string } | undefined,
): string | undefined {
  const fromRoute = parsed?.model?.trim()
  if (fromRoute) return fromRoute
  const fromRow = row?.hostLocalModelName?.trim()
  return fromRow || undefined
}

export type WrChatInferenceRoutingLog = {
  origin: WrChatSubmitOrigin
  selectedModelId: string
  resolvedExecutionTransport: ResolvedWrChatExecutionTransport
  inferencePath: 'host_internal_http' | 'host_internal_ipc' | 'local_api_llm_chat' | 'cloud_api_llm_chat'
  modelSent: string | null
  hostTargetId: string | null
  handshakeId: string | null
  execution_transport: 'ollama_direct' | 'beap' | null
  fallbackUsed: boolean
}

export function logWrChatInferenceRoutingPreflight(fields: WrChatInferenceRoutingLog): void {
  console.log(`[WRCHAT_ROUTE] ${JSON.stringify(fields)}`)
}

export type WrChatSimpleChatBubble = {
  role: 'user' | 'assistant'
  text?: string
  imageUrl?: string
  videoUrl?: string
}

/**
 * Text-only messages for `internal_inference_request` / host-internal HTTP (same rules as dashboard WR Chat).
 */
export function buildHostInternalMessagesFromSimpleChat(
  newMessages: WrChatSimpleChatBubble[],
  opts: {
    docCtx: { name: string; text: string } | null
    focusPrefix: string
    useFreshPayload: boolean
    freshUserContent: string
    lastUserImageUrl: string | null
    ocrText: string
  },
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  if (opts.useFreshPayload) {
    return [{ role: 'user', content: opts.freshUserContent }]
  }
  const out: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
  for (const m of newMessages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue
    let content = m.text ?? ''
    if (m.role === 'user' && m.videoUrl) {
      content = `${m.text || 'Video:'}\n[Video attached]`
    }
    if (
      m.role === 'user' &&
      m.imageUrl &&
      opts.lastUserImageUrl &&
      m.imageUrl === opts.lastUserImageUrl &&
      opts.ocrText.trim()
    ) {
      content = `${content}\n\n[OCR extracted text]:\n${opts.ocrText}`
    }
    out.push({ role: m.role, content })
  }
  if (opts.focusPrefix) {
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].role === 'user') {
        out[i] = { ...out[i], content: `${opts.focusPrefix}\n\n${out[i].content}` }
        break
      }
    }
  }
  if (opts.docCtx) {
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].role === 'user') {
        out[i] = {
          ...out[i],
          content: `[Attached document: ${opts.docCtx.name}]\n\n${opts.docCtx.text}\n\n---\n${out[i].content}`,
        }
        break
      }
    }
  }
  return out
}

const BRIDGE_UNAVAILABLE =
  'Host inference bridge unavailable for WR Chat. Use WR Desk dashboard WR Chat, or ensure the desktop app is running in sandbox mode with a paired Host.'

export async function postWrChatHostInternalCompletionHttp(args: {
  baseUrl: string
  headers: Record<string, string>
  handshakeId: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  model?: string
  execution_transport?: 'ollama_direct'
  timeoutMs?: number
  targetId?: string
}): Promise<
  | { ok: true; output: string; model?: string }
  | { ok: false; code?: string; message: string }
> {
  const base = args.baseUrl.replace(/\/$/, '')
  const url = `${base}/api/llm/host-internal-completion`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...args.headers },
      body: JSON.stringify({
        handshake_id: args.handshakeId,
        messages: args.messages,
        model: args.model,
        execution_transport: args.execution_transport,
        timeout_ms: args.timeoutMs ?? 120_000,
        target_id: args.targetId ?? args.handshakeId,
      }),
      signal: AbortSignal.timeout(Math.min((args.timeoutMs ?? 120_000) + 15_000, 620_000)),
    })
  } catch (e) {
    return { ok: false, message: BRIDGE_UNAVAILABLE }
  }
  let j: Record<string, unknown> = {}
  try {
    j = (await res.json()) as Record<string, unknown>
  } catch {
    j = {}
  }
  if (j.ok === true) {
    const data = j.data as { content?: string; model?: string } | undefined
    if (typeof data?.content === 'string') {
      return { ok: true, output: data.content, model: typeof data.model === 'string' ? data.model : undefined }
    }
  }
  const err = typeof j.error === 'string' ? j.error : res.statusText || 'host completion failed'
  const code = typeof j.code === 'string' ? j.code : undefined
  return { ok: false, code, message: err }
}

export async function runWrChatHostInferenceForExtensionSurface(opts: {
  origin: Extract<WrChatSubmitOrigin, 'sidebar_wrchat' | 'popup_wrchat'>
  selectedModelId: string
  availableModels: readonly WrChatHostSelectorRow[] | undefined
  hostMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  baseUrl: string
  headers: Record<string, string>
  fallbackUsed: boolean
}): Promise<{ assistantText: string; success: boolean }> {
  const row = opts.availableModels?.find((m) => m.name === opts.selectedModelId)
  const parsed = parseAnyHostInferenceModelId(opts.selectedModelId)
  const resolvedExec = resolveWrChatExecutionTransport(opts.selectedModelId, opts.availableModels)
  const wireModel = wrChatHostInternalWireModel(parsed, row)
  const execution_transport = row?.execution_transport === 'ollama_direct' ? ('ollama_direct' as const) : undefined

  logWrChatInferenceRoutingPreflight({
    origin: opts.origin,
    selectedModelId: opts.selectedModelId,
    resolvedExecutionTransport: resolvedExec,
    inferencePath: 'host_internal_http',
    modelSent: wireModel ?? null,
    hostTargetId: opts.selectedModelId,
    handshakeId: parsed?.handshakeId ?? null,
    execution_transport: execution_transport ?? 'beap',
    fallbackUsed: opts.fallbackUsed,
  })

  if (row?.hostAi && row.hostAvailable === false) {
    return {
      success: false,
      assistantText:
        'This Host model is not available. Pick another model or check the model and AI settings on the Host machine.',
    }
  }
  if (!parsed?.handshakeId) {
    return {
      success: false,
      assistantText: 'That Host model id is not recognized. Open the model menu and select Host AI again.',
    }
  }

  const hostComputerName = (row?.hostComputerName || '').trim() || 'Host'
  const post = await postWrChatHostInternalCompletionHttp({
    baseUrl: opts.baseUrl,
    headers: opts.headers,
    handshakeId: parsed.handshakeId,
    messages: opts.hostMessages,
    model: wireModel,
    execution_transport,
    timeoutMs: 120_000,
    targetId: opts.selectedModelId,
  })

  if (post.ok) {
    return {
      success: true,
      assistantText: appendHostAiAttributionLine(post.output, hostComputerName),
    }
  }
  const msg = formatInternalInferenceErrorCode(post.code, post.message)
  if (
    post.message === BRIDGE_UNAVAILABLE ||
    /fetch/i.test(post.message) ||
    post.code === 'HOST_INTERNAL_REQUIRES_SANDBOX'
  ) {
    return { success: false, assistantText: post.message }
  }
  return { success: false, assistantText: `❌ ${msg}` }
}
