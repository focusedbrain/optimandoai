/**
 * Single-flight deduplication for inbox AI IPC (analysis stream, draft) to avoid duplicate
 * LLM work from parallel invokes / renderer Strict Mode / overlapping effects.
 */

import { randomUUID } from 'crypto'
import { readStoredAiExecutionContext } from '../llm/aiExecutionContextStore'
import { resolveInboxLlmSettings } from './inboxLlmChat'

export type InboxAiStreamInvokeOpts = { supersede?: boolean }

export function buildInboxAiTaskKey(taskKind: string, messageId: string, model: string, lane: string): string {
  return `${taskKind}:${messageId}:${model}:${lane}`
}

/** Synchronous snapshot for task keys — use before any await when claiming a single-flight slot. */
export function syncInboxAiSelectionForTaskKey(): { model: string; lane: string } {
  const settings = resolveInboxLlmSettings()
  if (settings.provider.toLowerCase() !== 'ollama') {
    return { model: String(settings.provider), lane: 'cloud' }
  }
  const stored = readStoredAiExecutionContext()
  return {
    model: stored?.model?.trim() || 'unset',
    lane: stored?.lane || 'unset',
  }
}

type InflightEntry = {
  requestId: string
  promise: Promise<unknown>
  startedAt: number
  state: 'running' | 'done' | 'error' | 'timeout' | 'aborted'
}

const inboxAiTaskInflight = new Map<string, InflightEntry>()

// ---------------------------------------------------------------------------
// Local Ollama GPU guard + timeout circuit-breaker.
//
// GPUs handle concurrent 12B inference fine. CPUs cannot — a 12B model on CPU
// takes >45 s per request, making the timeout the effective result and burning
// 100 % CPU on every core for the entire duration.
//
// Two-layer protection:
//   1. GPU pre-flight (/api/ps): if model is loaded with size_vram==0 the
//      model is running on CPU only — skip analysis immediately.
//   2. Timeout circuit-breaker: 3 consecutive LLM_TIMEOUT errors open the
//      circuit for CIRCUIT_RECOVERY_MS.  Resets on any successful response.
// ---------------------------------------------------------------------------

const LOCAL_OLLAMA_BASE = 'http://127.0.0.1:11434'
const GPU_CHECK_CACHE_MS = 60_000
const CIRCUIT_TIMEOUT_THRESHOLD = 3
const CIRCUIT_RECOVERY_MS = 10 * 60_000 // 10 minutes

let gpuCheckCachedAt = 0
let gpuCheckResult: 'gpu' | 'cpu_only' | 'unknown' = 'unknown'

let consecutiveTimeouts = 0
let circuitOpenAt: number | null = null

/** Returns true when local Ollama should be skipped due to confirmed CPU-only mode or open circuit. */
async function localOllamaBlocked(model: string): Promise<{ blocked: true; reason: string } | { blocked: false }> {
  // Circuit breaker
  if (circuitOpenAt !== null) {
    const elapsed = Date.now() - circuitOpenAt
    if (elapsed < CIRCUIT_RECOVERY_MS) {
      const remainMin = Math.ceil((CIRCUIT_RECOVERY_MS - elapsed) / 60_000)
      return { blocked: true, reason: `local Ollama circuit open (CPU-only mode detected; retries in ~${remainMin}m)` }
    }
    // Circuit recovery — reset and probe again
    consecutiveTimeouts = 0
    circuitOpenAt = null
    gpuCheckResult = 'unknown'
    gpuCheckCachedAt = 0
  }

  // GPU pre-flight (cached)
  if (Date.now() - gpuCheckCachedAt > GPU_CHECK_CACHE_MS) {
    try {
      const res = await fetch(`${LOCAL_OLLAMA_BASE}/api/ps`, {
        signal: AbortSignal.timeout(3000),
      })
      if (res.ok) {
        const data = (await res.json()) as { models?: Array<{ name?: string; size_vram?: number }> }
        const running = Array.isArray(data?.models) ? data.models : []
        const bare = model.split(':')[0] ?? model
        const match = running.find((m) => {
          const n = (m.name ?? '').toLowerCase()
          return n === model.toLowerCase() || n.startsWith(bare.toLowerCase())
        })
        if (match) {
          const vram = typeof match.size_vram === 'number' ? match.size_vram : -1
          gpuCheckResult = vram > 0 ? 'gpu' : 'cpu_only'
          gpuCheckCachedAt = Date.now()
          if (gpuCheckResult === 'cpu_only') {
            console.warn(`[INBOX_AI] Ollama model "${model}" loaded with size_vram=0 — CPU-only mode. Inbox AI analysis disabled.`)
            circuitOpenAt = Date.now()
            return { blocked: true, reason: 'Ollama is running in CPU-only mode (no GPU/VRAM detected). Inbox AI disabled to prevent thermal overload.' }
          }
        } else {
          // Model not yet loaded — let first request proceed; GPU status unknown
          gpuCheckResult = 'unknown'
          gpuCheckCachedAt = Date.now()
        }
      }
    } catch {
      // /api/ps unreachable — don't block; circuit-breaker will catch CPU timeouts
    }
  } else if (gpuCheckResult === 'cpu_only') {
    circuitOpenAt = circuitOpenAt ?? Date.now()
    return { blocked: true, reason: 'Ollama running in CPU-only mode (cached check).' }
  }

  return { blocked: false }
}

