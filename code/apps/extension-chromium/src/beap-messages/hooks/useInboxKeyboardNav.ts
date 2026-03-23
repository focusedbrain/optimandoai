/**
 * useInboxKeyboardNav
 *
 * Global keyboard shortcut handler for the BEAP™ Inbox message list.
 *
 * Shortcuts (active when `enabled` is true)
 * ──────────────────────────────────────────
 *   ↑ / ↓        Navigate to previous / next message in the inbox list
 *   Enter        Select the currently focused (keyboard-navigated) message
 *   Esc          Deselect the current message (clear selection)
 *   R            Focus the reply composer for the selected message
 *                (dispatches a custom event `beap:focus-reply`)
 *   T            Toggle AI for the selected message
 *                (dispatches a custom event `beap:toggle-ai`)
 *   Ctrl+Enter   Send the active reply draft
 *                (dispatches a custom event `beap:send-reply`)
 *
 * All shortcuts are suppressed when the user is typing in an `<input>`,
 * `<textarea>`, or `[contenteditable]` element.
 *
 * The hook attaches a `keydown` listener on `document` rather than on a
 * specific element so it works regardless of focus position within the
 * BEAP inbox panel.
 *
 * @version 1.0.0
 */

import { useEffect, useCallback, useRef } from 'react'
import type { BeapMessage } from '../beapInboxTypes'
import { useBeapInboxStore } from '../useBeapInboxStore'

// =============================================================================
// Custom events (dispatched on `document` for cross-component communication)
// =============================================================================

/** Fired when the user presses R on a selected message. */
export const BEAP_FOCUS_REPLY_EVENT = 'beap:focus-reply'

/** Fired when the user presses T on a selected message (bulk view AI toggle). */
export const BEAP_TOGGLE_AI_EVENT   = 'beap:toggle-ai'

/** Fired when the user presses Ctrl+Enter (send reply shortcut). */
export const BEAP_SEND_REPLY_EVENT  = 'beap:send-reply'

/** Payload for `beap:focus-reply` and `beap:toggle-ai`. */
export interface BeapMessageEventDetail {
  messageId: string
}

function dispatchBeapEvent(type: string, messageId: string) {
  document.dispatchEvent(
    new CustomEvent<BeapMessageEventDetail>(type, { detail: { messageId } }),
  )
}

// =============================================================================
// Public API
// =============================================================================

export interface UseInboxKeyboardNavOptions {
  /** When false, all shortcuts are suppressed. */
  enabled: boolean

  /** The ordered list of visible messages in the sidebar. */
  messages: BeapMessage[]
}

/**
 * Attach global keyboard shortcuts for inbox navigation.
 * Must be called within the component tree that renders the inbox.
 */
export function useInboxKeyboardNav({ enabled, messages }: UseInboxKeyboardNavOptions): void {
  const selectMessage     = useBeapInboxStore((s) => s.selectMessage)
  const selectedMessageId = useBeapInboxStore((s) => s.selectedMessageId)

  // Track focused index separately from selection to allow ↑/↓ without
  // immediately updating the store (only Enter commits the selection).
  const focusedIndexRef = useRef<number>(-1)

  // Sync focusedIndex when selectedMessageId changes externally (e.g. sidebar click)
  useEffect(() => {
    if (!selectedMessageId) {
      focusedIndexRef.current = -1
      return
    }
    const idx = messages.findIndex((m) => m.messageId === selectedMessageId)
    if (idx !== -1) focusedIndexRef.current = idx
  }, [selectedMessageId, messages])

  const isTyping = useCallback((): boolean => {
    const el = document.activeElement
    if (!el) return false
    const tag = el.tagName.toLowerCase()
    return (
      tag === 'input' ||
      tag === 'textarea' ||
      (el as HTMLElement).isContentEditable
    )
  }, [])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled || messages.length === 0) return

      // Ctrl+Enter — send reply (works even while typing in composer)
      if (e.ctrlKey && e.key === 'Enter') {
        if (selectedMessageId) {
          dispatchBeapEvent(BEAP_SEND_REPLY_EVENT, selectedMessageId)
        }
        return
      }

      // All remaining shortcuts are suppressed while typing
      if (isTyping()) return

      switch (e.key) {
        case 'ArrowUp': {
          e.preventDefault()
          const next = Math.max(0, focusedIndexRef.current - 1)
          focusedIndexRef.current = next
          // Select immediately on arrow navigation (matches macOS Mail UX)
          selectMessage(messages[next].messageId)
          break
        }

        case 'ArrowDown': {
          e.preventDefault()
          const next = Math.min(messages.length - 1, focusedIndexRef.current + 1)
          // If nothing is focused yet, start at the first message
          const resolved = focusedIndexRef.current === -1 ? 0 : next
          focusedIndexRef.current = resolved
          selectMessage(messages[resolved].messageId)
          break
        }

        case 'Enter': {
          e.preventDefault()
          if (focusedIndexRef.current >= 0 && focusedIndexRef.current < messages.length) {
            selectMessage(messages[focusedIndexRef.current].messageId)
          }
          break
        }

        case 'Escape': {
          e.preventDefault()
          selectMessage(null)
          focusedIndexRef.current = -1
          break
        }

        case 'r':
        case 'R': {
          // Only fire if a message is selected and the event isn't from a form element
          if (selectedMessageId) {
            e.preventDefault()
            dispatchBeapEvent(BEAP_FOCUS_REPLY_EVENT, selectedMessageId)
          }
          break
        }

        case 't':
        case 'T': {
          if (selectedMessageId) {
            e.preventDefault()
            dispatchBeapEvent(BEAP_TOGGLE_AI_EVENT, selectedMessageId)
          }
          break
        }
      }
    },
    [enabled, messages, selectedMessageId, selectMessage, isTyping],
  )

  useEffect(() => {
    if (!enabled) return
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [enabled, handleKeyDown])
}

// =============================================================================
// Helper: subscribe to beap:focus-reply in a component
// =============================================================================

/**
 * Subscribe to the `beap:focus-reply` custom event.
 * Returns the cleanup function.
 *
 * Usage:
 * ```tsx
 * useEffect(() => {
 *   return onBeapFocusReply((messageId) => {
 *     if (messageId === myMessageId) textareaRef.current?.focus()
 *   })
 * }, [])
 * ```
 */
export function onBeapFocusReply(handler: (messageId: string) => void): () => void {
  const listener = (e: Event) => {
    handler((e as CustomEvent<BeapMessageEventDetail>).detail.messageId)
  }
  document.addEventListener(BEAP_FOCUS_REPLY_EVENT, listener)
  return () => document.removeEventListener(BEAP_FOCUS_REPLY_EVENT, listener)
}

/** Subscribe to the `beap:toggle-ai` custom event. */
export function onBeapToggleAi(handler: (messageId: string) => void): () => void {
  const listener = (e: Event) => {
    handler((e as CustomEvent<BeapMessageEventDetail>).detail.messageId)
  }
  document.addEventListener(BEAP_TOGGLE_AI_EVENT, listener)
  return () => document.removeEventListener(BEAP_TOGGLE_AI_EVENT, listener)
}

/** Subscribe to the `beap:send-reply` custom event. */
export function onBeapSendReply(handler: (messageId: string) => void): () => void {
  const listener = (e: Event) => {
    handler((e as CustomEvent<BeapMessageEventDetail>).detail.messageId)
  }
  document.addEventListener(BEAP_SEND_REPLY_EVENT, listener)
  return () => document.removeEventListener(BEAP_SEND_REPLY_EVENT, listener)
}
