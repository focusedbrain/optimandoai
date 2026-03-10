/**
 * Block-Level Retrieval for RAG
 *
 * Never sends the full capsule. Retrieves top-k blocks by cosine similarity,
 * builds a token-limited prompt from retrieved blocks only.
 */

import type { ScoredContextBlock } from './types'

// ── Block Index Structure ───────────────────────────────────────────────────
// Each block in the index has: id, title, text content, embedding (stored in DB).

export interface BlockIndexEntry {
  id: string
  title: string
  text: string
  /** Embedding stored in context_embeddings; not loaded into memory for retrieval. */
  embeddingRef?: { sender_wrdesk_user_id: string; block_id: string; block_hash: string }
}

/** Scored block from retrieval (includes similarity score for deterministic ordering). */
export interface RetrievedBlock {
  id: string
  title: string
  text: string
  score: number
  handshake_id: string
  block_id: string
  source: 'received' | 'sent'
}

// ── Constants ───────────────────────────────────────────────────────────────

/** Default number of blocks to retrieve. */
export const DEFAULT_TOP_K = 5

/** Approximate chars per token (conservative for Latin text). */
const CHARS_PER_TOKEN = 4

/** Max context tokens to include in prompt. */
export const MAX_CONTEXT_TOKENS = 1500

// ── Text Extraction ──────────────────────────────────────────────────────────
// Payload may be JSON or plain text. Extract readable text for the prompt.

function extractTextFromPayload(payload: string): string {
  if (!payload || typeof payload !== 'string') return ''
  const trimmed = payload.trim()
  if (!trimmed) return ''

  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed === 'string') return parsed
    if (typeof parsed === 'number' || typeof parsed === 'boolean') return String(parsed)
    if (Array.isArray(parsed)) {
      return parsed.map(extractTextFromPayload).filter(Boolean).join('\n')
    }
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed)
        .map(([k, v]) => {
          if (v == null) return ''
          if (typeof v === 'string') return `${k}: ${v}`
          if (typeof v === 'object') return `${k}:\n${extractTextFromPayload(JSON.stringify(v))}`
          return `${k}: ${String(v)}`
        })
        .filter(Boolean)
        .join('\n')
    }
  } catch {
    /* not JSON, use as-is */
  }
  return trimmed
}

/** Derive a human-readable title from block_id (e.g. "opening_hours.schedule" → "Opening Hours Schedule"). */
function blockIdToTitle(blockId: string): string {
  if (!blockId) return 'Block'
  return blockId
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

// ── Conversion ──────────────────────────────────────────────────────────────

/** Convert ScoredContextBlock (from semanticSearch) to RetrievedBlock. */
export function scoredBlocksToRetrieved(blocks: ScoredContextBlock[]): RetrievedBlock[] {
  return blocks.map(r => ({
    id: `${r.handshake_id}:${r.block_id}`,
    title: blockIdToTitle(r.block_id),
    text: extractTextFromPayload(r.payload_ref ?? ''),
    score: r.score ?? 0,
    handshake_id: r.handshake_id,
    block_id: r.block_id,
    source: (r.source as 'received' | 'sent') ?? 'sent',
  }))
}

// ── Retrieval ───────────────────────────────────────────────────────────────

export interface RetrieveBlocksOptions {
  topK?: number
  filter?: { relationship_id?: string; handshake_id?: string }
}

/**
 * Retrieves the top-k most relevant blocks for a query using cosine similarity.
 * Uses semanticSearch under the hood. Deterministic: sorted by score desc, then block_id asc for ties.
 */
export async function retrieveBlocks(
  db: any,
  query: string,
  embeddingService: { generateEmbedding(text: string): Promise<Float32Array> },
  options: RetrieveBlocksOptions = {}
): Promise<RetrievedBlock[]> {
  const { semanticSearch } = await import('./embeddings')
  const topK = options.topK ?? DEFAULT_TOP_K
  const filter = options.filter ?? {}

  const scored = await semanticSearch(db, query, filter, Math.max(topK, 10), embeddingService)
  const blocks = scoredBlocksToRetrieved(scored)

  // Deterministic sort: by score desc, then by block_id asc for ties
  blocks.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.block_id.localeCompare(b.block_id)
  })

  return blocks.slice(0, topK)
}

// ── Prompt Builder ───────────────────────────────────────────────────────────

/**
 * Builds the LLM prompt using only retrieved blocks.
 * Limits total context tokens. Never includes the full capsule.
 */
export function buildRagPrompt(
  blocks: RetrievedBlock[],
  userQuestion: string,
  maxContextTokens: number = MAX_CONTEXT_TOKENS
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are a helpful assistant answering questions based on handshake context data.
You will receive only the most relevant context blocks for the question.
Each block is prefixed with [block_id: <id>]. Always cite which block your information comes from using that exact notation (e.g. [block_id: opening_hours.schedule]).
If the provided context does not contain enough information to answer, say so clearly.
Do not make up information.`

  const parts: string[] = []
  let totalChars = 0
  const maxChars = maxContextTokens * CHARS_PER_TOKEN

  for (const block of blocks) {
    if (!block.text.trim()) continue
    const blockSection = `[block_id: ${block.block_id}]\n${block.text}`
    const blockChars = blockSection.length
    if (totalChars + blockChars > maxChars && parts.length > 0) break
    parts.push(blockSection)
    totalChars += blockChars
  }

  const contextSection = parts.length > 0
    ? `Context blocks:\n${parts.join('\n\n')}`
    : '(No relevant context blocks were found.)'

  const userPrompt = `${contextSection}\n\nUser question:\n${userQuestion}`

  return { systemPrompt, userPrompt }
}
