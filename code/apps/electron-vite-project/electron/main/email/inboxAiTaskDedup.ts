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

  const promise = (async (): Promise<T> => {
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
      return result
    } catch (err) {
      const terminalState = classifyTerminalState(err, ac.signal)
      const cur = inboxAiTaskInflight.get(taskKey)
      if (cur?.requestId === requestId) cur.state = terminalState
      logInboxAiTaskTerminal(
        terminalState === 'timeout' ? 'TIMEOUT' : terminalState === 'aborted' ? 'ABORTED' : 'ERROR',
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
