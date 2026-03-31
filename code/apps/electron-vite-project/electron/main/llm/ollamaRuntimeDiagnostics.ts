/**
 * Optional traces for local Ollama HTTP calls (GPU use is decided by the Ollama server, not this app).
 * Flip `DEBUG_OLLAMA_RUNTIME_TRACE` only while correlating with `nvidia-smi` / Task Manager / Ollama logs.
 *
 * **Concurrency:** Ollama often serializes or queues multiple concurrent `/api/chat` requests. Higher in-flight counts
 * can *increase* wall time per message on a single-GPU box. Tune with `WRDESK_OLLAMA_CLASSIFY_MAX_CONCURRENT` in ipc.
 */

import { DEBUG_AUTOSORT_TIMING } from '../autosortDiagnostics'

export const DEBUG_OLLAMA_RUNTIME_TRACE = false

/** Passed from inbox classify into `generateChat` for correlated logs (bulk auto-sort). */
export interface OllamaRuntimeRequestTrace {
  source?: 'bulk_autosort' | string
  runId?: string
  /** Renderer IPC chunk (1-based Auto-Sort loop iteration). */
  chunkIndex?: number
  /** Message index within the current chunk (0-based). */
  batchIndex?: number
}

let inFlightChatRequests = 0

type BatchScope = {
  runId?: string
  chunkIndex?: number
  chunkSize: number
  capped: boolean
  effectiveConcurrency: number
  maxInFlight: number
}

let batchScope: BatchScope | null = null

const trackBatchScope = (): boolean => DEBUG_AUTOSORT_TIMING || DEBUG_OLLAMA_RUNTIME_TRACE

function touchBatchMaxInFlight(): void {
  if (!batchScope) return
  const n = inFlightChatRequests
  if (n > batchScope.maxInFlight) batchScope.maxInFlight = n
}

export type OllamaClassifyBatchChunkDiag = {
  runId?: string
  chunkIndex?: number
  chunkSize: number
  capped: boolean
  effectiveConcurrency: number
  /** Peak concurrent Ollama `/api/chat` requests seen during this chunk (`ollamaRuntimeInFlightDelta`). */
  maxInFlightSeenDuringChunk: number
}

/** Call at start of `inbox:aiClassifyBatch` local LLM work (once per IPC chunk). */
export function ollamaRuntimeBeginBatch(meta: {
  runId?: string
  chunkIndex?: number
  chunkSize: number
  capped: boolean
  effectiveConcurrency: number
}): void {
  if (!trackBatchScope()) return
  batchScope = {
    runId: meta.runId,
    chunkIndex: meta.chunkIndex,
    chunkSize: meta.chunkSize,
    capped: meta.capped,
    effectiveConcurrency: meta.effectiveConcurrency,
    maxInFlight: inFlightChatRequests,
  }
}

/**
 * Ends batch scope; logs when `DEBUG_OLLAMA_RUNTIME_TRACE`. Returns diag for `DEBUG_AUTOSORT_TIMING` merge in ipc.
 */
export function ollamaRuntimeEndBatch(): OllamaClassifyBatchChunkDiag | null {
  const s = batchScope
  batchScope = null
  if (!s) return null
  if (DEBUG_OLLAMA_RUNTIME_TRACE) {
    ollamaRuntimeLog('ollamaRuntime:aiClassifyBatch_chunk', {
      runId: s.runId ?? null,
      chunkIndex: s.chunkIndex ?? null,
      chunkSize: s.chunkSize,
      ollamaConcurrencyCapped: s.capped,
      requestsConcurrencyCapped: s.capped,
      effectiveConcurrency: s.effectiveConcurrency,
      maxInFlightSeenDuringChunk: s.maxInFlight,
    })
  }
  return {
    runId: s.runId,
    chunkIndex: s.chunkIndex,
    chunkSize: s.chunkSize,
    capped: s.capped,
    effectiveConcurrency: s.effectiveConcurrency,
    maxInFlightSeenDuringChunk: s.maxInFlight,
  }
}

export function ollamaRuntimeInFlightDelta(delta: 1 | -1): number {
  inFlightChatRequests += delta
  touchBatchMaxInFlight()
  return inFlightChatRequests
}

export function ollamaRuntimeGetInFlight(): number {
  return inFlightChatRequests
}

export function ollamaRuntimeLog(tag: string, data?: Record<string, unknown>): void {
  if (!DEBUG_OLLAMA_RUNTIME_TRACE) return
  console.log(`[OLLAMA-RUNTIME] ${tag}`, data ?? {})
}

/** Ollama returns durations in nanoseconds in /api/chat JSON. */
export function nsToMs(ns: number | undefined): number | undefined {
  if (typeof ns !== 'number' || !Number.isFinite(ns)) return undefined
  return Math.round(ns / 1e6)
}

// ── Lightweight ring buffer for /api/chat timing (used by local LLM runtime hints; bounded memory) ──

const CHAT_TIMING_MAX = 5
const CHAT_TIMING_MAX_AGE_MS = 120_000

type ChatTimingSample = { wallMs: number; loadMs?: number; totalMs?: number; at: number }

let chatTimingSamples: ChatTimingSample[] = []

/** Called after successful non-stream Ollama /api/chat (best-effort). */
export function ollamaRuntimeRecordChatTiming(wallMs: number, totalNs?: number, loadNs?: number): void {
  const loadMs = loadNs != null ? Math.round(loadNs / 1e6) : undefined
  const totalMs = totalNs != null ? Math.round(totalNs / 1e6) : undefined
  chatTimingSamples.push({
    wallMs,
    loadMs,
    totalMs,
    at: Date.now(),
  })
  while (chatTimingSamples.length > CHAT_TIMING_MAX) chatTimingSamples.shift()
}

/**
 * Heuristic: several recent completions with low reported load_duration → layers likely already resident.
 * Does not imply GPU — only that Ollama did not spend long loading weights for those calls.
 */
export function ollamaRuntimeObservedWarmModel(): boolean {
  const now = Date.now()
  const recent = chatTimingSamples.filter((s) => now - s.at <= CHAT_TIMING_MAX_AGE_MS)
  if (recent.length < 2) return false
  const lowLoad = recent.filter((s) => (s.loadMs ?? 9_999_999) < 400).length
  return lowLoad >= 2
}
