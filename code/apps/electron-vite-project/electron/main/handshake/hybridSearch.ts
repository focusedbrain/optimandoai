/**
 * Hybrid Search — Parallel Structured + Semantic Retrieval
 *
 * When a user question arrives:
 * 1. Run structured lookup and semantic retrieval in parallel
 * 2. If structured returns a confident result → return immediately
 * 3. Otherwise send retrieved blocks to the LLM
 *
 * Minimizes latency via concurrency; deterministic fallback.
 */

import type { ScoredContextBlock } from './types'
import {
  queryClassifier,
  structuredLookup,
  structuredLookupMulti,
  fetchBlocksForStructuredLookup,
  type StructuredLookupFilter,
  type StructuredLookupResult,
} from './structuredQuery'
import type { LocalEmbeddingService } from './embeddings'
import { timed, timedSync, now, elapsedMs, checkStructuredLatency, logStructuredMetrics } from './latencyInstrumentation'

export interface HybridSearchFilter {
  relationship_id?: string
  handshake_id?: string
}

export interface HybridSearchResult {
  /** 'structured' = fast-path answer; 'semantic' = blocks for LLM */
  mode: 'structured' | 'semantic'
  /** Present when mode=structured */
  structured?: StructuredLookupResult
  /** Present when mode=semantic; top 5 blocks for prompt */
  blocks?: ScoredContextBlock[]
  /** Latency metrics for instrumentation */
  metrics?: HybridSearchMetrics
}

export interface HybridSearchMetrics {
  classification_ms: number
  structured_ms: number
  semantic_ms: number
}

const SEMANTIC_TOP_K = 5

/**
 * Runs structured lookup and semantic retrieval in parallel.
 * Returns structured result if confident; otherwise semantic blocks.
 * Includes timing metrics for each stage.
 */
export async function hybridSearch(
  db: any,
  query: string,
  filter: HybridSearchFilter,
  embeddingService: LocalEmbeddingService,
): Promise<HybridSearchResult> {
  const totalStart = now()
  const trimmedQuery = query?.trim() ?? ''
  const structuredFilter: StructuredLookupFilter = filter

  // 1. Classify (sync, fast) — skip structured path if no match
  const [classifierResult, classification_ms] = timedSync(() => queryClassifier(trimmedQuery))

  // 2. Run both paths in parallel with timing
  const [[structuredResult, structured_ms], [semanticBlocks, semantic_ms]] = await Promise.all([
    timed(() => runStructuredPath(db, trimmedQuery, structuredFilter, classifierResult)),
    timed(() => runSemanticPath(db, trimmedQuery, filter, embeddingService)),
  ])

  const metrics: HybridSearchMetrics = {
    classification_ms,
    structured_ms,
    semantic_ms,
  }

  // 3. Decision: structured confident → return immediately
  if (structuredResult?.found && structuredResult?.value) {
    const total_ms = elapsedMs(totalStart)
    checkStructuredLatency(total_ms)
    logStructuredMetrics({
      structured_ms,
      semantic_ms,
      classification_ms,
      total_ms,
    })
    return {
      mode: 'structured',
      structured: structuredResult,
      metrics,
    }
  }

  // 4. Fallback: use semantic blocks for LLM
  return {
    mode: 'semantic',
    blocks: semanticBlocks,
    metrics,
  }
}

async function runStructuredPath(
  db: any,
  _query: string,
  filter: StructuredLookupFilter,
  classifierResult: { matched: boolean; fieldPath?: string; fieldPaths?: string[] },
): Promise<StructuredLookupResult | null> {
  if (!classifierResult.matched) return null
  if (classifierResult.fieldPaths && classifierResult.fieldPaths.length > 0) {
    const pathForFetch = classifierResult.fieldPaths[0]
    const blocks = fetchBlocksForStructuredLookup(db, filter, pathForFetch)
    if (blocks.length === 0) return { found: false }
    return structuredLookupMulti(blocks, classifierResult.fieldPaths)
  }
  if (!classifierResult.fieldPath) return null
  const blocks = fetchBlocksForStructuredLookup(db, filter, classifierResult.fieldPath)
  if (blocks.length === 0) return { found: false }
  return structuredLookup(blocks, classifierResult.fieldPath)
}

async function runSemanticPath(
  db: any,
  query: string,
  filter: HybridSearchFilter,
  embeddingService: LocalEmbeddingService,
): Promise<ScoredContextBlock[]> {
  const { semanticSearch } = await import('./embeddings')
  const results = await semanticSearch(db, query, filter, SEMANTIC_TOP_K, embeddingService)
  return results
}
