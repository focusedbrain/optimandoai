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

/** System instruction for context-grounded answers. */
const CONTEXT_GROUNDED_SYSTEM_PROMPT = `You are a context-grounded assistant.
You must answer questions using ONLY the information provided in the context blocks.

Rules:
* ALWAYS respond in clear, natural language. NEVER output raw JSON, code, or data structures.
* If the context contains structured data (like schedules, addresses, contact info), present it in a readable, well-formatted way.
* If the answer exists in the context blocks, answer using only that information.
* Do not use external knowledge.
* If the context does not contain the answer, respond exactly with:
  'The provided context does not contain this information.'
* If no context blocks are provided, inform the user that contextual search is currently unavailable.
* Do NOT include block_id references, source citations, or technical identifiers in your answer. Keep the answer clean and user-friendly.
* Match the language of the user's question in your response (e.g. if the user asks in German, respond in German).`

export interface ConversationContext {
  /** Previous answer — used when user asks follow-up questions like "What does this mean?" */
  lastAnswer?: string
}

export interface BuildPromptOptions {
  /** When true and contextBlocks is empty: use "contextual search unavailable". When false: use "retrieved blocks did not contain relevant information". */
  retrievalFailed?: boolean
  /** When present and lastAnswer is set: prepend to prompt so LLM can resolve "this"/"that" references. */
  conversationContext?: ConversationContext
}

/**
 * Centralized prompt builder for context-grounded LLM requests.
 * Handles both successful retrieval and retrieval failure (empty context).
 *
 * @param contextBlocks - Formatted context string (block_id + content per block). Use "" when retrieval failed.
 * @param question - User question
 * @param options - retrievalFailed: true when embedding/vector search failed; false when blocks were retrieved but filtered out
 * @returns { system, user } - Ready for messages array
 */
export function buildPrompt(
  contextBlocks: string,
  question: string,
  options?: BuildPromptOptions
): { system: string; user: string } {
  let contextSection: string
  if (contextBlocks.trim()) {
    contextSection = contextBlocks.trim()
  } else if (options?.retrievalFailed) {
    contextSection = '(No context blocks available. Contextual search is currently unavailable.)'
  } else {
    contextSection = '(The retrieved blocks did not contain information relevant to the question.)'
  }

  let user = `Context blocks:
${contextSection}
`
  if (options?.conversationContext?.lastAnswer?.trim()) {
    user += `
Previous answer (the user may be referring to this when asking "what does this mean?" or similar):
${options.conversationContext.lastAnswer.trim()}

`
  }
  user += `
User question:
${question}`

  return {
    system: CONTEXT_GROUNDED_SYSTEM_PROMPT,
    user,
  }
}

export interface BuildRagPromptOptions {
  maxContextTokens?: number
  /** When true and no blocks: use "contextual search unavailable". When false: use "retrieved blocks did not contain relevant information". */
  retrievalFailed?: boolean
  /** When present: passed to buildPrompt for follow-up question resolution. */
  conversationContext?: ConversationContext
}

/**
 * Builds the LLM prompt using retrieved blocks.
 * Converts blocks to context string and delegates to buildPrompt.
 * Limits total context tokens. Never includes the full capsule.
 */
export function buildRagPrompt(
  blocks: RetrievedBlock[],
  userQuestion: string,
  options: BuildRagPromptOptions | number = MAX_CONTEXT_TOKENS
): { systemPrompt: string; userPrompt: string; contextBlocks: string } {
  const opts = typeof options === 'number' ? { maxContextTokens: options } : (options ?? {})
  const maxContextTokens = opts.maxContextTokens ?? MAX_CONTEXT_TOKENS

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

  const contextBlocks = parts.length > 0 ? parts.join('\n\n') : ''
  const { system, user } = buildPrompt(contextBlocks, userQuestion, {
    retrievalFailed: opts.retrievalFailed,
    conversationContext: opts.conversationContext,
  })

  return { systemPrompt: system, userPrompt: user, contextBlocks }
}
