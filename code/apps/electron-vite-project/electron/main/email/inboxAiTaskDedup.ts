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

type InflightEntry = { requestId: string; promise: Promise<unknown> }

const inboxAiTaskInflight = new Map<string, InflightEntry>()

export const analyzeStreamAbortByMessageId = new Map<string, AbortController>()

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
      abortControllers.get(messageId)?.abort()
      abortControllers.delete(messageId)
    }
    removeInflightKeysWithPrefix(supersedeKeyPrefix)
  }

  const existing = inboxAiTaskInflight.get(taskKey)
  if (existing && !supersede) {
    console.log(`[AI_TASK_DEDUPED] taskKey=${taskKey} existingRequestId=${existing.requestId}`)
    const r = (await existing.promise) as T
    return { ...r, requestId: existing.requestId, deduped: true }
  }

  const requestId = randomUUID()
  console.log(`[AI_TASK_START] taskKey=${taskKey} requestId=${requestId}`)

  const ac = new AbortController()
  if (abortControllers) {
    abortControllers.set(messageId, ac)
  }

  const promise = (async (): Promise<T> => {
    try {
      return await run(requestId, ac.signal)
    } finally {
      if (abortControllers?.get(messageId) === ac) {
        abortControllers.delete(messageId)
      }
    }
  })()

  inboxAiTaskInflight.set(taskKey, { requestId, promise })

  promise.finally(() => {
    const cur = inboxAiTaskInflight.get(taskKey)
    if (cur?.requestId === requestId) inboxAiTaskInflight.delete(taskKey)
  })

  const result = (await promise) as T
  return { ...result, requestId }
}
