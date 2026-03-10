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
  /\binvoice\b/i,
  /\bbill\b/i,
  /\breceipt\b/i,
  /\bcontract\b/i,
  /\bagreement\b/i,
  /\bshow\s*me\s*(?:the\s*)?(?:last\s*)?(?:invoice|contract|document)/i,
  /\bfind\s*(?:the\s*)?(?:contract|invoice|document)/i,
  /\bopen\s*(?:the\s*)?(?:contract|invoice|document)/i,
  /\blocate\s*(?:the\s*)?(?:invoice|contract|document)/i,
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
