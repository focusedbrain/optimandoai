/**
 * useInboxPreloadQueue — Background preload of AI analysis for Normal Inbox.
 * Processes unanalyzed messages one at a time so results are ready when user selects.
 */

import { useRef, useCallback, useEffect } from 'react'
import type { InboxMessage } from '../stores/useEmailInboxStore'
import type { NormalInboxAiResult } from '../types/inboxAi'
import { useEmailInboxStore } from '../stores/useEmailInboxStore'
import { tryParseAnalysis } from '../utils/parseInboxAiJson'

const CONCURRENCY = 1
const WATCHDOG_MS = 15000
const IDLE_TIMEOUT_MS = 1500

function scheduleIdle(cb: () => void): void {
  if ('requestIdleCallback' in window) {
    ;(window as Window & { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback(
      cb,
      { timeout: IDLE_TIMEOUT_MS }
    )
  } else {
    setTimeout(cb, IDLE_TIMEOUT_MS)
  }
}

export interface UseInboxPreloadQueueOptions {
  messages: InboxMessage[]
  analysisCache: Record<string, NormalInboxAiResult>
}

export function useInboxPreloadQueue({
  messages,
  analysisCache,
}: UseInboxPreloadQueueOptions): { prioritize: (messageId: string) => void; queueLength: number } {
  const queueRef = useRef<string[]>([])
  const inFlightRef = useRef<Set<string>>(new Set())
  const lastCompletionTimestamp = useRef(Date.now())
  const watchdogRestartedRef = useRef(false)
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const analysisRestartCounter = useEmailInboxStore((s) => s.analysisRestartCounter)

  /** Compute pending visible message ids: visible, excluding fully analyzed, excluding in-flight */
  const computePendingVisible = useCallback(() => {
    const cache = useEmailInboxStore.getState().analysisCache
    const visibleIds = messagesRef.current.map((m) => m.id)
    return visibleIds.filter((id) => !cache[id] && !inFlightRef.current.has(id))
  }, [])

  const processQueue = useCallback(() => {
    const setAnalysisCache = useEmailInboxStore.getState().setAnalysisCache
    const cache = useEmailInboxStore.getState().analysisCache

    const available = CONCURRENCY - inFlightRef.current.size
    if (available <= 0 || queueRef.current.length === 0) return

    const messageId = queueRef.current.shift()
    if (!messageId || cache[messageId]) {
      if (queueRef.current.length > 0) {
        console.log('[ANALYSIS] queue pending', queueRef.current.length)
        scheduleIdle(processQueue)
      }
      return
    }

    inFlightRef.current.add(messageId)
    console.log('[ANALYSIS] item start', messageId)

    let accumulatedText = ''
    const cleanupFns: Array<() => void> = []

    const unsubChunk = window.emailInbox?.onAiAnalyzeChunk?.(({ messageId: mid, chunk }) => {
      if (mid !== messageId) return
      accumulatedText += chunk
    })
    if (unsubChunk) cleanupFns.push(unsubChunk)

    const unsubDone = window.emailInbox?.onAiAnalyzeDone?.(({ messageId: mid }) => {
      if (mid !== messageId) return
      const final = tryParseAnalysis(accumulatedText)
      if (final) {
        setAnalysisCache(messageId, final)
      }
      console.log('[ANALYSIS] item done', messageId)
    })
    if (unsubDone) cleanupFns.push(unsubDone)

    const unsubError = window.emailInbox?.onAiAnalyzeError?.(({ messageId: mid }) => {
      if (mid !== messageId) return
      console.log('[ANALYSIS] item done (error)', messageId)
    })
    if (unsubError) cleanupFns.push(unsubError)

    const finish = () => {
      cleanupFns.forEach((fn) => fn())
      inFlightRef.current.delete(messageId)
      lastCompletionTimestamp.current = Date.now()
      watchdogRestartedRef.current = false
      if (queueRef.current.length > 0) {
        console.log('[ANALYSIS] queue pending', queueRef.current.length)
        scheduleIdle(processQueue)
      }
    }

    const p = window.emailInbox?.aiAnalyzeMessageStream?.(messageId)
    if (p) {
      p.finally(finish)
    } else {
      finish()
    }
  }, [])

  const scheduleNext = useCallback(() => {
    if (queueRef.current.length === 0) return
    console.log('[ANALYSIS] queue start')
    scheduleIdle(processQueue)
  }, [processQueue])

  const prioritize = useCallback(
    (messageId: string) => {
      const cache = useEmailInboxStore.getState().analysisCache
      if (cache[messageId]) return
      const idx = queueRef.current.indexOf(messageId)
      if (idx >= 0) {
        queueRef.current.splice(idx, 1)
      }
      queueRef.current.unshift(messageId)
      scheduleNext()
    },
    [scheduleNext]
  )

  useEffect(() => {
    const pending = computePendingVisible()
    const existingInQueue = new Set(queueRef.current)
    const toAdd = pending.filter((id) => !existingInQueue.has(id))
    const stillPending = queueRef.current.filter((id) => !analysisCache[id])
    queueRef.current = [...toAdd, ...stillPending]

    if (queueRef.current.length > 0) {
      console.log('[ANALYSIS] queue start')
      scheduleNext()
    } else {
      console.log('[ANALYSIS] queue skipped')
    }
  }, [messages, analysisCache, scheduleNext, analysisRestartCounter, computePendingVisible])

  useEffect(() => {
    const interval = setInterval(() => {
      const pending = computePendingVisible()
      const inFlight = inFlightRef.current.size
      const stalled = pending.length > 0 && inFlight === 0 && Date.now() - lastCompletionTimestamp.current > WATCHDOG_MS
      if (stalled && !watchdogRestartedRef.current) {
        watchdogRestartedRef.current = true
        console.log('[ANALYSIS] Watchdog restart')
        useEmailInboxStore.getState().triggerAnalysisRestart()
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [computePendingVisible])

  useEffect(() => {
    const interval = setInterval(() => {
      scheduleIdle(() => {
        const cache = useEmailInboxStore.getState().analysisCache
        const visible = messagesRef.current.map((m) => m.id)
        const unanalyzed = visible.filter((id) => !cache[id] && !inFlightRef.current.has(id) && !queueRef.current.includes(id))
        if (unanalyzed.length > 0 && inFlightRef.current.size === 0 && queueRef.current.length === 0) {
          queueRef.current.push(unanalyzed[0])
          console.log('[ANALYSIS] queue start')
          scheduleNext()
        }
      })
    }, 3000)
    return () => clearInterval(interval)
  }, [scheduleNext])

  return {
    prioritize,
    queueLength: queueRef.current.length,
  }
}
