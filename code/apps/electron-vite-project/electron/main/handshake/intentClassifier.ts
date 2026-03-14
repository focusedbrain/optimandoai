/**
 * Intent Detection Layer — Rule-based classifier for chat routing
 *
 * Determines the type of user request before retrieval.
 * MVP: deterministic rules; no LLM required.
 */

export type ChatIntent =
  | 'knowledge_query'
  | 'document_lookup'
  | 'handshake_context_query'
  | 'inbox_lookup'
  | 'general_search'

export interface IntentResult {
  intent: ChatIntent
  confidence: number
}

const DOCUMENT_LOOKUP_PATTERNS = [
  // Invoice, contract, bill, receipt (existing)
  /\binvoice\b/i,
  /\bbill\b/i,
  /\breceipt\b/i,
  /\bcontract\b/i,
  /\bagreement\b/i,
  /\bshow\s*me\s*(?:the\s*)?(?:last\s*)?(?:invoice|contract|document)/i,
  /\bfind\s*(?:the\s*)?(?:contract|invoice|document)/i,
  /\bopen\s*(?:the\s*)?(?:contract|invoice|document)/i,
  /\blocate\s*(?:the\s*)?(?:invoice|contract|document)/i,
  // Attachment and document phrasing (generic)
  /\battachment\b/i,
  /\bwhat\s+is\s+(?:this\s+)?(?:attachment|document)\s+about/i,
  /\bsummarize\s+(?:(?:the|this)\s+)?(?:attachment|document)\b/i,
  /\bsummarise\s+(?:(?:the|this)\s+)?(?:attachment|document)\b/i,
  /\bbriefly\s+summar(?:ise|ize)\s+(?:(?:the|this)\s+)?(?:attachment|document)\b/i,
  /\b(?:short\s+)?summary\s+(?:of\s+(?:the\s+)?)?(?:the\s+)?(?:attachment|document)\b/i,
  /\bwhat\s+does\s+(?:this\s+)?(?:attachment|document)\s+say/i,
  /\bshow\s*me\s*(?:the\s+)?(?:attachment|document)\b/i,
  /\b(?:this\s+)?(?:attachment|document)\s+about/i,
  /\b(?:the\s+)?(?:attachment|document)\s+briefly/i,
]

const HANDSHAKE_CONTEXT_PATTERNS = [
  /\bwhat\s+did\s+we\s+agree\b/i,
  /\bagreement\s+with\b/i,
  /\bwhat\s+we\s+agreed\b/i,
  /\bcontext\s+(?:from|of)\s+(?:handshake|relationship)/i,
  /\bhandshake\s+(?:context|agreement)/i,
]

const INBOX_LOOKUP_PATTERNS = [
  /\b(?:search|find|look)\s*(?:in\s*)?(?:the\s*)?(?:beap\s*)?inbox\b/i,
  /\binbox\s+(?:search|lookup|find)/i,
  /\bbeap\s+inbox\b/i,
]

const GENERAL_SEARCH_PATTERNS = [
  /\bsearch\s+for\b/i,
  /\bfind\s+(?:all\s+)?(?:monitoring|documentation|manual)/i,
  /\b(?:monitoring|documentation)\s+(?:search|find)/i,
]

/**
 * Classifies a user query into intent types.
 * Order matters: more specific patterns first.
 */
export function classifyIntent(query: string): IntentResult {
  const trimmed = query.trim()
  if (!trimmed) return { intent: 'knowledge_query', confidence: 0 }

  const normalized = trimmed.replace(/\s+/g, ' ')

  // handshake_context_query: "what did we agree" etc. — check before document_lookup
  for (const re of HANDSHAKE_CONTEXT_PATTERNS) {
    if (re.test(normalized)) {
      return { intent: 'handshake_context_query', confidence: 0.9 }
    }
  }

  // document_lookup: invoice, contract, show me, find contract
  for (const re of DOCUMENT_LOOKUP_PATTERNS) {
    if (re.test(normalized)) {
      return { intent: 'document_lookup', confidence: 0.85 }
    }
  }

  // inbox_lookup: explicit BEAP inbox search
  for (const re of INBOX_LOOKUP_PATTERNS) {
    if (re.test(normalized)) {
      return { intent: 'inbox_lookup', confidence: 0.9 }
    }
  }

  // general_search: search for monitoring, documentation
  for (const re of GENERAL_SEARCH_PATTERNS) {
    if (re.test(normalized)) {
      return { intent: 'general_search', confidence: 0.8 }
    }
  }

  // Default: knowledge query (e.g. "What are the opening hours?")
  return { intent: 'knowledge_query', confidence: 0.7 }
}

/** Patterns that imply the user is referring to a specific attachment/document (requires selection). */
const ATTACHMENT_REQUIRES_SELECTION_PATTERNS = [
  /\bthis\s+(?:attachment|document)\b/i,
  /\bwhat\s+is\s+(?:this\s+)?(?:attachment|document)\s+about/i,
  /\bwhat\s+does\s+this\s+(?:attachment|document)\s+say\b/i,
  /\b(?:the\s+)?(?:attachment|document)\s+(?:about|briefly)\b/i,
  /\bsummarize\s+(?:(?:the|this)\s+)?(?:attachment|document)\b/i,
  /\bsummarise\s+(?:(?:the|this)\s+)?(?:attachment|document)\b/i,
  /\bbriefly\s+summar(?:ise|ize)\s+(?:(?:the|this)\s+)?(?:attachment|document)\b/i,
  /\b(?:short\s+)?summary\s+(?:of\s+(?:the\s+)?)?(?:the\s+)?(?:attachment|document)\b/i,
  /\bshow\s*me\s*(?:the\s+)?(?:attachment|document)\b/i,
]

/**
 * Returns true when the query implies "this attachment" or "the attachment" (specific document).
 * Used to fail gracefully when no document is selected.
 */
export function queryRequiresAttachmentSelection(query: string): boolean {
  const trimmed = query.trim()
  if (!trimmed) return false
  return ATTACHMENT_REQUIRES_SELECTION_PATTERNS.some((re) => re.test(trimmed))
}
