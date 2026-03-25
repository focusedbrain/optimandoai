/**
 * App-root subscription for main-process `inbox:newMessages`.
 * Keeps Zustand inbox snapshot fresh when the user is not on the Inbox/Bulk route (those views are unmounted).
 */

export const INBOX_NEW_MESSAGES_BACKGROUND_DEBOUNCE_MS = 400

export function subscribeInboxNewMessagesBackgroundRefresh(options: {
  onNewMessages?: (handler: (data: unknown) => void) => (() => void) | undefined
  refreshMessages: () => void | Promise<void>
  debounceMs?: number
}): () => void {
  const { onNewMessages, refreshMessages, debounceMs = INBOX_NEW_MESSAGES_BACKGROUND_DEBOUNCE_MS } = options
  if (!onNewMessages) return () => {}

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleRefresh = () => {
    if (debounceTimer != null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void refreshMessages()
    }, debounceMs)
  }

  const unsub = onNewMessages(() => {
    scheduleRefresh()
  })

  return () => {
    if (debounceTimer != null) clearTimeout(debounceTimer)
    unsub?.()
  }
}
