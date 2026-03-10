/**
 * Block Extraction — Deterministic and semantic block generation for indexing
 *
 * Supports two context categories:
 * 1. Deterministic Vault Profiles — structured fields with predictable embeddings
 * 2. Handshake Attachments — large unstructured docs chunked for search
 *
 * All blocks are traceable to the originating capsule via source_path.
 */

import { createHash } from 'crypto'

// ── Constants ───────────────────────────────────────────────────────────────

/** Target chunk size in tokens (approx 4 chars/token). */
export const CHUNK_TARGET_TOKENS = 600
export const CHUNK_MIN_TOKENS = 400
export const CHUNK_MAX_TOKENS = 800
const CHARS_PER_TOKEN = 4

/** Structured block type prefixes (vault profiles). */
const STRUCTURED_PREFIXES = ['company', 'contact', 'opening_hours', 'services', 'departments'] as const

// ── Types ───────────────────────────────────────────────────────────────────

export interface ExtractedBlock {
  block_id: string
  /** Parent block_id for governance join (same as block_id for non-chunked). */
  parent_block_id: string
  text: string
  source_path: string
  chunk_index: number
  block_hash: string
}

// ── Structured profile extraction (deterministic) ───────────────────────────

const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const

/** Format opening_hours.schedule into deterministic readable text. */
function formatOpeningHours(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return ''
  const lines: string[] = ['Opening hours:']
  const rec = obj as Record<string, unknown>

  if (rec.schedule && typeof rec.schedule === 'object') {
    const sched = rec.schedule as Record<string, unknown>
    for (const day of DAY_ORDER) {
      const val = sched[day]
      const label = day.charAt(0).toUpperCase() + day.slice(1)
      if (val == null || val === '') {
        lines.push(`${label} closed`)
      } else if (typeof val === 'string') {
        lines.push(`${label} ${val}`)
      } else if (Array.isArray(val)) {
        lines.push(`${label} ${val.map(String).join(', ')}`)
      } else {
        lines.push(`${label} ${String(val)}`)
      }
    }
  } else {
    // Fallback: flatten object
    for (const [k, v] of Object.entries(rec)) {
      if (v != null && v !== '') lines.push(`${k}: ${String(v)}`)
    }
  }
  return lines.join('\n')
}

/** Format contact/company structured data into deterministic text. */
function formatStructuredObject(blockId: string, obj: unknown): string {
  if (!obj || typeof obj !== 'object') return ''
  const lines: string[] = []
  const rec = obj as Record<string, unknown>

  if (blockId.startsWith('opening_hours')) {
    return formatOpeningHours(obj)
  }

  if (blockId.startsWith('contact.')) {
    const parts: string[] = []
    if (rec.general && typeof rec.general === 'object') {
      const g = rec.general as Record<string, unknown>
      if (g.phone) parts.push(`Phone: ${g.phone}`)
      if (g.email) parts.push(`Email: ${g.email}`)
    }
    if (rec.support && typeof rec.support === 'object') {
      const s = rec.support as Record<string, unknown>
      if (s.phone) parts.push(`Support phone: ${s.phone}`)
      if (s.email) parts.push(`Support email: ${s.email}`)
    }
    if (parts.length) return parts.join('\n')
  }

  if (blockId.startsWith('company.')) {
    const parts: string[] = []
    if (rec.name) parts.push(`Company: ${rec.name}`)
    if (rec.address) parts.push(`Address: ${rec.address}`)
    if (rec.headquarters) parts.push(`Headquarters: ${rec.headquarters}`)
    if (parts.length) return parts.join('\n')
  }

  // Generic: key-value pairs, sorted for determinism
  for (const k of Object.keys(rec).sort()) {
    const v = rec[k]
    if (v == null) continue
    if (typeof v === 'string') lines.push(`${k}: ${v}`)
    else if (typeof v === 'object') lines.push(`${k}:\n${formatStructuredObject(blockId + '.' + k, v)}`)
    else lines.push(`${k}: ${String(v)}`)
  }
  return lines.join('\n')
}

/** Check if block_id is a structured vault profile. */
function isStructuredBlock(blockId: string): boolean {
  const top = blockId.split('.')[0]?.toLowerCase() ?? ''
  return STRUCTURED_PREFIXES.includes(top as (typeof STRUCTURED_PREFIXES)[number])
}

// ── Document chunking ────────────────────────────────────────────────────────

