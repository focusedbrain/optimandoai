/**
 * Regression: `handshake.semanticSearch` — when the semantic/embed path throws, the IPC handler
 * logs a warning and returns success with keyword/none retrieval (matches HybridSearch degraded analysis).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SEMANTIC_SEARCH_LOG_TAG } from '../contextRetrievalTypes'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/wrdesk-semantic-fallback-regression',
    getAppPath: () => '/tmp/wrdesk-semantic-fallback-regression',
  },
}))

const semanticSearchMock = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error('Ollama embedding failed: 500')
  }),
)

vi.mock('../embeddings', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../embeddings')>()
  return {
    ...mod,
    semanticSearch: semanticSearchMock,
  }
})

import { handleHandshakeRPC } from '../ipc'

/** Minimal DB stub: keyword path runs `prepare().all()` (no `context_blocks` table → empty rows). */
function createKeywordOnlySearchStubDb() {
  return {
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      get: vi.fn(() => undefined),
    })),
  }
}

describe('handshake.semanticSearch — embed failure → keyword/none fallback', () => {
  let db: ReturnType<typeof createKeywordOnlySearchStubDb>

  beforeEach(() => {
    vi.clearAllMocks()
    db = createKeywordOnlySearchStubDb()
    ;(globalThis as unknown as { __og_vault_service_ref?: { getEmbeddingService?: () => unknown } }).__og_vault_service_ref =
      {
        getEmbeddingService: () => ({ modelId: 'nomic-embed-text' }),
      }
  })

  afterEach(() => {
    delete (globalThis as unknown as { __og_vault_service_ref?: unknown }).__og_vault_service_ref
    vi.restoreAllMocks()
  })

  it('Test 2: semanticSearch throws → console.warn with SEMANTIC_SEARCH_SKIPPED; success + contextRetrieval mode keyword or none', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await handleHandshakeRPC(
      'handshake.semanticSearch',
      { query: 'refund policy clauses', scope: 'hs-scope-x', limit: 10 },
      db as unknown as Parameters<typeof handleHandshakeRPC>[2],
    )

    expect(semanticSearchMock).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls.some((c) => c[0] === SEMANTIC_SEARCH_LOG_TAG)).toBe(true)
    const tagCall = warnSpy.mock.calls.find((c) => c[0] === SEMANTIC_SEARCH_LOG_TAG)
    expect(String(tagCall?.[1] ?? '')).toMatch(/embedding/i)

    expect(res.success).toBe(true)
    expect(res.degraded).toBe('keyword_fallback')
    expect(['keyword', 'none']).toContain(res.contextRetrieval?.mode)
    expect(res.contextRetrieval?.ok).toBe(true)
    expect(res.contextRetrieval?.warningCode).toBe('semantic_embed_failed')

    warnSpy.mockRestore()
  })
})
