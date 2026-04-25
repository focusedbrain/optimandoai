/**
 * Host-only: policy, concurrency, Ollama for internal Sandbox inference (no cloud, no relay).
 */

import { InboxLlmTimeoutError } from '../email/inboxLlmChat'
import * as internalHostOllama from '../llm/internalHostInferenceOllama'
import type { InternalHostInferenceMessage } from '../llm/internalHostInferenceOllama'
import { ollamaManager } from '../llm/ollama-manager'
import { InternalInferenceErrorCode } from './errors'
import { tryAcquireHostInferenceSlot } from './hostInferenceConcurrency'
import { getHostInternalInferencePolicy } from './hostInferencePolicyStore'
import type {
  InternalInferenceErrorWire,
  InternalInferenceResultWire,
} from './types'
import { INTERNAL_INFERENCE_SCHEMA_VERSION } from './types'

function retryableForCode(code: string): boolean {
  return (
    code === InternalInferenceErrorCode.PROVIDER_BUSY ||
    code === InternalInferenceErrorCode.PROVIDER_TIMEOUT ||
    code === InternalInferenceErrorCode.OLLAMA_UNAVAILABLE
  )
}

export function buildHostInferenceErrorWire(
  r: {
    requestId: string
    handshakeId: string
    hostDeviceId: string
    peerDeviceId: string
  },
  code: string,
  message: string,
  tStart: number,
): InternalInferenceErrorWire {
  return {
    type: 'internal_inference_error',
    schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
    request_id: r.requestId,
    handshake_id: r.handshakeId,
    sender_device_id: r.hostDeviceId,
    target_device_id: r.peerDeviceId,
    transport_policy: 'direct_only',
    created_at: new Date().toISOString(),
    code,
    message,
    retryable: retryableForCode(code),
    duration_ms: Date.now() - tStart,
  }
}

function mapOllamaError(e: unknown): { code: string; message: string } {
  const c = (e as { code?: string })?.code
  if (c === 'MODEL_UNAVAILABLE' || c === 'OLLAMA_UNAVAILABLE') {
    return { code: c, message: c }
  }
  if (
    e instanceof InboxLlmTimeoutError ||
    (e && typeof e === 'object' && (e as Error).name === 'InboxLlmTimeoutError')
  ) {
    return { code: InternalInferenceErrorCode.PROVIDER_TIMEOUT, message: 'timeout' }
  }
  if (c === 'INTERNAL_INFERENCE_FAILED') {
    return { code: InternalInferenceErrorCode.INTERNAL_INFERENCE_FAILED, message: 'inference failed' }
  }
  return { code: InternalInferenceErrorCode.INTERNAL_INFERENCE_FAILED, message: 'inference failed' }
}

export interface HostInferenceContext {
  handshakeId: string
  requestId: string
  modelRequested: string | undefined
  messages: InternalHostInferenceMessage[]
  options: { temperature?: number; max_tokens?: number } | undefined
  peerDeviceId: string
  hostDeviceId: string
}

/**
 * Returns result or error wire for direct POST to Sandbox (never includes log-only fields).
 */
