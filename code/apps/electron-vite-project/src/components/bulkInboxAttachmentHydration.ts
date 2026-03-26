/**
 * Pure helpers for bulk inbox attachment hydration (testable without React/DOM).
 */

import type { InboxAttachment } from '../stores/useEmailInboxStore'

export type HydrationTerminal =
  | { phase: 'empty' }
  | { phase: 'loaded'; attachments: InboxAttachment[] }
  | { phase: 'error'; message: string }

export function hydrationAfterGetMessageSuccess(
  rowAttachments: InboxAttachment[] | null | undefined,
): HydrationTerminal {
  const next = rowAttachments ?? []
  if (next.length === 0) return { phase: 'empty' }
  return { phase: 'loaded', attachments: next }
}

export function hydrationAfterGetMessageIpcError(res: { error?: string } | null | undefined): HydrationTerminal {
  const errText =
    typeof res?.error === 'string' && res.error.trim().length > 0 ? res.error.trim() : 'Could not load message.'
  return { phase: 'error', message: errText }
}

export function hydrationAfterGetMessageReject(err: unknown): HydrationTerminal {
  const message = err instanceof Error ? err.message : String(err ?? 'Unknown error')
  return { phase: 'error', message }
}
