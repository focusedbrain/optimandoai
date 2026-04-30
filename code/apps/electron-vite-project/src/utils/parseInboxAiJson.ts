/**
 * Partial and full JSON parsing for streaming Normal Inbox AI analysis.
 * Extracts fields from incomplete or complete LLM JSON output.
 */

import type { NormalInboxAiResult } from '../types/inboxAi'

/** Normalize LLM `draftReply` (string, JSON string, or capsule object). */
export function normalizeDraftReplyField(
  dr: unknown,
): string | { publicMessage: string; encryptedMessage: string } | null {
  if (dr === null || dr === undefined) return null
  if (typeof dr === 'string') {
    const t = dr.trim()
    if (t.startsWith('{')) {
      try {
        const inner = JSON.parse(t) as Record<string, unknown>
        if (inner && typeof inner === 'object' && ('publicMessage' in inner || 'encryptedMessage' in inner)) {
          return {
            publicMessage: String(inner.publicMessage ?? ''),
            encryptedMessage: String(inner.encryptedMessage ?? ''),
          }
        }
      } catch {
        /* plain string */
      }
    }
    return dr.slice(0, 8000)
  }
  if (typeof dr === 'object' && dr !== null && !Array.isArray(dr)) {
    const o = dr as Record<string, unknown>
    if ('publicMessage' in o || 'encryptedMessage' in o) {
      return {
        publicMessage: String(o.publicMessage ?? ''),
        encryptedMessage: String(o.encryptedMessage ?? ''),
      }
    }
  }
  return null
}

/** Default values for missing fields. */
const DEFAULTS: NormalInboxAiResult = {
  needsReply: false,
  needsReplyReason: '',
  summary: '',
  urgencyScore: 5,
  urgencyReason: '',
  actionItems: [],
  archiveRecommendation: 'keep',
  archiveReason: '',
}

function stripBom(text: string): string {
  if (text.length > 0 && text.charCodeAt(0) === 0xfeff) return text.slice(1)
  return text
}

/** Strip a single markdown ```json ... ``` wrapper when it wraps the whole payload. */
function stripOuterMarkdownFence(text: string): { inner: string; strippedFence: boolean } {
  const t = text.trim()
  if (!t.startsWith('```')) return { inner: t, strippedFence: false }
  const closed = /^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```\s*$/im.exec(t)
  if (closed) return { inner: closed[1].trim(), strippedFence: true }
  const openOnly = /^```(?:json)?\s*\r?\n?([\s\S]*)$/im.exec(t)
  if (openOnly) return { inner: openOnly[1].trim(), strippedFence: true }
  return { inner: t, strippedFence: false }
}

/**
 * Extract first top-level JSON object using brace depth (respects strings).
 * Ignores harmless prose after the closing `}`.
 */
export function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** Safe repair: removes trailing commas before `}` or `]`. */
export function repairTrailingCommasInJson(json: string): string {
  return json.replace(/,(\s*[}\]])/g, '$1')
}

export type TryParseAnalysisMeta = {
  rawLen: number
  strippedFence: boolean
  trimmedPreambleChars: number
  usedBalancedExtract: boolean
  usedTrailingCommaRepair: boolean
}

function parseRecordFromLenientJson(text: string): {
  parsed: Record<string, unknown> | null
  meta: TryParseAnalysisMeta
} {
  const rawLen = text.length
  const meta: TryParseAnalysisMeta = {
    rawLen,
    strippedFence: false,
    trimmedPreambleChars: 0,
    usedBalancedExtract: false,
    usedTrailingCommaRepair: false,
  }
  let t = stripBom(text.trim())
  const fenced = stripOuterMarkdownFence(t)
  if (fenced.strippedFence) meta.strippedFence = true
  t = fenced.inner

  const preambleCut = t.search(/\{/)
  if (preambleCut > 0) {
    meta.trimmedPreambleChars = preambleCut
    t = t.slice(preambleCut)
  } else if (preambleCut < 0) {
    return { parsed: null, meta }
  }

  let balanced = extractBalancedJsonObject(t)
  let candidate = balanced
  meta.usedBalancedExtract = balanced != null
  if (!candidate) {
    const start = t.indexOf('{')
    const end = t.lastIndexOf('}')
    if (start !== -1 && end > start) candidate = t.slice(start, end + 1)
  }
  if (!candidate) return { parsed: null, meta }

  const repaired = repairTrailingCommasInJson(candidate)
  if (repaired !== candidate) meta.usedTrailingCommaRepair = true

  try {
    const parsed = JSON.parse(repaired) as Record<string, unknown>
    return { parsed, meta }
  } catch {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>
      return { parsed, meta }
    } catch {
      return { parsed: null, meta }
    }
  }
}