/** Split text into semantic chunks (target 500–800 tokens). Preserves section boundaries. */
export function chunkDocument(
  text: string,
  sourcePath: string,
  blockIdPrefix: string,
  targetTokens: number = CHUNK_TARGET_TOKENS,
): Array<{ text: string; chunkIndex: number }> {
  if (!text || !text.trim()) return []
  const trimmed = text.trim()
  const maxChars = CHUNK_MAX_TOKENS * CHARS_PER_TOKEN
  const minChars = CHUNK_MIN_TOKENS * CHARS_PER_TOKEN
  const targetChars = targetTokens * CHARS_PER_TOKEN

  // Split by double newlines first (paragraph boundaries)
  const paragraphs = trimmed.split(/\n\s*\n/)
  const chunks: Array<{ text: string; chunkIndex: number }> = []
  let current = ''
  let chunkIndex = 0

  for (const para of paragraphs) {
    const paraTrimmed = para.trim()
    if (!paraTrimmed) continue

    const wouldExceed = current.length + paraTrimmed.length + 2 > maxChars
    if (wouldExceed && current.length >= minChars) {
      chunks.push({ text: current.trim(), chunkIndex })
      chunkIndex++
      current = ''
    }

    // If single paragraph exceeds max, split by sentences
    if (paraTrimmed.length > maxChars) {
      if (current.length > 0) {
        chunks.push({ text: current.trim(), chunkIndex })
        chunkIndex++
        current = ''
      }
      const sentences = paraTrimmed.split(/(?<=[.!?])\s+/)
      let sentenceBuf = ''
      for (const sent of sentences) {
        if (sentenceBuf.length + sent.length > maxChars && sentenceBuf.length >= minChars) {
          chunks.push({ text: sentenceBuf.trim(), chunkIndex })
          chunkIndex++
          sentenceBuf = ''
        }
        sentenceBuf += (sentenceBuf ? ' ' : '') + sent
      }
      if (sentenceBuf) current = sentenceBuf
    } else {
      current += (current ? '\n\n' : '') + paraTrimmed
    }
  }

  if (current.trim()) {
    chunks.push({ text: current.trim(), chunkIndex })
  }

  return chunks
}

// ── Main extraction ──────────────────────────────────────────────────────────

/** Compute deterministic block hash for chunk (traceability). */
function computeChunkHash(parentBlockHash: string, chunkIndex: number, chunkText: string): string {
  return createHash('sha256')
    .update(parentBlockHash + '\0' + chunkIndex + '\0' + chunkText)
    .digest('hex')
}

/**
 * Extract indexable blocks from a context block payload.
 * Returns one block for structured profiles; multiple for large unstructured docs.
 */
export function extractBlocks(
  blockId: string,
  payload: string,
  blockHash: string,
  sourcePath: string,
): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = []

  if (!payload || typeof payload !== 'string') return blocks

  const trimmed = payload.trim()
  if (!trimmed) return blocks

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    /* plain text */
    parsed = trimmed
  }

  const text = typeof parsed === 'string'
    ? parsed
    : (parsed && typeof parsed === 'object')
      ? extractTextFromPayload(trimmed)
      : String(parsed)

  if (!text.trim()) return blocks

  const charCount = text.length
  const tokenEstimate = Math.ceil(charCount / CHARS_PER_TOKEN)

  if (isStructuredBlock(blockId)) {
    const formatted = formatStructuredObject(blockId, parsed) || (typeof text === 'string' ? text.trim() : '')
    if (formatted) {
      blocks.push({
        block_id: blockId,
        parent_block_id: blockId,
        text: formatted,
        source_path: sourcePath,
        chunk_index: 0,
        block_hash: blockHash,
      })
    }
    return blocks
  }

  // Unstructured: chunk if large
  if (tokenEstimate > CHUNK_MAX_TOKENS) {
    const chunks = chunkDocument(text, sourcePath, blockId)
    for (const { text: chunkText, chunkIndex } of chunks) {
      blocks.push({
        block_id: `${blockId}.chunk_${chunkIndex}`,
        parent_block_id: blockId,
        text: chunkText,
        source_path: sourcePath,
        chunk_index: chunkIndex,
        block_hash: computeChunkHash(blockHash, chunkIndex, chunkText),
      })
    }
  } else {
    blocks.push({
      block_id: blockId,
      parent_block_id: blockId,
      text: text.trim(),
      source_path: sourcePath,
      chunk_index: 0,
      block_hash: blockHash,
    })
  }

  return blocks
}

/** Fallback for non-JSON: flatten object to readable text. */
function extractTextFromPayload(payload: string): string {
  if (!payload || typeof payload !== 'string') return ''
  const trimmed = payload.trim()
  if (!trimmed) return ''

  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed === 'string') return parsed
    if (typeof parsed === 'number' || typeof parsed === 'boolean') return String(parsed)
    if (Array.isArray(parsed)) {
      return parsed.map((v: unknown) => extractTextFromPayload(typeof v === 'string' ? v : JSON.stringify(v))).filter(Boolean).join('\n')
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
    /* not JSON */
  }
  return trimmed
}
