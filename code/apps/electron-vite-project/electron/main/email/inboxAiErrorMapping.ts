/**
 * User-facing inbox / BEAP content AI error classification for IPC + renderer.
 */

import type { AiExecutionContext } from '../llm/aiExecutionTypes'
import { NO_AI_MODEL_SELECTED } from '../llm/resolveAiExecutionContext'
import { InternalInferenceErrorCode } from '../internalInference/errors'
import {
  isInferenceRoutingUnavailableError,
} from '../internalInference/chatWithContextRagOllamaGeneration'
import { inferenceRoutingUnavailableUserMessage } from '../internalInference/inferenceRoutingIpcPayload'

export type InboxAiErrorCode =
  | 'no_model_selected'
  | 'local_ollama_unreachable'
  | 'remote_ollama_unreachable'
  | 'beap_endpoint_missing'
  | 'generation_failed'
  | 'timeout'
  | 'inference_routing_unavailable'
  | 'semantic_context_unavailable'
  | 'database_error'
  | 'llm_error'

export type InboxAiErrorDebug = {
  lane?: string
  baseUrl?: string
  model?: string
  operation?: string
  failureCode?: string
  inferenceRoutingReason?: string
}

/** Enable richer IPC error payloads (lane, baseUrl, …). */
export function inboxAiDevDebugEnabled(): boolean {
  return process.env.NODE_ENV === 'development' || process.env.WRDESK_INBOX_AI_DEBUG === '1'
}

const REMOTE_OLLAMA_CODES = new Set<string>([
  InternalInferenceErrorCode.OLLAMA_DIRECT_CHAT_UNREACHABLE,
  InternalInferenceErrorCode.OLLAMA_LAN_NOT_REACHABLE,
  InternalInferenceErrorCode.OLLAMA_DIRECT_INVALID_ENDPOINT,
  InternalInferenceErrorCode.PROVIDER_UNAVAILABLE,
  InternalInferenceErrorCode.OLLAMA_UNAVAILABLE,
  InternalInferenceErrorCode.PROBE_OLLAMA_UNAVAILABLE,
  InternalInferenceErrorCode.OLLAMA_DIRECT_MODEL_NOT_FOUND,
])

const BEAP_ENDPOINT_CODES = new Set<string>([
  InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING,
  InternalInferenceErrorCode.HOST_DIRECT_ENDPOINT_MISSING,
  InternalInferenceErrorCode.P2P_INFERENCE_REQUIRED,
  InternalInferenceErrorCode.HOST_AI_PEER_ENDPOINT_MISSING,
  InternalInferenceErrorCode.HOST_AI_NO_ROUTE,
  InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE,
])

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function failureCodeFrom(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined
  const fc = (err as { inboxFailureCode?: string }).inboxFailureCode
  return typeof fc === 'string' ? fc : undefined
}

function looksLikeLocalUrl(baseUrl: string | undefined): boolean {
  const u = (baseUrl ?? '').toLowerCase()
  return u.includes('127.0.0.1') || u.includes('localhost')
}

function transportFailureMessage(msg: string): boolean {
  return (
    /ECONNREFUSED|fetch failed|failed to fetch|network|ENOTFOUND|ETIMEDOUT|unreachable/i.test(msg) &&
    !/embed|embedding|\/api\/embed/i.test(msg)
  )
}

function legacyAnalyzeErrorField(code: InboxAiErrorCode): string {
  if (code === 'timeout') return 'timeout'
  if (code === 'inference_routing_unavailable') return 'inference_routing_unavailable'
  if (code === 'no_model_selected') return 'no_model_selected'
  return 'llm_error'
}