function normalInboxAiFromParsed(parsed: Record<string, unknown>): NormalInboxAiResult | null {
  if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) return null
  const flatPub =
    typeof parsed.draftReplyPublic === 'string' ? parsed.draftReplyPublic.trim() : ''
  const flatFull =
    typeof parsed.draftReplyFull === 'string' ? parsed.draftReplyFull.trim() : ''
  const draftFromFlat =
    flatPub || flatFull
      ? ({
          publicMessage: flatPub.slice(0, 4000),
          encryptedMessage: flatFull.slice(0, 8000),
        } as const)
      : null

  return {
    needsReply: !!parsed.needsReply,
    needsReplyReason: String(parsed.needsReplyReason ?? '').slice(0, 300),
    summary: String(parsed.summary ?? '').slice(0, 1000),
    urgencyScore:
      typeof parsed.urgencyScore === 'number'
        ? Math.max(1, Math.min(10, parsed.urgencyScore))
        : 5,
    urgencyReason: String(parsed.urgencyReason ?? '').slice(0, 300),
    actionItems: Array.isArray(parsed.actionItems)
      ? parsed.actionItems.filter((x): x is string => typeof x === 'string').slice(0, 10)
      : [],
    archiveRecommendation: parsed.archiveRecommendation === 'archive' ? 'archive' : 'keep',
    archiveReason: String(parsed.archiveReason ?? '').slice(0, 300),
    draftReply: draftFromFlat ?? normalizeDraftReplyField(parsed.draftReply),
  }
}

/**
 * Attempt to parse complete JSON into NormalInboxAiResult.
 * Returns null if parsing fails or result is invalid.
 */
export function tryParseAnalysis(text: string): NormalInboxAiResult | null {
  return tryParseAnalysisWithMeta(text).result
}

export function tryParseAnalysisWithMeta(text: string): {
  result: NormalInboxAiResult | null
  meta: TryParseAnalysisMeta
} {
  if (!text?.trim()) {
    return {
      result: null,
      meta: {
        rawLen: 0,
        strippedFence: false,
        trimmedPreambleChars: 0,
        usedBalancedExtract: false,
        usedTrailingCommaRepair: false,
      },
    }
  }
  const { parsed, meta } = parseRecordFromLenientJson(text)
  if (!parsed) return { result: null, meta }
  try {
    const result = normalInboxAiFromParsed(parsed)
    return { result, meta }
  } catch {
    return { result: null, meta }
  }
}

export type NormalInboxAiResultKey = keyof NormalInboxAiResult

/**
 * Extract partial fields from incomplete JSON for progressive UI updates.
 * Returns merged result + keys that were successfully extracted.
 */
