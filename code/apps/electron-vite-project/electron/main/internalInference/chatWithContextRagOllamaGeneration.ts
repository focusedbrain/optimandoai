/**
 * Sandbox-only Ollama routing for `handshake:chatWithContextRag` final LLM calls.
 * Host mode and non-Ollama providers pass through to `provider.generateChat` unchanged.
 */

import { isSandboxMode } from '../orchestrator/orchestratorModeStore'
import { resolveSandboxInferenceTarget, type SandboxInferenceTarget } from './resolveSandboxInferenceTarget'

export class InferenceRoutingUnavailableError extends Error {
  readonly reason: NonNullable<Extract<SandboxInferenceTarget, { kind: 'unavailable' }>['reason']>
  readonly detail?: string
  constructor(reason: NonNullable<Extract<SandboxInferenceTarget, { kind: 'unavailable' }>['reason']>, detail?: string) {
    super(detail ?? reason)
    this.name = 'InferenceRoutingUnavailableError'
    this.reason = reason
    this.detail = detail
  }
}

export function logSandboxInferenceSend(target: SandboxInferenceTarget, surface: string): void {
  if (target.kind === 'unavailable') {
    return
  }
  console.log(
    `[SBX_INFERENCE_SEND] ${JSON.stringify({
      kind: target.kind,
      base_url: target.kind !== 'unavailable' ? target.baseUrl : null,
      handshake_id: target.kind === 'cross_device' ? target.handshakeId : null,
      surface,
      timestamp: new Date().toISOString(),
    })}`,
  )
}

function handshakeHintFromParams(params: {
  scope?: string
  sandboxInferenceHandshakeId?: string
}): string | undefined {
  const hid = typeof params.sandboxInferenceHandshakeId === 'string' ? params.sandboxInferenceHandshakeId.trim() : ''
  if (hid) return hid
  const s = typeof params.scope === 'string' ? params.scope.trim() : ''
  if (s.startsWith('hs-')) return s
  return undefined
}

type GenerateChatOpts = {
  model: string
  stream?: boolean
  send?: (channel: string, payload: unknown) => void
  temperature?: number
}

/** Minimal provider shape used by handshake RAG. */
type OllamaLikeProvider = {
  id?: string
  generateChat: (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, opts: GenerateChatOpts) => Promise<string>
}

/**
 * Resolves Sandbox routing (`local_sandbox` | `cross_device` | `unavailable`), then executes one LLM call.
 * Throws {@link InferenceRoutingUnavailableError} when no route exists (caller maps to IPC).
 */
export async function runOllamaGenerateChatWithSandboxRouting(
  provider: OllamaLikeProvider,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  opts: GenerateChatOpts & {
    ragParams: { scope?: string; sandboxInferenceHandshakeId?: string }
  },
): Promise<string> {
  const model = opts.model
  const stream = opts.stream === true
  const send = opts.send

  const direct = async () =>
    provider.generateChat(messages, {
      model,
      stream,
      send: stream ? send : undefined,
      ...(typeof opts.temperature === 'number' ? { temperature: opts.temperature } : {}),
    })

  if (!isSandboxMode()) {
    return direct()
  }
  if (provider.id && provider.id !== 'ollama') {
    return direct()
  }

  const handshakeId = handshakeHintFromParams(opts.ragParams)
  const target = await resolveSandboxInferenceTarget({ handshakeId })

  if (target.kind === 'unavailable') {
    if (target.reason === 'no_local_ollama_no_cross_device_host') {
      throw new InferenceRoutingUnavailableError('no_local_ollama_no_cross_device_host')
    }
    if (target.reason === 'cross_device_caps_not_accepted') {
      throw new InferenceRoutingUnavailableError('cross_device_caps_not_accepted', target.detail)
    }
    throw new InferenceRoutingUnavailableError('local_probe_error', target.detail)
  }

  logSandboxInferenceSend(target, 'hybrid_search')

  if (target.kind === 'local_sandbox') {
    return direct()
  }

  const { runSandboxHostInferenceChat } = await import('./sandboxHostChat')
  const r = await runSandboxHostInferenceChat({
    handshakeId: target.handshakeId,
    messages,
    model,
    execution_transport: 'ollama_direct',
  })
  if (!r.ok) {
    const msg = r.message || r.code || 'Host inference failed'
    throw new Error(msg)
  }
  const text = r.output
  if (stream && send) {
    send('handshake:chatStreamToken', { token: text })
  }
  return text
}

export function isInferenceRoutingUnavailableError(e: unknown): e is InferenceRoutingUnavailableError {
  return e instanceof InferenceRoutingUnavailableError
}
