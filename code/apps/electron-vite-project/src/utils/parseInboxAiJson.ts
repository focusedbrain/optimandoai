/**
 * Partial and full JSON parsing for streaming Normal Inbox AI analysis.
 * Extracts fields from incomplete or complete LLM JSON output.
 */

import type { NormalInboxAiResult } from '../types/inboxAi'

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

/**
 * Attempt to parse complete JSON into NormalInboxAiResult.
 * Returns null if parsing fails or result is invalid.
 */
export function tryParseAnalysis(text: string): NormalInboxAiResult | null {
  if (!text?.trim()) return null
  let cleaned = text.trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.substring(start, end + 1)
  }
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) return null
    return {
      needsReply: !!parsed.needsReply,
      needsReplyReason: String(parsed.needsReplyReason ?? '').slice(0, 300),
      summary: String(parsed.summary ?? '').slice(0, 1000),
      urgencyScore: typeof parsed.urgencyScore === 'number'
        ? Math.max(1, Math.min(10, parsed.urgencyScore))
        : 5,
      urgencyReason: String(parsed.urgencyReason ?? '').slice(0, 300),
      actionItems: Array.isArray(parsed.actionItems)
        ? parsed.actionItems.filter((x): x is string => typeof x === 'string').slice(0, 10)
        : [],
      archiveRecommendation: parsed.archiveRecommendation === 'archive' ? 'archive' : 'keep',
      archiveReason: String(parsed.archiveReason ?? '').slice(0, 300),
      draftReply: typeof parsed.draftReply === 'string' ? parsed.draftReply.slice(0, 8000) : null,
    }
  } catch {
    return null
  }
}

export type NormalInboxAiResultKey = keyof NormalInboxAiResult

/**
 * Extract partial fields from incomplete JSON for progressive UI updates.
 * Returns merged result + keys that were successfully extracted.
 */
export function tryParsePartialAnalysis(
  text: string
): { partial: NormalInboxAiResult; receivedKeys: NormalInboxAiResultKey[] } | null {
  if (!text?.trim()) return null
  const result: Partial<NormalInboxAiResult> = {}
  const receivedKeys: NormalInboxAiResultKey[] = []

  // Try full parse first
  const full = tryParseAnalysis(text)
  if (full) return { partial: full, receivedKeys: ['needsReply', 'needsReplyReason', 'summary', 'urgencyScore', 'urgencyReason', 'actionItems', 'archiveRecommendation', 'archiveReason', 'draftReply'] }

  // Regex extraction for partial JSON (handles escaped quotes in strings)
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

  // actionItems: array is trickier — look for "actionItems": ["item1","item2"
  const actionItemsMatch = text.match(/"actionItems"\s*:\s*\[(.*?)(?:\]|$)/s)
  if (actionItemsMatch) {
    const inner = actionItemsMatch[1]
    const strRegex = new RegExp('"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"', 'g')
    const items = inner.match(strRegex)?.map((s) => s.slice(1, -1).replace(/\\"/g, '"')) ?? []
    result.actionItems = items.slice(0, 10)
    receivedKeys.push('actionItems')
  }

  // draftReply: string or null
  const draftReplyNullMatch = text.match(/"draftReply"\s*:\s*null/)
  if (draftReplyNullMatch) {
    result.draftReply = null
    receivedKeys.push('draftReply')
  } else {
    const draftReplyMatch = text.match(/"draftReply"\s*:\s*"((?:[^"\\]|\\.)*)/)
    if (draftReplyMatch) {
      result.draftReply = draftReplyMatch[1].replace(/\\"/g, '"').slice(0, 8000)
      receivedKeys.push('draftReply')
    }
  }

  return receivedKeys.length > 0 ? { partial: { ...DEFAULTS, ...result }, receivedKeys } : null
}