/** Record the outcome of a local Ollama inference to drive the circuit-breaker. */
function recordLocalOllamaOutcome(timedOut: boolean): void {
  if (timedOut) {
    consecutiveTimeouts++
    if (consecutiveTimeouts >= CIRCUIT_TIMEOUT_THRESHOLD) {
      circuitOpenAt = Date.now()
      gpuCheckResult = 'cpu_only'
      console.warn(
        `[INBOX_AI] ${consecutiveTimeouts} consecutive LLM_TIMEOUT errors — local Ollama appears to be in CPU-only mode. Inbox AI disabled for ${CIRCUIT_RECOVERY_MS / 60_000} minutes.`,
      )
    }
  } else {
    consecutiveTimeouts = 0
    circuitOpenAt = null
    if (gpuCheckResult === 'cpu_only') gpuCheckResult = 'gpu'
  }
}

type AnalysisStreamReplayState = {
  messageId: string
  requestId: string
  chunks: string[]
  startedAt: number
  terminal?: { kind: 'done' } | { kind: 'error'; payload: Record<string, unknown> }
}

const analysisStreamReplayByTaskKey = new Map<string, AnalysisStreamReplayState>()

export const analyzeStreamAbortByMessageId = new Map<string, AbortController>()

export function abortAnalyzeStreamForMessage(messageId: string, reason: string): boolean {
  const ac = analyzeStreamAbortByMessageId.get(messageId)
  if (!ac) return false
  logInboxAiTaskTerminal('ABORTED', {
    messageId,
    retryReason: reason,
  })
  ac.abort()
  analyzeStreamAbortByMessageId.delete(messageId)
  return true
}

const draftReplyGenerationByMessageId = new Map<string, number>()

export function bumpDraftReplySupersedeGeneration(messageId: string): void {
  draftReplyGenerationByMessageId.set(messageId, (draftReplyGenerationByMessageId.get(messageId) ?? 0) + 1)
}

export function getDraftReplyGeneration(messageId: string): number {
  return draftReplyGenerationByMessageId.get(messageId) ?? 0
}

function removeInflightKeysWithPrefix(prefix: string): void {
  for (const k of inboxAiTaskInflight.keys()) {
    if (k.startsWith(prefix)) inboxAiTaskInflight.delete(k)
  }
}

export function clearAnalysisStreamReplayPrefix(prefix: string): void {
  for (const k of analysisStreamReplayByTaskKey.keys()) {
    if (k.startsWith(prefix)) analysisStreamReplayByTaskKey.delete(k)
  }
}

export function initAnalysisStreamReplay(taskKey: string, messageId: string, requestId: string): void {
  analysisStreamReplayByTaskKey.set(taskKey, {
    messageId,
    requestId,
    chunks: [],
    startedAt: Date.now(),
  })
}