export function classifyInboxAiError(
  err: unknown,
  ctx: {
    operation: string
    aiExecution?: AiExecutionContext | null
    model?: string
  },
): { code: InboxAiErrorCode; debug: InboxAiErrorDebug } {
  const msg = errMsg(err)
  const fc = failureCodeFrom(err)
  const lane = ctx.aiExecution?.lane
  const baseUrl = ctx.aiExecution?.baseUrl
  const model = ctx.model ?? ctx.aiExecution?.model
  const debugBase: InboxAiErrorDebug = {
    operation: ctx.operation,
    ...(lane ? { lane } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(model ? { model } : {}),
    ...(fc ? { failureCode: fc } : {}),
  }

  if (msg.startsWith('LLM_TIMEOUT')) {
    return { code: 'timeout', debug: debugBase }
  }

  if (isInferenceRoutingUnavailableError(err)) {
    const ir = err
    return {
      code: 'inference_routing_unavailable',
      debug: {
        ...debugBase,
        inferenceRoutingReason: ir.reason,
      },
    }
  }

  if (msg === NO_AI_MODEL_SELECTED || msg.includes(NO_AI_MODEL_SELECTED)) {
    return { code: 'no_model_selected', debug: debugBase }
  }

  if (msg === 'Database unavailable' || msg === 'Message not found') {
    return { code: 'database_error', debug: debugBase }
  }

  const remoteLane = lane === 'ollama_direct' || lane === 'beap'

  if (fc && BEAP_ENDPOINT_CODES.has(fc)) {
    return { code: 'beap_endpoint_missing', debug: debugBase }
  }

  if (fc && REMOTE_OLLAMA_CODES.has(fc)) {
    if (lane === 'ollama_direct' || lane === 'beap') {
      return { code: 'remote_ollama_unreachable', debug: debugBase }
    }
    if (lane === 'local' || lane === undefined) {
      return { code: 'local_ollama_unreachable', debug: debugBase }
    }
    return {
      code: !looksLikeLocalUrl(baseUrl) ? 'remote_ollama_unreachable' : 'local_ollama_unreachable',
      debug: debugBase,
    }
  }

  if (!remoteLane && (lane === 'local' || !lane)) {
    if (
      transportFailureMessage(msg) &&
      looksLikeLocalUrl(baseUrl ?? 'http://127.0.0.1:11434')
    ) {
      return { code: 'local_ollama_unreachable', debug: debugBase }
    }
  }

  if (remoteLane && transportFailureMessage(msg)) {
    return { code: 'remote_ollama_unreachable', debug: debugBase }
  }

  if (/embed|embedding|\/api\/embed|semantic/i.test(msg) && !/\/api\/chat/i.test(msg)) {
    return { code: 'semantic_context_unavailable', debug: debugBase }
  }

  return { code: 'generation_failed', debug: debugBase }
}

export function buildInboxAiAnalyzeErrorPayload(
  err: unknown,
  ctx: {
    messageId: string
    operation: string
    aiExecution?: AiExecutionContext | null
    model?: string
  },
): Record<string, unknown> {
  const ir = isInferenceRoutingUnavailableError(err) ? err : null
  const { code, debug } = classifyInboxAiError(err, {
    operation: ctx.operation,
    aiExecution: ctx.aiExecution,
    model: ctx.model,
  })
  const showDebug = inboxAiDevDebugEnabled()
  const userMsg = ir ? inferenceRoutingUnavailableUserMessage(ir.reason, ir.detail) : errMsg(err)
  const out: Record<string, unknown> = {
    messageId: ctx.messageId,
    error: legacyAnalyzeErrorField(code),
    message: userMsg,
    inboxErrorCode: code,
  }
  if (ir) out.inferenceRoutingReason = ir.reason
  if (showDebug) {
    out.debug = {
      ...debug,
      ...(ir ? { inferenceRoutingReason: ir.reason } : {}),
    }
  }
  return out
}

/** Invoke-shape failure for `inbox:aiDraftReply`. */
export function buildInboxAiDraftIpcFailure(
  err: unknown,
  ctx: { aiExecution?: AiExecutionContext | null; model?: string },
  opts?: { isNativeBeap?: boolean },
): Record<string, unknown> {
  const ir = isInferenceRoutingUnavailableError(err) ? err : null
  const { code, debug } = classifyInboxAiError(err, {
    operation: 'draft_reply',
    aiExecution: ctx.aiExecution ?? undefined,
    model: ctx.model,
  })
  const showDebug = inboxAiDevDebugEnabled()
  const userMsg = ir ? inferenceRoutingUnavailableUserMessage(ir.reason, ir.detail) : errMsg(err)
  const base: Record<string, unknown> = {
    ok: false,
    error: code === 'timeout' ? 'timeout' : 'llm_error',
    message: userMsg,
    inboxErrorCode: code,
  }
  if (showDebug) {
    base.debug = {
      ...debug,
      ...(ir ? { inferenceRoutingReason: ir.reason } : {}),
    }
  }
  if (opts?.isNativeBeap) {
    base.data = {
      draft: '',
      capsuleDraft: { publicText: '', encryptedText: '' },
      isNativeBeap: true as const,
    }
  }
  return base
}
