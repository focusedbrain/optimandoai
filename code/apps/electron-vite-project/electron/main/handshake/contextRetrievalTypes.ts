/**
 * Shared metadata for vault / handshake context retrieval (semantic vs keyword).
 */

export type ContextRetrievalMode = 'semantic' | 'keyword' | 'none'

export type ContextRetrievalResult = {
  mode: ContextRetrievalMode
  ok: boolean
  warningCode?: string
}

/** Logged when semantic/embed path is skipped and a fallback runs. */
export const SEMANTIC_SEARCH_LOG_TAG = '[SEMANTIC_SEARCH_SKIPPED]' as const
