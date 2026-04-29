/**
 * Intent Execution — Runs non-RAG paths (document lookup, inbox, general search)
 *
 * Uses semantic search over context blocks. Preserves traceability.
 * Does not call LLM; returns structured results.
 */

import type { ChatIntent } from './intentClassifier'
import type { ContextRetrievalResult } from './contextRetrievalTypes'
import { SEMANTIC_SEARCH_LOG_TAG } from './contextRetrievalTypes'

export interface StructuredResultItem {
  id: string
  title: string
  snippet: string
  handshake_id: string
  block_id: string
  source: string
  score: number
  type?: string
}

export interface StructuredExecutionResult {
  success: boolean
  resultType: 'document_card' | 'result_card'
  title: string
  items: StructuredResultItem[]
  sources: Array<{ handshake_id: string; capsule_id?: string; block_id: string; source: string; score: number }>
  latency_ms: number
  intent: ChatIntent
  domain: string
  contextRetrieval?: ContextRetrievalResult
}

function friendlyTypeName(type: string | undefined): string {
  if (!type) return 'Context'
  const map: Record<string, string> = {
    text: 'Text',
    document: 'Document',
    file: 'File',
    json: 'Structured Data',
    profile: 'Profile',
  }
  return map[type.toLowerCase()] ?? type.charAt(0).toUpperCase() + type.slice(1)
}

function truncate(s: string, max = 120): string {
  if (!s) return ''
  return s.length > max ? s.slice(0, max) + '…' : s
}

/**
 * Executes semantic search and returns structured result.
 * Used for document_lookup, inbox_lookup, general_search intents.
 */
export async function executeStructuredSearch(
  db: any,
  query: string,
  filter: { handshake_id?: string; relationship_id?: string },
  embeddingService: { generateEmbedding(text: string): Promise<Float32Array> } | null,
  intent: ChatIntent,
): Promise<StructuredExecutionResult> {
  const start = typeof performance !== 'undefined' ? performance.now() : Date.now()

  const { semanticSearch } = await import('./embeddings')
  const { keywordSearch } = await import('./keywordSearch')

  let results: Awaited<ReturnType<typeof semanticSearch>>
  let contextRetrieval: ContextRetrievalResult

  if (!embeddingService) {
    results = keywordSearch(db, query.trim(), filter, 10)
    contextRetrieval = {
      mode: results.length > 0 ? 'keyword' : 'none',
      ok: true,
      warningCode: 'embedding_service_unavailable',
    }
  } else {
    try {
      results = await semanticSearch(db, query, filter, 10, embeddingService)
      contextRetrieval = { mode: 'semantic', ok: true }
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err)
      console.warn(SEMANTIC_SEARCH_LOG_TAG, detail)
      results = keywordSearch(db, query.trim(), filter, 10)
      contextRetrieval = {
        mode: results.length > 0 ? 'keyword' : 'none',
        ok: true,
        warningCode: 'semantic_embed_failed',
      }
    }
  }

  const domain = intent === 'document_lookup' ? 'inbox' : intent === 'inbox_lookup' ? 'inbox' : 'semantic'
  const title =
    intent === 'document_lookup'
      ? `Documents matching "${truncate(query, 40)}"`
      : intent === 'inbox_lookup'
        ? `BEAP Inbox results for "${truncate(query, 40)}"`
        : `Search results for "${truncate(query, 40)}"`

  const items: StructuredResultItem[] = results.map((r, i) => ({
    id: r.block_id ?? `result-${i}`,
    title: friendlyTypeName(r.type),
    snippet: truncate(r.payload_ref ?? '', 150),
    handshake_id: r.handshake_id,
    block_id: r.block_id,
    source: r.source ?? 'sent',
    score: r.score ?? 0,
    type: r.type,
  }))

  const sources = results.map(r => ({
    handshake_id: r.handshake_id,
    capsule_id: r.handshake_id,
    block_id: r.block_id,
    source: r.source ?? 'sent',
    score: r.score ?? 0,
  }))

  const latency_ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start)

  return {
    success: true,
    resultType: intent === 'document_lookup' || intent === 'inbox_lookup' ? 'document_card' : 'result_card',
    title,
    items,
    sources,
    latency_ms,
    intent,
    domain,
    contextRetrieval,
  }
}
