import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { subscribeInboxNewMessagesBackgroundRefresh } from './inboxNewMessagesBackgroundRefresh'

describe('subscribeInboxNewMessagesBackgroundRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces refresh so rapid background sync events coalesce', async () => {
    let ipcHandler: ((data: unknown) => void) | undefined
    const onNewMessages = vi.fn((handler: (data: unknown) => void) => {
      ipcHandler = handler
      return vi.fn()
    })
    const refreshMessages = vi.fn().mockResolvedValue(undefined)

    const cleanup = subscribeInboxNewMessagesBackgroundRefresh({
      onNewMessages,
      refreshMessages,
      debounceMs: 400,
    })

    expect(onNewMessages).toHaveBeenCalledTimes(1)
    ipcHandler?.({})
    ipcHandler?.({})
    ipcHandler?.({})
    expect(refreshMessages).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(399)
    expect(refreshMessages).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(refreshMessages).toHaveBeenCalledTimes(1)

    cleanup()
  })

  it('refresh runs without any inbox route mounted (contract for background sync)', async () => {
    /** Simulates app shell only: no React inbox tree, only this subscription + refresh callback. */
    let ipcHandler: ((data: unknown) => void) | undefined
    const onNewMessages = vi.fn((handler: (data: unknown) => void) => {
      ipcHandler = handler
      return vi.fn()
    })
    const refreshMessages = vi.fn().mockResolvedValue(undefined)

    const cleanup = subscribeInboxNewMessagesBackgroundRefresh({
      onNewMessages,
      refreshMessages,
      debounceMs: 100,
    })

    ipcHandler?.({ ok: true, newMessages: 1 })
    await vi.advanceTimersByTimeAsync(100)
    expect(refreshMessages).toHaveBeenCalledOnce()

    cleanup()
  })

  it('clears pending debounce on cleanup', async () => {
    let ipcHandler: ((data: unknown) => void) | undefined
    const onNewMessages = vi.fn((handler: (data: unknown) => void) => {
      ipcHandler = handler
      return vi.fn()
    })
    const refreshMessages = vi.fn().mockResolvedValue(undefined)
    const cleanup = subscribeInboxNewMessagesBackgroundRefresh({
      onNewMessages,
      refreshMessages,
      debounceMs: 500,
    })
    ipcHandler?.({})
    cleanup()
    await vi.advanceTimersByTimeAsync(500)
    expect(refreshMessages).not.toHaveBeenCalled()
  })

  it('no-ops when onNewMessages is missing', () => {
    const refreshMessages = vi.fn()
    const cleanup = subscribeInboxNewMessagesBackgroundRefresh({
      onNewMessages: undefined,
      refreshMessages,
    })
    cleanup()
    expect(refreshMessages).not.toHaveBeenCalled()
  })
})