export function appendAnalysisStreamReplayChunk(taskKey: string, chunk: string): void {
  const st = analysisStreamReplayByTaskKey.get(taskKey)
  if (!st) return
  st.chunks.push(chunk)
  const totalChars = st.chunks.reduce((sum, c) => sum + c.length, 0)
  if (totalChars <= 256_000) return
  while (st.chunks.length > 1 && st.chunks.reduce((sum, c) => sum + c.length, 0) > 256_000) {
    st.chunks.shift()
  }
}

export function markAnalysisStreamReplayDone(taskKey: string): void {
  const st = analysisStreamReplayByTaskKey.get(taskKey)
  if (st) st.terminal = { kind: 'done' }
}

export function markAnalysisStreamReplayError(taskKey: string, payload: Record<string, unknown>): void {
  const st = analysisStreamReplayByTaskKey.get(taskKey)
  if (st) st.terminal = { kind: 'error', payload }
}

export function replayAnalysisStreamState(
  taskKey: string,
  send: (channel: string, payload: Record<string, unknown>) => void,
): 'none' | 'running' | 'done' | 'error' {
  const st = analysisStreamReplayByTaskKey.get(taskKey)
  if (!st) return 'none'
  for (const chunk of st.chunks) {
    send('inbox:aiAnalyzeMessageChunk', { messageId: st.messageId, chunk })
  }
  if (st.terminal?.kind === 'done') {
    send('inbox:aiAnalyzeMessageDone', { messageId: st.messageId })
  } else if (st.terminal?.kind === 'error') {
    send('inbox:aiAnalyzeMessageError', st.terminal.payload)
  }
  console.log(
    `[INBOX_ANALYSIS_REPLAY_SENT] ${JSON.stringify({
      taskKey,
      messageId: st.messageId,
      requestId: st.requestId,
      chunks: st.chunks.length,
      terminal: st.terminal?.kind ?? 'running',
      elapsedMs: Date.now() - st.startedAt,
    })}`,
  )
  return st.terminal?.kind ?? 'running'
}

export async function waitForInboxAiTask(taskKey: string): Promise<boolean> {
  const existing = inboxAiTaskInflight.get(taskKey)
  if (!existing || existing.state !== 'running') return false
  console.log(
    `[AI_TASK_QUEUED] ${JSON.stringify({
      taskKey,
      existingRequestId: existing.requestId,
      elapsedMs: Date.now() - existing.startedAt,
    })}`,
  )
  try {
    await existing.promise
  } catch {
    /* The queued task should still proceed; the original task reports its own terminal state. */
  }
  return true
}

function classifyTerminalState(err: unknown, signal: AbortSignal): InflightEntry['state'] {
  if (signal.aborted) return 'aborted'
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (/timeout|LLM_TIMEOUT/i.test(msg)) return 'timeout'
  return 'error'
}

function logInboxAiTaskTerminal(
  event: 'DONE' | 'ERROR' | 'TIMEOUT' | 'ABORTED',
  payload: Record<string, unknown>,
): void {
  console.log(`[INBOX_OLLAMA_STREAM_${event}] ${JSON.stringify(payload)}`)
}

export function isDraftReplyRunStale(messageId: string, genAtStart: number): boolean {
  return genAtStart !== getDraftReplyGeneration(messageId)
}

/**
 * Runs `run` at most once per taskKey concurrently. Duplicate callers await the same promise.
 * `supersede` aborts any prior analysis stream for the same message (via abortControllers) and
 * clears inflight entries for `supersedeKeyPrefix`.
 */
