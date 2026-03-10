/**
 * Latency Instrumentation — Performance monitoring for AI retrieval pipeline
 *
 * Tracks timing across key stages:
 * - Query classification
 * - Structured lookup
 * - Semantic retrieval
 * - LLM call
 * - Total request time
 *
 * Emits metrics to logs and enforces latency budgets.
 */

// ── Constants ───────────────────────────────────────────────────────────────

export const STRUCTURED_LATENCY_BUDGET_MS = 50
export const AI_LATENCY_BUDGET_MS = 2000

// ── Types ───────────────────────────────────────────────────────────────────

export interface QueryLatencyMetrics {
  query_ms_total: number
  classification_ms?: number
  structured_ms?: number
  semantic_ms?: number
  block_retrieval_ms?: number
  llm_ms?: number
  cache_hit: boolean
  provider?: string
  mode?: 'cache' | 'structured' | 'semantic'
}

export interface LatencyDebugPayload {
  total_ms: number
  classification_ms?: number
  structured_ms?: number
  semantic_ms?: number
  block_retrieval_ms?: number
  llm_ms?: number
  cache_hit?: boolean
  provider?: string
}

// ── Timer utilities ────────────────────────────────────────────────────────

/** Returns current timestamp in ms (performance.now or Date.now fallback). */
export function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/** Elapsed ms since start. */
export function elapsedMs(start: number): number {
  return Math.round(now() - start)
}

/** Run an async fn and return [result, elapsedMs]. */
export async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = now()
  const result = await fn()
  return [result, elapsedMs(start)]
}

/** Run a sync fn and return [result, elapsedMs]. */
export function timedSync<T>(fn: () => T): [T, number] {
  const start = now()
  const result = fn()
  return [result, elapsedMs(start)]
}

// ── Budget checks ───────────────────────────────────────────────────────────

export function checkStructuredLatency(ms: number): void {
  if (ms > STRUCTURED_LATENCY_BUDGET_MS) {
    console.warn(`[LATENCY] STRUCTURED_LATENCY_EXCEEDED structured_ms=${ms} budget=${STRUCTURED_LATENCY_BUDGET_MS}`)
  }
}

export function checkAILatency(ms: number): void {
  if (ms > AI_LATENCY_BUDGET_MS) {
    console.warn(`[LATENCY] AI_LATENCY_EXCEEDED total_ms=${ms} budget=${AI_LATENCY_BUDGET_MS}`)
  }
}

// ── Logging ─────────────────────────────────────────────────────────────────

export function logStructuredMetrics(metrics: {
  structured_ms: number
  semantic_ms: number
  classification_ms?: number
  total_ms: number
}): void {
  console.log(
    '[LATENCY] STRUCTURED_QUERY_METRICS',
    JSON.stringify({
      structured_ms: metrics.structured_ms,
      semantic_ms: metrics.semantic_ms,
      classification_ms: metrics.classification_ms,
      total_ms: metrics.total_ms,
    })
  )
}

export function logAIQueryMetrics(metrics: {
  structured_ms: number
  semantic_ms: number
  llm_ms: number
  total_ms: number
  provider: string
  classification_ms?: number
}): void {
  console.log(
    '[LATENCY] AI_QUERY_METRICS',
    JSON.stringify({
      structured_ms: metrics.structured_ms,
      semantic_ms: metrics.semantic_ms,
      llm_ms: metrics.llm_ms,
      total_ms: metrics.total_ms,
      provider: metrics.provider,
      classification_ms: metrics.classification_ms,
    })
  )
}

export function logCacheHitMetrics(total_ms: number): void {
  console.log('[LATENCY] CACHE_HIT_METRICS', JSON.stringify({ total_ms, cache_hit: true }))
}

// ── Debug payload builder ──────────────────────────────────────────────────

export function buildLatencyDebugPayload(metrics: QueryLatencyMetrics): LatencyDebugPayload {
  return {
    total_ms: metrics.query_ms_total,
    classification_ms: metrics.classification_ms,
    structured_ms: metrics.structured_ms,
    semantic_ms: metrics.semantic_ms,
    block_retrieval_ms: metrics.block_retrieval_ms,
    llm_ms: metrics.llm_ms,
    cache_hit: metrics.cache_hit,
    provider: metrics.provider,
  }
}
