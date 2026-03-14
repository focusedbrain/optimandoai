/**
 * Domain Router — Routes queries to appropriate subsystems based on intent
 *
 * Preserves handshake scoping and traceability.
 * Does not modify BEAP security or capsule validation.
 */

import type { ChatIntent } from './intentClassifier'

export type RouterDomain = 'rag' | 'inbox' | 'semantic' | 'handshake_rag'

export interface RouterResult {
  /** Whether to continue to LLM pipeline (RAG) or return structured result */
  useRagPipeline: boolean
  domain: RouterDomain
  /** For non-RAG: force semantic search with this scope */
  forceSemanticSearch?: boolean
  /** For handshake_context_query: prefer handshake scope when available */
  preferHandshakeScope?: boolean
}

/**
 * Routes based on detected intent.
 * All paths preserve handshake_id, capsule_id, block_id traceability.
 */
export function routeByIntent(intent: ChatIntent, hasHandshakeScope: boolean): RouterResult {
  switch (intent) {
    case 'knowledge_query':
      return {
        useRagPipeline: true,
        domain: 'rag',
        preferHandshakeScope: hasHandshakeScope,
      }
    case 'handshake_context_query':
      return {
        useRagPipeline: true,
        domain: 'handshake_rag',
        preferHandshakeScope: true,
      }
    case 'document_lookup':
      return {
        useRagPipeline: true,
        domain: 'handshake_rag',
        preferHandshakeScope: hasHandshakeScope,
      }
    case 'inbox_lookup':
      return {
        useRagPipeline: false,
        domain: 'inbox',
        forceSemanticSearch: true,
      }
    case 'general_search':
      return {
        useRagPipeline: false,
        domain: 'semantic',
        forceSemanticSearch: true,
      }
    default:
      return {
        useRagPipeline: true,
        domain: 'rag',
      }
  }
}
