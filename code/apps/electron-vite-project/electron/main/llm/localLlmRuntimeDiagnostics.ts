/**
 * Optional traces for local llama.cpp HTTP calls.
 * Flip `DEBUG_LOCAL_LLM_RUNTIME_TRACE` only while correlating with GPU/runtime logs.
 */

import { DEBUG_AUTOSORT_TIMING } from '../autosortDiagnostics'

export const DEBUG_LOCAL_LLM_RUNTIME_TRACE = false

/** @deprecated Use DEBUG_LOCAL_LLM_RUNTIME_TRACE */
export const DEBUG_OLLAMA_RUNTIME_TRACE = DEBUG_LOCAL_LLM_RUNTIME_TRACE

/** Passed from inbox classify into `generateChat` for correlated logs (bulk auto-sort). */
export interface LocalLlmRuntimeRequestTrace {
  source?: 'bulk_autosort' | string
  runId?: string
  chunkIndex?: number
  batchIndex?: number
}

/** @deprecated Use LocalLlmRuntimeRequestTrace */
export type OllamaRuntimeRequestTrace = LocalLlmRuntimeRequestTrace

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

const trackBatchScope = (): boolean => DEBUG_AUTOSORT_TIMING || DEBUG_LOCAL_LLM_RUNTIME_TRACE

function touchBatchMaxInFlight(): void {
  if (!batchScope) return
  const n = inFlightChatRequests
  if (n > batchScope.maxInFlight) batchScope.maxInFlight = n
}

export function localLlmRuntimeInFlightDelta(delta: number): number {
  inFlightChatRequests += delta
  if (delta > 0) touchBatchMaxInFlight()
  return inFlightChatRequests
}

/** @deprecated */
export const ollamaRuntimeInFlightDelta = localLlmRuntimeInFlightDelta

export function localLlmRuntimeGetInFlight(): number {
  return inFlightChatRequests
}

/** @deprecated */
export const ollamaRuntimeGetInFlight = localLlmRuntimeGetInFlight

export function localLlmRuntimeLog(event: string, payload: Record<string, unknown>): void {
  if (!DEBUG_LOCAL_LLM_RUNTIME_TRACE) return
  console.warn(`[LOCAL_LLM_RUNTIME] ${event}`, payload)
}

/** @deprecated */
export const ollamaRuntimeLog = localLlmRuntimeLog

export function nsToMs(ns: unknown): number | undefined {
  if (typeof ns !== 'number' || !Number.isFinite(ns)) return undefined
  return Math.round(ns / 1e6)
}

let lastWarmWallMs: number | null = null
let lastWarmLoadMs: number | null = null

export function localLlmRuntimeRecordChatTiming(wallMs: number, _totalDurationNs?: number, loadDurationNs?: number): void {
  lastWarmWallMs = wallMs
  const loadMs = loadDurationNs != null ? nsToMs(loadDurationNs) : undefined
  if (loadMs != null) lastWarmLoadMs = loadMs
}

/** @deprecated */
export const ollamaRuntimeRecordChatTiming = localLlmRuntimeRecordChatTiming

/** Heuristic: recent chat had low load time — model likely resident (GPU vs CPU not determined). */
export function localLlmRuntimeObservedWarmModel(): boolean {
  if (lastWarmLoadMs != null && lastWarmLoadMs < 200) return true
  if (lastWarmWallMs != null && lastWarmWallMs < 500) return true
  return false
}

/** @deprecated */
export const ollamaRuntimeObservedWarmModel = localLlmRuntimeObservedWarmModel

export function localLlmRuntimeSetBatchScope(scope: BatchScope | null): void {
  batchScope = scope
}

/** @deprecated */
export const ollamaRuntimeSetBatchScope = localLlmRuntimeSetBatchScope

export function localLlmRuntimeGetBatchScope(): BatchScope | null {
  return batchScope
}

/** @deprecated */
export const ollamaRuntimeGetBatchScope = localLlmRuntimeGetBatchScope

export function localLlmRuntimeShouldTrackBatch(): boolean {
  return trackBatchScope()
}

/** @deprecated */
export const ollamaRuntimeShouldTrackBatch = localLlmRuntimeShouldTrackBatch

export type LocalLlmClassifyBatchChunkDiag = {
  runId?: string
  chunkIndex?: number
  chunkSize: number
  capped: boolean
  effectiveConcurrency: number
  maxInFlightSeenDuringChunk: number
}

/** @deprecated Use LocalLlmClassifyBatchChunkDiag */
export type OllamaClassifyBatchChunkDiag = LocalLlmClassifyBatchChunkDiag

/** Call at start of `inbox:aiClassifyBatch` local LLM work (once per IPC chunk). */
export function localLlmRuntimeBeginBatch(meta: {
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

/** @deprecated Use localLlmRuntimeBeginBatch */
export const ollamaRuntimeBeginBatch = localLlmRuntimeBeginBatch

export function localLlmRuntimeEndBatch(): LocalLlmClassifyBatchChunkDiag | null {
  const s = batchScope
  batchScope = null
  if (!s) return null
  if (DEBUG_LOCAL_LLM_RUNTIME_TRACE) {
    localLlmRuntimeLog('localLlmRuntime:aiClassifyBatch_chunk', {
      runId: s.runId ?? null,
      chunkIndex: s.chunkIndex ?? null,
      chunkSize: s.chunkSize,
      concurrencyCapped: s.capped,
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

/** @deprecated Use localLlmRuntimeEndBatch */
export const ollamaRuntimeEndBatch = localLlmRuntimeEndBatch
