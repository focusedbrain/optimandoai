/**
 * Mode-trigger execution entrypoint: match agents via session-linked `mode_trigger`, then run the same
 * LLM + agent-box output path as WR Chat's `processWithAgent` (sidepanel).
 *
 * Normal WR Chat send continues to use `routeInput` / `matchInputToAgents` only — this module is for
 * explicit mode/session-driven runs (custom mode manual tick, interval, future BEAP Inbox actions).
 */

import type { WrChatSurface } from '../ui/components/wrChatSurface'
import { ensureLaunchSecretForElectronHttp } from './ensureLaunchSecretForElectronHttp'
import {
  matchAgentsForModeRun,
  loadAgentsFromSession,
  loadAgentBoxesFromSession,
  wrapInputForAgent,
  resolveModelForAgent,
  buildLlmRequestBody,
  updateAgentBoxOutput,
  type AgentMatch,
  type BrainResolution,
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
  baseUrl?: string
  /** Defaults to Electron launch-secret headers; override in tests or non-extension contexts. */
  getFetchHeaders?: () => Promise<Record<string, string>>
  beforeEachLlmCall?: () => Promise<void>
  sourceSurface?: WrChatSurface
  signal?: AbortSignal
}

/**
 * 1) `matchAgentsForModeRun` — mode/session gate + `mode_trigger` only.
 * 2) For each match, load agent config and call `/api/llm/chat` like sidepanel `processWithAgent`.
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
    baseUrl = DEFAULT_LLM_BASE,
    getFetchHeaders = defaultGetFetchHeaders,
    beforeEachLlmCall,
    sourceSurface,
    signal,
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
      baseUrl,
      sessionKey,
      getFetchHeaders,
      beforeEachLlmCall,
      sourceSurface,
      signal,
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
  baseUrl: string
  sessionKey?: string
  getFetchHeaders: () => Promise<Record<string, string>>
  beforeEachLlmCall?: () => Promise<void>
  sourceSurface?: WrChatSurface
  signal?: AbortSignal
}

async function runAgentMatchLlm(p: RunOneParams): Promise<ModeRunAgentExecutionResult> {
  const { match, inputText, ocrText, processedMessages, fallbackModel, baseUrl, sessionKey } = p
  const baseResult = { agentId: match.agentId, agentName: match.agentName }

  try {
    const agents = await loadAgentsFromSession(sessionKey)
    const agent = agents.find((a) => a.id === match.agentId)
    if (!agent) {
      return { ...baseResult, success: false, error: `Agent ${match.agentName} not found` }
    }

    const reasoningContext = wrapInputForAgent(inputText, agent, ocrText)
    const modelResolution: BrainResolution = resolveModelForAgent(
      match.agentBoxProvider,
      match.agentBoxModel,
      fallbackModel,
    )

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

    const llmMessages = [{ role: 'system', content: reasoningContext }, ...processedMessages.slice(-3)]
    const { body: llmBody, error: keyError } = await buildLlmRequestBody(
      modelResolution as BrainResolution & { ok: true },
      llmMessages,
    )
    if (keyError) {
      if (match.agentBoxId) {
        await updateAgentBoxOutput(
          match.agentBoxId,
          keyError,
          `Agent: ${match.agentName} | Missing API key`,
          sessionKey,
          p.sourceSurface,
        )
      }
      return { ...baseResult, success: false, error: keyError }
    }

    if (p.beforeEachLlmCall) await p.beforeEachLlmCall()

    const headers = await p.getFetchHeaders()
    const response: Response = await fetch(`${baseUrl}/api/llm/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(llmBody),
      signal: p.signal ?? AbortSignal.timeout(600_000),
    })

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}))
      const err = (errBody as { error?: string }).error || 'LLM request failed'
      return { ...baseResult, success: false, error: err }
    }

    const result = await response.json()
    if (result.ok && result.data?.content) {
      const output = result.data.content as string
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
    }

    return { ...baseResult, success: false, error: 'No output from LLM' }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Agent processing failed'
    return { ...baseResult, success: false, error: message }
  }
}
