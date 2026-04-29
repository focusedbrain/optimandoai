/**
 * Sandbox-only Ollama routing for `handshake:chatWithContextRag` and embedding consumers (`LocalEmbeddingService`).
 * Host mode and non-Ollama providers pass through to the provider unchanged.
 */

import { OllamaProvider, type AIProvider } from '../handshake/aiProviders'
import type { LocalEmbeddingService } from '../handshake/embeddings'
import { readStoredAiExecutionContext } from '../llm/aiExecutionContextStore'
import { getInstanceId, getOrchestratorMode, isSandboxMode } from '../orchestrator/orchestratorModeStore'
import { getHandshakeDbForInternalInference } from './dbAccess'
import { getHostAiLedgerRoleSummaryFromDb } from './hostAiEffectiveRole'
import { getSandboxOllamaDirectRouteCandidate } from './sandboxHostAiOllamaDirectCandidate'
import { executeSandboxHostAiOllamaDirectEmbed } from './sandboxHostAiOllamaDirectEmbed'
import { resolveSandboxInferenceTarget, type SandboxInferenceTarget } from './resolveSandboxInferenceTarget'
import { planSandboxHostChatExecution, type BeapContentAiTask } from './beapContentAiRoute'
import { bareOllamaModelNameForApi } from '../../../src/lib/hostInferenceModelIds'

/**
 * When the resolver picks `local_sandbox`, still target the Host LAN URL if the user’s persisted
 * selector is `ollama_direct` (localhost `/api/tags` can be a false positive for embed workload).
 */
export function createOllamaProviderForSandboxEmbedding(fallback: OllamaProvider): OllamaProvider {
  const stored = readStoredAiExecutionContext()
  if (stored?.lane === 'ollama_direct' && stored.handshakeId?.trim()) {
    let b = stored.baseUrl?.trim().replace(/\/$/, '')
    if (!b) {
      const cand = getSandboxOllamaDirectRouteCandidate(stored.handshakeId.trim())
      b = cand?.base_url?.trim().replace(/\/$/, '') ?? ''
    }
    if (b) {
      return new OllamaProvider({
        baseUrl: b,
        embedModel: fallback.getOllamaEmbedModel(),
        lane: 'ollama_direct',
        handshakeId: stored.handshakeId,
        peerDeviceId: stored.peerDeviceId,
      })
    }
  }
  return fallback
}

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

/** Orchestrator mode is a UX hint; ledger {@link getHostAiLedgerRoleSummaryFromDb} proves sandbox peer for routing. */
async function shouldApplySandboxOllamaInferenceRouting(): Promise<boolean> {
  if (isSandboxMode()) return true
  const db = await getHandshakeDbForInternalInference()
  const om = getOrchestratorMode()
  const summary = getHostAiLedgerRoleSummaryFromDb(db, getInstanceId().trim(), String(om.mode))
  return summary.can_probe_host_endpoint
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
    /** When set, gates BEAP transport vs LAN `ollama_direct` for cross-device host completion. */
    contentTask?: BeapContentAiTask
  },
): Promise<string> {
  const opaqueModelSelectorId = opts.model
  const modelForOllamaApi = bareOllamaModelNameForApi(opaqueModelSelectorId)
  const stream = opts.stream === true
  const send = opts.send

  const direct = async () =>
    provider.generateChat(messages, {
      model: modelForOllamaApi,
      stream,
      send: stream ? send : undefined,
      ...(typeof opts.temperature === 'number' ? { temperature: opts.temperature } : {}),
    })

  if (provider.id && provider.id !== 'ollama') {
    return direct()
  }
  if (!(await shouldApplySandboxOllamaInferenceRouting())) {
    return direct()
  }

  const contentTask: BeapContentAiTask = opts.contentTask ?? { kind: 'chat_rag' }
  const stored = readStoredAiExecutionContext()
  const routePlan = planSandboxHostChatExecution(stored, contentTask)
  if (routePlan.mode === 'blocked') {
    throw new Error(routePlan.message)
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
    model: modelForOllamaApi,
    execution_transport: routePlan.mode === 'ollama_direct' ? 'ollama_direct' : undefined,
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

export type { BeapContentAiTask, BeapContentAiTaskKind } from './beapContentAiRoute'

export type SandboxEmbeddingRoutingParams = {
  scope?: string
  sandboxInferenceHandshakeId?: string
}

/**
 * Resolves routing, then computes one embedding vector (`/api/embed` locally or cross-device LAN).
 * Non-Ollama and host mode defer to {@link AIProvider.generateEmbedding}.
 */
export async function runOllamaGenerateEmbeddingWithSandboxRouting(
  provider: AIProvider,
  text: string,
  ragParams: SandboxEmbeddingRoutingParams,
): Promise<number[]> {
  if (provider.id !== 'ollama') {
    return provider.generateEmbedding(text)
  }
  if (!(await shouldApplySandboxOllamaInferenceRouting())) {
    return provider.generateEmbedding(text)
  }

  const ollama = provider as OllamaProvider
  const handshakeId = handshakeHintFromParams(ragParams)
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

  logSandboxInferenceSend(target, 'embedding')

  if (target.kind === 'local_sandbox') {
    const embedder = createOllamaProviderForSandboxEmbedding(ollama)
    return embedder.generateEmbedding(text)
  }

  const cand = getSandboxOllamaDirectRouteCandidate(target.handshakeId)
  const peerHostId = String(cand?.peer_host_device_id ?? '').trim()
  const out = await executeSandboxHostAiOllamaDirectEmbed({
    handshakeId: target.handshakeId,
    currentDeviceId: getInstanceId(),
    peerHostDeviceId: peerHostId,
    model: ollama.getOllamaEmbedModel(),
    input: text,
    timeoutMs: 120_000,
  })
  if (!out.ok) {
    throw new Error(out.message || out.code || 'Host embedding failed')
  }
  return out.embedding
}

/** Wraps an Ollama provider so HybridSearch / queues call {@link runOllamaGenerateEmbeddingWithSandboxRouting}. */
export function wrapOllamaEmbeddingServiceForSandbox(
  provider: OllamaProvider,
  getRagParams: () => SandboxEmbeddingRoutingParams,
): LocalEmbeddingService {
  return {
    modelId: provider.getOllamaEmbedModel(),
    async generateEmbedding(text: string): Promise<Float32Array> {
      const arr = await runOllamaGenerateEmbeddingWithSandboxRouting(provider, text, getRagParams())
      return new Float32Array(arr)
    },
  }
}

