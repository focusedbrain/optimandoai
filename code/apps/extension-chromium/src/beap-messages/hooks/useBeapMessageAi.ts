/**
 * useBeapMessageAi
 *
 * Local state hook that manages the AI output panel for a selected BEAP message.
 * Provides:
 *  - An ordered list of AI output entries (text, markdown, chart)
 *  - A method to append a new AI output (called when the search bar submits a
 *    query in message context mode)
 *  - Clear / reset
 *  - The "search context label" that should be injected into the top search bar
 *    when a message is selected
 *
 * This is intentionally self-contained: it holds no server state and requires
 * no global store. The parent component owns the hook instance so AI outputs
 * are naturally scoped to the currently-open message panel.
 *
 * Integration contract with the top search bar
 * ─────────────────────────────────────────────
 * The parent component should:
 *   1. Call `getSearchContextLabel()` and pass it as a placeholder / prefix to
 *      the search bar input when a message is selected.
 *   2. When the user submits a query, call `appendEntry({ type:'text', content,
 *      query })` after the AI responds to surface the result in this panel.
 *
 * @version 1.0.0
 */

import { useState, useCallback } from 'react'
import type { BeapMessage } from '../beapInboxTypes'

// =============================================================================
// Types
// =============================================================================

export type AiOutputType = 'text' | 'markdown' | 'chart'

export interface AiOutputEntry {
  /** Unique stable key for React reconciliation. */
  id: string
  /** The type determines how the content is rendered. */
  type: AiOutputType
  /** The AI-generated content. For 'chart', this is a JSON-serialised spec. */
  content: string
  /** The user query that triggered this output (displayed as a label). */
  query: string
  /** Unix timestamp (ms) of generation. */
  generatedAt: number
  /** Optional source tag (model name, tool name, etc.). */
  source?: string
}

interface UseBeapMessageAiReturn {
  /** All AI output entries for the current message, oldest first. */
  entries: AiOutputEntry[]
  /** True when an AI request is in flight. */
  isGenerating: boolean
  /** Append a completed AI output entry. */
  appendEntry: (entry: Omit<AiOutputEntry, 'id' | 'generatedAt'>) => void
  /** Signal that generation has started (shows spinner). */
  startGenerating: () => void
  /** Signal that generation ended (clears spinner). */
  stopGenerating: () => void
  /** Clear all entries (reset the panel). */
  clear: () => void
  /**
   * Returns the context label to inject into the search bar placeholder.
   * e.g. "Ask about: alice@example.com — Q4 invoice…"
   */
  getSearchContextLabel: (message: BeapMessage | null) => string
}

// =============================================================================
// Hook
// =============================================================================

let _idCounter = 0
function nextId(): string {
  return `ai-${Date.now()}-${++_idCounter}`
}

export function useBeapMessageAi(): UseBeapMessageAiReturn {
  const [entries, setEntries] = useState<AiOutputEntry[]>([])
  const [isGenerating, setIsGenerating] = useState(false)

  const appendEntry = useCallback(
    (entry: Omit<AiOutputEntry, 'id' | 'generatedAt'>) => {
      setEntries((prev) => [
        ...prev,
        { ...entry, id: nextId(), generatedAt: Date.now() },
      ])
    },
    [],
  )

  const startGenerating = useCallback(() => setIsGenerating(true), [])
  const stopGenerating = useCallback(() => setIsGenerating(false), [])

  const clear = useCallback(() => {
    setEntries([])
    setIsGenerating(false)
  }, [])

  const getSearchContextLabel = useCallback(
    (message: BeapMessage | null): string => {
      if (!message) return ''
      const sender = message.senderDisplayName || message.senderEmail
      const preview =
        (message.canonicalContent || message.messageBody || '').slice(0, 50).trim()
      const suffix = preview.length >= 50 ? '…' : ''
      return `Ask about: ${sender} — ${preview}${suffix}`
    },
    [],
  )

  return {
    entries,
    isGenerating,
    appendEntry,
    startGenerating,
    stopGenerating,
    clear,
    getSearchContextLabel,
  }
}