export async function runHostInternalInference(
  ctx: HostInferenceContext,
): Promise<{
  wire: InternalInferenceResultWire | InternalInferenceErrorWire
  log: {
    model?: string
    prompt_bytes: number
    message_count: number
    duration_ms: number
    error_code?: string
  }
}> {
  const policy = getHostInternalInferencePolicy()
  const t0 = Date.now()
  const promptStr = JSON.stringify(ctx.messages)
  const promptBytes = Buffer.byteLength(promptStr, 'utf8')
  const messageCount = ctx.messages.length

  const baseLog = { prompt_bytes: promptBytes, message_count: messageCount }

  if (!policy.allowSandboxInference) {
    return {
      wire: buildHostInferenceErrorWire(
        {
          requestId: ctx.requestId,
          handshakeId: ctx.handshakeId,
          hostDeviceId: ctx.hostDeviceId,
          peerDeviceId: ctx.peerDeviceId,
        },
        InternalInferenceErrorCode.HOST_INFERENCE_DISABLED,
        'disabled',
        t0,
      ),
      log: { ...baseLog, duration_ms: Date.now() - t0, error_code: InternalInferenceErrorCode.HOST_INFERENCE_DISABLED },
    }
  }

  /** Sandbox should send the Host’s active local model tag; reject mismatch vs effective Ollama config. (Before slot.) */
  const requested = ctx.modelRequested?.trim()
  if (requested) {
    let eff: string | null = null
    try {
      eff = await ollamaManager.getEffectiveChatModelName()
    } catch {
      eff = null
    }
    if (!eff) {
      return {
        wire: buildHostInferenceErrorWire(
          {
            requestId: ctx.requestId,
            handshakeId: ctx.handshakeId,
            hostDeviceId: ctx.hostDeviceId,
            peerDeviceId: ctx.peerDeviceId,
          },
          InternalInferenceErrorCode.HOST_NO_ACTIVE_LOCAL_LLM,
          'no active model',
          t0,
        ),
        log: {
          ...baseLog,
          duration_ms: Date.now() - t0,
          error_code: InternalInferenceErrorCode.HOST_NO_ACTIVE_LOCAL_LLM,
        },
      }
    }
    if (eff.trim() !== requested) {
      return {
        wire: buildHostInferenceErrorWire(
          {
            requestId: ctx.requestId,
            handshakeId: ctx.handshakeId,
            hostDeviceId: ctx.hostDeviceId,
            peerDeviceId: ctx.peerDeviceId,
          },
          InternalInferenceErrorCode.MODEL_UNAVAILABLE,
          'model not active on Host',
          t0,
        ),
        log: { ...baseLog, duration_ms: Date.now() - t0, error_code: InternalInferenceErrorCode.MODEL_UNAVAILABLE },
      }
    }
  }

  const slot = tryAcquireHostInferenceSlot()
  if (!slot.ok) {
    return {
      wire: buildHostInferenceErrorWire(
        {
          requestId: ctx.requestId,
          handshakeId: ctx.handshakeId,
          hostDeviceId: ctx.hostDeviceId,
          peerDeviceId: ctx.peerDeviceId,
        },
        slot.code,
        'busy',
        t0,
      ),
      log: { ...baseLog, duration_ms: Date.now() - t0, error_code: slot.code },
    }
  }

  const parentAbort = new AbortController()
  try {
    const out = await internalHostOllama.runInternalHostOllamaInference({
      messages: ctx.messages,
      requestedModel: ctx.modelRequested,
      modelAllowlist: policy.modelAllowlist,
      signal: parentAbort.signal,
      temperature: ctx.options?.temperature,
      maxTokens: ctx.options?.max_tokens,
      timeoutMs: policy.timeoutMs,
    })
    return {
      wire: {
        type: 'internal_inference_result',
        schema_version: INTERNAL_INFERENCE_SCHEMA_VERSION,
        request_id: ctx.requestId,
        handshake_id: ctx.handshakeId,
        sender_device_id: ctx.hostDeviceId,
        target_device_id: ctx.peerDeviceId,
        transport_policy: 'direct_only',
        created_at: new Date().toISOString(),
        model: out.model,
        output: out.text,
        usage: out.usage,
        duration_ms: out.durationMs,
      },
      log: {
        model: out.model,
        ...baseLog,
        duration_ms: out.durationMs,
      },
    }
  } catch (e) {
    const m = mapOllamaError(e)
    return {
      wire: buildHostInferenceErrorWire(
        {
          requestId: ctx.requestId,
          handshakeId: ctx.handshakeId,
          hostDeviceId: ctx.hostDeviceId,
          peerDeviceId: ctx.peerDeviceId,
        },
        m.code,
        m.message,
        t0,
      ),
      log: {
        ...baseLog,
        duration_ms: Date.now() - t0,
        error_code: m.code,
      },
    }
  } finally {
    slot.release()
  }
}
