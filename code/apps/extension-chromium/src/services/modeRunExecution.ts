/**
 * Mode-trigger execution entrypoint: match agents via session-linked `mode_trigger`, then run the same
 * LLM + agent-box output path as WR Chat's `processWithAgent` (sidepanel).
 *
 * Normal WR Chat send continues to use `routeInput` / `matchInputToAgents` only — this module is for
 * explicit mode/session-driven runs (custom mode manual tick, interval, future BEAP Inbox actions).
 */

import type { WrChatSurface } from '../ui/components/wrChatSurface'
import type { WrChatSelectorRow } from '../lib/wrChatModelsFromLlmStatus'
import { buildWrChatSelectorModelsFromLlmStatus } from '../lib/wrChatModelsFromLlmStatus'
import type { CustomModeRuntimeConfig } from '../shared/ui/customModeRuntime'
import { runAgentBoxInferencePreSend } from '../lib/agentBoxInferencePreSend'
import { buildInferenceContextPrefix } from '../lib/globalSessionContextLlmPrefix'
import { isHostInferenceRouteId, parseAnyHostInferenceModelId } from '../lib/hostInferenceRouteIds'
import {
  formatInternalInferenceErrorCode,
  getRequestHostCompletion,
  isHostInternalChatModelId,
} from '../lib/inferenceSubmitRouting'
import {
  logWrChatInferenceRoutingPreflight,
  postWrChatHostInternalCompletionHttp,
  resolveWrChatExecutionTransport,
  wrChatHostInternalWireModel,
} from '../lib/wrChatHostInferenceShared'
import { prependHiddenContextToLastUserContent } from '../utils/prependChatFocusToLastUser'
import {
  applyModelFallbackBanner,
  buildLlmRequestBodyWithAvailability,
  postLlmChatWithAvailability,
  type ModelFallbackInfo,
} from '../lib/declaredModelAvailability'
import { ensureLaunchSecretForElectronHttp } from './ensureLaunchSecretForElectronHttp'
import {
  matchAgentsForModeRun,
  loadAgentsFromSession,
  loadAgentBoxesFromSession,
  wrapInputForAgent,
  resolveAgentBoxInference,
  updateAgentBoxOutput,
  type AgentMatch,
  type BrainResolution,
  type LlmRequestBody,
} from './processFlow'

const DEFAULT_LLM_BASE = 'http://127.0.0.1:51248'

async function defaultGetFetchHeaders(): Promise<Record<string, string>> {
  await ensureLaunchSecretForElectronHttp()
  const secret = await new Promise<string>((resolve) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
        resolve('')
        return
      }
      chrome.runtime.sendMessage({ type: 'GET_LAUNCH_SECRET' }, (response: { secret?: string | null } | undefined) => {
        if (chrome.runtime.lastError) {
          resolve('')
          return
        }
        resolve(response?.secret ?? '')
      })
    } catch {
      resolve('')
    }
  })
  return {
    'Content-Type': 'application/json',
    'X-Launch-Secret': secret,
  }
}

export type ModeRunAgentExecutionResult = {
  agentId: string
  agentName: string
  success: boolean
  output?: string
  error?: string
}

export type ExecuteModeRunAgentsResult = {
  matches: AgentMatch[]
  executions: ModeRunAgentExecutionResult[]
}

export type ExecuteModeRunAgentsOptions = {
  modeLinkedSessionId: string
  currentOrchestratorSessionId: string
  sessionKey?: string
  /** Passed to `wrapInputForAgent` (default `''`). */
  inputText?: string
  ocrText?: string
  /** Recent chat turns for the LLM (default: one empty user message). */
  processedMessages?: Array<{ role: string; content: string }>
  fallbackModel: string
  /** When set, used as WR Chat–style inheritance for agent boxes without fixed/user model. */
  wrchatModelId?: string
  /** Explicit default when neither box nor WR Chat supplies a model. */
  defaultModelId?: string
  /** Host-route execution context for `setAiExecutionContext` (optional). */
  availableModels?: readonly WrChatSelectorRow[]
  baseUrl?: string
  /** Defaults to Electron launch-secret headers; override in tests or non-extension contexts. */
  getFetchHeaders?: () => Promise<Record<string, string>>
  beforeEachLlmCall?: () => Promise<void>
  sourceSurface?: WrChatSurface
  signal?: AbortSignal
  /** Canonical orchestrator session key for Global Session Context (Layer 1). */
  inferenceSessionKey?: string | null
  /** Active mode runtime — Layer 2 when resolved model matches allocation. */
  modeRuntime?: CustomModeRuntimeConfig | null
  /** Mode-action automation run — inject full mode prefix (systemInstructions, searchFocus). */
  runMode?: boolean
}