export function tryParsePartialAnalysis(
  text: string,
): { partial: NormalInboxAiResult; receivedKeys: NormalInboxAiResultKey[] } | null {
  if (!text?.trim()) return null
  const result: Partial<NormalInboxAiResult> = {}
  const receivedKeys: NormalInboxAiResultKey[] = []

  const full = tryParseAnalysis(text)
  if (full) {
    return {
      partial: full,
      receivedKeys: [
        'needsReply',
        'needsReplyReason',
        'summary',
        'urgencyScore',
        'urgencyReason',
        'actionItems',
        'archiveRecommendation',
        'archiveReason',
        'draftReply',
      ],
    }
  }

  const summaryMatch = text.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)/)
  if (summaryMatch) {
    result.summary = summaryMatch[1].replace(/\\"/g, '"').slice(0, 1000)
    receivedKeys.push('summary')
  }

  const urgencyMatch = text.match(/"urgencyScore"\s*:\s*(\d+)/)
  if (urgencyMatch) {
    const n = parseInt(urgencyMatch[1], 10)
    result.urgencyScore = Math.max(1, Math.min(10, n))
    receivedKeys.push('urgencyScore')
  }

  const needsReplyMatch = text.match(/"needsReply"\s*:\s*(true|false)/)
  if (needsReplyMatch) {
    result.needsReply = needsReplyMatch[1] === 'true'
    receivedKeys.push('needsReply')
  }

  const needsReplyReasonMatch = text.match(/"needsReplyReason"\s*:\s*"((?:[^"\\]|\\.)*)/)
  if (needsReplyReasonMatch) {
    result.needsReplyReason = needsReplyReasonMatch[1].replace(/\\"/g, '"').slice(0, 300)
    receivedKeys.push('needsReplyReason')
  }

  const urgencyReasonMatch = text.match(/"urgencyReason"\s*:\s*"((?:[^"\\]|\\.)*)/)
  if (urgencyReasonMatch) {
    result.urgencyReason = urgencyReasonMatch[1].replace(/\\"/g, '"').slice(0, 300)
    receivedKeys.push('urgencyReason')
  }

  const archiveRecMatch = text.match(/"archiveRecommendation"\s*:\s*"(archive|keep)"/)
  if (archiveRecMatch) {
    result.archiveRecommendation = archiveRecMatch[1] as 'archive' | 'keep'
    receivedKeys.push('archiveRecommendation')
  }

  const archiveReasonMatch = text.match(/"archiveReason"\s*:\s*"((?:[^"\\]|\\.)*)/)
  if (archiveReasonMatch) {
    result.archiveReason = archiveReasonMatch[1].replace(/\\"/g, '"').slice(0, 300)
    receivedKeys.push('archiveReason')
  }

  const actionItemsMatch = text.match(/"actionItems"\s*:\s*\[(.*?)(?:\]|$)/s)
  if (actionItemsMatch) {
    const inner = actionItemsMatch[1]
    const strRegex = new RegExp('"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"', 'g')
    const items = inner.match(strRegex)?.map((s) => s.slice(1, -1).replace(/\\"/g, '"')) ?? []
    result.actionItems = items.slice(0, 10)
    receivedKeys.push('actionItems')
  }

  const draftReplyNullMatch = text.match(/"draftReply"\s*:\s*null/)
  if (draftReplyNullMatch) {
    result.draftReply = null
    receivedKeys.push('draftReply')
  } else {
    const pubFlat = text.match(/"draftReplyPublic"\s*:\s*"((?:[^"\\]|\\.)*)/)
    const fullFlat = text.match(/"draftReplyFull"\s*:\s*"((?:[^"\\]|\\.)*)/)
    if (pubFlat || fullFlat) {
      result.draftReply = {
        publicMessage: pubFlat ? pubFlat[1].replace(/\\"/g, '"').slice(0, 4000) : '',
        encryptedMessage: fullFlat ? fullFlat[1].replace(/\\"/g, '"').slice(0, 8000) : '',
      }
      receivedKeys.push('draftReply')
    } else {
      const draftReplyMatch = text.match(/"draftReply"\s*:\s*"((?:[^"\\]|\\.)*)/)
      if (draftReplyMatch) {
        result.draftReply = draftReplyMatch[1].replace(/\\"/g, '"').slice(0, 8000)
        receivedKeys.push('draftReply')
      } else {
        const pubMatch = text.match(/"publicMessage"\s*:\s*"((?:[^"\\]|\\.)*)/)
        const encMatch = text.match(/"encryptedMessage"\s*:\s*"((?:[^"\\]|\\.)*)/)
        if (pubMatch || encMatch) {
          result.draftReply = {
            publicMessage: pubMatch ? pubMatch[1].replace(/\\"/g, '"').slice(0, 4000) : '',
            encryptedMessage: encMatch ? encMatch[1].replace(/\\"/g, '"').slice(0, 8000) : '',
          }
          receivedKeys.push('draftReply')
        }
      }
    }
  }

  return receivedKeys.length > 0 ? { partial: { ...DEFAULTS, ...result }, receivedKeys } : null
}