export async function runInboxAiTaskWithDedup<T extends Record<string, unknown>>(
  taskKey: string,
  opts: {
    supersede?: boolean
    supersedeKeyPrefix: string
    messageId: string
    abortControllers?: Map<string, AbortController>
  },
  run: (requestId: string, signal: AbortSignal) => Promise<T>,
): Promise<T & { requestId: string; deduped?: boolean }> {
  const { supersede, supersedeKeyPrefix, messageId, abortControllers } = opts

  if (supersede) {
    if (abortControllers) {
      const prev = abortControllers.get(messageId)
      if (prev) {
        logInboxAiTaskTerminal('ABORTED', {
          taskKey,
          messageId,
          retryReason: 'supersede',
        })
      }
      prev?.abort()
      abortControllers.delete(messageId)
    }
    removeInflightKeysWithPrefix(supersedeKeyPrefix)
    clearAnalysisStreamReplayPrefix(supersedeKeyPrefix)
  }

  const existing = inboxAiTaskInflight.get(taskKey)
  if (existing && !supersede) {
    console.log(
      `[AI_TASK_DEDUPED] ${JSON.stringify({
        taskKey,
        existingRequestId: existing.requestId,
        previousRequestId: existing.requestId,
        previousState: existing.state,
        elapsedMs: Date.now() - existing.startedAt,
      })}`,
    )
    const r = (await existing.promise) as T
    return { ...r, requestId: existing.requestId, deduped: true }
  }

  const requestId = randomUUID()
  const startedAt = Date.now()
  console.log(`[AI_TASK_START] taskKey=${taskKey} requestId=${requestId}`)

  const ac = new AbortController()
  if (abortControllers) {
    abortControllers.set(messageId, ac)
  }

  // Extract lane and model from taskKey (format: kind:messageId:model:lane)
  const taskKeyParts = taskKey.split(':')
  const taskLane = taskKeyParts[taskKeyParts.length - 1] ?? 'local'
  const taskModel = taskKeyParts[2] ?? ''
  const isLocalLane = taskLane === 'local' || taskLane === 'unset'

  const promise = (async (): Promise<T> => {
    // GPU guard: skip local Ollama when running in CPU-only mode.
    // GPU can handle concurrent inferences; CPU cannot handle them at all.
    if (isLocalLane) {
      const blocked = await localOllamaBlocked(taskModel)
      if (blocked.blocked) {
        console.warn(`[INBOX_AI] Skipping local Ollama analysis for ${messageId}: ${blocked.reason}`)
        throw new Error(`LLM_UNAVAILABLE: ${blocked.reason}`)
      }
    }

    try {
      const result = await run(requestId, ac.signal)
      const terminalState: InflightEntry['state'] = ac.signal.aborted ? 'aborted' : 'done'
      const cur = inboxAiTaskInflight.get(taskKey)
      if (cur?.requestId === requestId) cur.state = terminalState
      logInboxAiTaskTerminal(terminalState === 'aborted' ? 'ABORTED' : 'DONE', {
        taskKey,
        requestId,
        messageId,
        elapsedMs: Date.now() - startedAt,
      })
      if (isLocalLane) recordLocalOllamaOutcome(false)
      return result
    } catch (err) {
      const terminalState = classifyTerminalState(err, ac.signal)
      const isTimeout = terminalState === 'timeout'
      if (isLocalLane && isTimeout) recordLocalOllamaOutcome(true)
      const cur = inboxAiTaskInflight.get(taskKey)
      if (cur?.requestId === requestId) cur.state = terminalState
      logInboxAiTaskTerminal(
        isTimeout ? 'TIMEOUT' : terminalState === 'aborted' ? 'ABORTED' : 'ERROR',
        {
          taskKey,
          requestId,
          messageId,
          elapsedMs: Date.now() - startedAt,
          error: err instanceof Error ? err.message : String(err),
        },
      )
      throw err
    } finally {
      if (abortControllers?.get(messageId) === ac) {
        abortControllers.delete(messageId)
      }
    }
  })()

  inboxAiTaskInflight.set(taskKey, { requestId, promise, startedAt, state: 'running' })

  promise.finally(() => {
    const cur = inboxAiTaskInflight.get(taskKey)
    if (cur?.requestId === requestId) {
      inboxAiTaskInflight.delete(taskKey)
      console.log(
        `[INBOX_ANALYSIS_TASK_CLEARED] ${JSON.stringify({
          taskKey,
          requestId,
          messageId,
          previousState: cur.state,
          elapsedMs: Date.now() - startedAt,
        })}`,
      )
    }
  })

  const result = (await promise) as T
  return { ...result, requestId }
}