/** Mode allocated model when set; otherwise WR Chat fallback (mirrors `getEffectiveLlmModelNameForActiveMode`). */
export function resolveModeRunWrchatModelId(
  modeRuntime: CustomModeRuntimeConfig | null | undefined,
  fallbackModel: string,
): string {
  const allocated = modeRuntime?.modelName?.trim()
  if (allocated) return allocated
  return fallbackModel.trim()
}

/** WR Chat selector rows for Host AI routing (`llm.status` / GET `/api/llm/status`). */
export async function fetchWrChatAvailableModelsForModeRun(
  baseUrl: string = DEFAULT_LLM_BASE,
  getFetchHeaders: () => Promise<Record<string, string>> = defaultGetFetchHeaders,
): Promise<WrChatSelectorRow[]> {
  try {
    const headers = await getFetchHeaders()
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/llm/status`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return []
    const j = (await res.json()) as { ok?: boolean; data?: Parameters<typeof buildWrChatSelectorModelsFromLlmStatus>[0] }
    if (!j.ok || !j.data) return []
    return buildWrChatSelectorModelsFromLlmStatus(j.data)
  } catch {
    return []
  }
}

function resolveModeRunHostRouteModelId(
  wrchatModelId: string,
  resolvedModelId: string,
  availableModels?: readonly WrChatSelectorRow[],
): string | null {
  const wr = wrchatModelId.trim()
  const resolved = resolvedModelId.trim()
  if (wr && isHostInternalChatModelId(wr, availableModels)) return wr
  if (resolved && isHostInternalChatModelId(resolved, availableModels)) return resolved
  if (resolved && isHostInferenceRouteId(resolved)) return resolved
  if (wr && isHostInferenceRouteId(wr)) return wr
  return null
}

type ModeRunLlmSubmitResult =
  | { ok: true; content: string; modelFallback?: ModelFallbackInfo }
  | { ok: false; error: string }

/** Host AI (sealed relay / IPC) or local/cloud HTTP — same resolution family as WR Chat. */
async function submitModeRunAgentLlm(args: {
  hostRouteModelId: string | null
  llmMessages: Array<{ role: string; content: string }>
  llmBody: LlmRequestBody
  availableModels: readonly WrChatSelectorRow[]
  baseUrl: string
  getFetchHeaders: () => Promise<Record<string, string>>
  signal?: AbortSignal
  preResolvedFallback?: ModelFallbackInfo
}): Promise<ModeRunLlmSubmitResult> {
  const {
    hostRouteModelId,
    llmMessages,
    llmBody,
    availableModels,
    baseUrl,
    getFetchHeaders,
    signal,
    preResolvedFallback,
  } = args

  if (hostRouteModelId) {
    const row = availableModels.find((m) => m.name === hostRouteModelId)
    const parsed = parseAnyHostInferenceModelId(hostRouteModelId)
    if (!parsed?.handshakeId) {
      return { ok: false, error: 'That Host model id is not recognized. Select Host AI again in the model menu.' }
    }
    if (row?.hostAi && row.hostAvailable === false) {
      return {
        ok: false,
        error:
          'This Host model is not available. Pick another model or check the model and AI settings on the Host machine.',
      }
    }

    const wireModel = wrChatHostInternalWireModel(parsed, row)
    const execution_transport =
      row?.execution_transport === 'ollama_direct' ? ('ollama_direct' as const) : undefined
    const hostMessages = llmMessages.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    }))

    const runHost =
      typeof globalThis !== 'undefined'
        ? getRequestHostCompletion(globalThis as unknown as Window)
        : undefined

    if (runHost) {
      logWrChatInferenceRoutingPreflight({
        origin: 'mode_run_agent',
        selectedModelId: hostRouteModelId,
        resolvedExecutionTransport: resolveWrChatExecutionTransport(hostRouteModelId, availableModels),
        inferencePath: 'host_internal_ipc',
        modelSent: wireModel ?? parsed.model ?? null,
        hostTargetId: hostRouteModelId,
        handshakeId: parsed.handshakeId,
        execution_transport: execution_transport ?? 'beap',
        fallbackUsed: false,
      })
      try {
        const r = (await runHost({
          targetId: hostRouteModelId,
          handshakeId: parsed.handshakeId,
          messages: hostMessages,
          model: wireModel,
          timeoutMs: 120_000,
          execution_transport,
        })) as { ok?: boolean; output?: string; code?: string; message?: string }
        if (r && r.ok === true && typeof r.output === 'string') {
          return { ok: true, content: r.output }
        }
        const er = r as { code?: string; message?: string }
        return {
          ok: false,
          error: formatInternalInferenceErrorCode(er.code, er.message ?? 'Host inference failed'),
        }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'Host inference failed' }
      }
    }

    logWrChatInferenceRoutingPreflight({
      origin: 'mode_run_agent',
      selectedModelId: hostRouteModelId,
      resolvedExecutionTransport: resolveWrChatExecutionTransport(hostRouteModelId, availableModels),
      inferencePath: 'host_internal_http',
      modelSent: wireModel ?? parsed.model ?? null,
      hostTargetId: hostRouteModelId,
      handshakeId: parsed.handshakeId,
      execution_transport: execution_transport ?? 'beap',
      fallbackUsed: false,
    })

    const headers = await getFetchHeaders()
    const post = await postWrChatHostInternalCompletionHttp({
      baseUrl,
      headers,
      handshakeId: parsed.handshakeId,
      messages: hostMessages,
      model: wireModel,
      execution_transport,
      timeoutMs: 120_000,
      targetId: hostRouteModelId,
      debugWrchatOrigin: 'mode_run_agent',
    })
    if (post.ok) return { ok: true, content: post.output }
    return { ok: false, error: formatInternalInferenceErrorCode(post.code, post.message) }
  }

  const headers = await getFetchHeaders()
  const post = await postLlmChatWithAvailability({
    body: llmBody,
    origin: 'mode_run_agent',
    baseUrl,
    getFetchHeaders: async () => headers,
    signal: signal ?? AbortSignal.timeout(600_000),
    preResolvedFallback: preResolvedFallback,
  })
  if (post.ok) {
    return {
      ok: true,
      content: post.content,
      modelFallback: post.modelFallback ?? preResolvedFallback,
    }
  }
  return { ok: false, error: post.error }
}

/**
 * 1) `matchAgentsForModeRun` — mode/session gate + `mode_trigger` only.
 * 2) For each match, run the same Host AI / local / cloud resolution as WR Chat (not sandbox-only HTTP chat).
 */
export async function executeModeRunAgents(
  options: ExecuteModeRunAgentsOptions,
): Promise<ExecuteModeRunAgentsResult> {
  const {
    modeLinkedSessionId,
    currentOrchestratorSessionId,
    sessionKey,
    inputText = '',
    ocrText = '',
    processedMessages = [{ role: 'user', content: '' }],
    fallbackModel,
    wrchatModelId,
    defaultModelId,
    availableModels,
    baseUrl = DEFAULT_LLM_BASE,
    getFetchHeaders = defaultGetFetchHeaders,
    beforeEachLlmCall,
    sourceSurface,
    signal,
    inferenceSessionKey,
    modeRuntime,
    runMode,
  } = options

  const agents = await loadAgentsFromSession(sessionKey)
  const agentBoxes = await loadAgentBoxesFromSession(sessionKey)
  const matches = matchAgentsForModeRun(
    agents,
    agentBoxes,
    modeLinkedSessionId,
    currentOrchestratorSessionId,
  )

  const executions: ModeRunAgentExecutionResult[] = []

  for (const match of matches) {
    const one = await runAgentMatchLlm({
      match,
      inputText,
      ocrText,
      processedMessages,
      fallbackModel,
      wrchatModelId,
      defaultModelId,
      availableModels,
      baseUrl,
      sessionKey,
      getFetchHeaders,
      beforeEachLlmCall,
      sourceSurface,
      signal,
      inferenceSessionKey,
      modeRuntime,
      runMode,
    })
    executions.push(one)
  }

  return { matches, executions }
}

type RunOneParams = {
  match: AgentMatch
  inputText: string
  ocrText: string
  processedMessages: Array<{ role: string; content: string }>
  fallbackModel: string
  wrchatModelId?: string
  defaultModelId?: string
  availableModels?: readonly WrChatSelectorRow[]
  baseUrl: string
  sessionKey?: string
  getFetchHeaders: () => Promise<Record<string, string>>
  beforeEachLlmCall?: () => Promise<void>
  sourceSurface?: WrChatSurface
  signal?: AbortSignal
  inferenceSessionKey?: string | null
  modeRuntime?: CustomModeRuntimeConfig | null
  runMode?: boolean
}

async function runAgentMatchLlm(p: RunOneParams): Promise<ModeRunAgentExecutionResult> {
  const { match, inputText, ocrText, processedMessages, fallbackModel, baseUrl, sessionKey } = p
  const wrchat = (p.wrchatModelId ?? fallbackModel).trim()
  const def = (p.defaultModelId ?? fallbackModel).trim()
  const baseResult = { agentId: match.agentId, agentName: match.agentName }

  try {
    const agents = await loadAgentsFromSession(sessionKey)
    const agent = agents.find((a) => a.id === match.agentId)
    if (!agent) {
      return { ...baseResult, success: false, error: `Agent ${match.agentName} not found` }
    }

    const reasoningContext = wrapInputForAgent(inputText, agent, ocrText)
    const inf = resolveAgentBoxInference({
      agentBoxProvider: match.agentBoxProvider,
      agentBoxModel: match.agentBoxModel,
      agentBoxUserSelectedInferenceModel: match.agentBoxUserSelectedInferenceModel,
      wrchatModelId: wrchat,
      defaultModelId: def || wrchat,
      agentId: match.agentId,
      boxId: match.agentBoxId,
    })
    const modelResolution: BrainResolution = inf.brain

    if (!modelResolution.ok) {
      const errorMsg = `Brain resolution failed for ${match.agentName}:\n${modelResolution.error}`
      if (match.agentBoxId) {
        await updateAgentBoxOutput(
          match.agentBoxId,
          errorMsg,
          `Agent: ${match.agentName} | Provider: ${modelResolution.provider} | Error: ${modelResolution.errorType}`,
          sessionKey,
          p.sourceSurface,
        )
      }
      return { ...baseResult, success: false, error: modelResolution.error }
    }

    const canonicalSessionKey = p.inferenceSessionKey ?? sessionKey ?? null
    const contextPrefix = await buildInferenceContextPrefix({
      sessionKey: canonicalSessionKey,
      modeRuntime: p.modeRuntime,
      resolvedModelId: (modelResolution as BrainResolution & { ok: true }).model,
      wrChatPickerModelId: wrchat,
      runMode: p.runMode,
    })
    let recentMessages = processedMessages.slice(-3)
    if (contextPrefix) {
      recentMessages = prependHiddenContextToLastUserContent(recentMessages, contextPrefix)
    }
    const llmMessages = [{ role: 'system', content: reasoningContext }, ...recentMessages]

    const { body: llmBody, error: availError, modelFallback: preFallback } =
      await buildLlmRequestBodyWithAvailability(
        modelResolution as BrainResolution & { ok: true },
        llmMessages,
        {
          origin: 'mode_run_agent',
          baseUrl,
          getFetchHeaders: p.getFetchHeaders,
        },
      )
    if (availError) {
      if (match.agentBoxId) {
        await updateAgentBoxOutput(
          match.agentBoxId,
          availError,
          `Agent: ${match.agentName} | Model unavailable`,
          sessionKey,
          p.sourceSurface,
        )
      }
      return { ...baseResult, success: false, error: availError }
    }

    await runAgentBoxInferencePreSend({
      resolvedModelId: (llmBody as { modelId: string }).modelId,
      modelSource: inf.modelSource,
      availableModels: p.availableModels ?? [],
      agentId: match.agentId,
      boxId: match.agentBoxId,
      inferencePath: 'mode_run_agent',
    })

    if (p.beforeEachLlmCall) await p.beforeEachLlmCall()

    const resolvedModelId = (llmBody as { modelId: string }).modelId
    const hostRouteModelId = resolveModeRunHostRouteModelId(
      wrchat,
      resolvedModelId,
      p.availableModels,
    )

    const llmResult = await submitModeRunAgentLlm({
      hostRouteModelId,
      llmMessages,
      llmBody,
      availableModels: p.availableModels ?? [],
      baseUrl,
      getFetchHeaders: p.getFetchHeaders,
      signal: p.signal,
      preResolvedFallback: preFallback,
    })

    if (!llmResult.ok) {
      return { ...baseResult, success: false, error: llmResult.error }
    }

    const output = applyModelFallbackBanner(
      llmResult.content,
      llmResult.modelFallback ?? preFallback,
    )
    const allBoxIds =
      match.targetBoxIds && match.targetBoxIds.length > 0
        ? match.targetBoxIds
        : match.agentBoxId
          ? [match.agentBoxId]
          : []

    const reasoningMeta = `**Agent:** ${match.agentIcon} ${match.agentName}\n**Match:** ${match.matchDetails}\n**Input:** ${inputText || '(mode run)'}`

    for (const boxId of allBoxIds) {
      await updateAgentBoxOutput(boxId, output, reasoningMeta, sessionKey, p.sourceSurface)
    }

    return { ...baseResult, success: true, output }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Agent processing failed'
    return { ...baseResult, success: false, error: message }
  }
}
