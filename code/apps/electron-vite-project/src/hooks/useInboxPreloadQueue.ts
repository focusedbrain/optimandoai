/**
 * useInboxPreloadQueue — Background preload of AI analysis for Normal Inbox.
 * Processes unanalyzed messages 2 at a time so results are ready when user selects.
 */

import { useRef, useCallback, useEffect } from 'react'
import type { InboxMessage } from '../stores/useEmailInboxStore'
import type { NormalInboxAiResult } from '../types/inboxAi'
import { useEmailInboxStore } from '../stores/useEmailInboxStore'
import { tryParseAnalysis } from '../utils/parseInboxAiJson'

const CONCURRENCY = 2

function scheduleIdle(cb: () => void): void {
  if ('requestIdleCallback' in window) {
    ;(window as Window & { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback(
      cb,
      { timeout: 2000 }
    )
  } else {
    setTimeout(cb, 500)
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
  const lastAnalysisTimestamp = useRef(Date.now())
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const analysisRestartCounter = useEmailInboxStore((s) => s.analysisRestartCounter)

  const processQueue = useCallback(() => {
    const setAnalysisCache = useEmailInboxStore.getState().setAnalysisCache
    const cache = useEmailInboxStore.getState().analysisCache

    const available = CONCURRENCY - inFlightRef.current.size
    if (available <= 0 || queueRef.current.length === 0) return

    const batch = queueRef.current.splice(0, available)
    batch.forEach(async (messageId) => {
      if (cache[messageId]) return
      inFlightRef.current.add(messageId)
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
          lastAnalysisTimestamp.current = Date.now()
        }
        cleanupFns.forEach((fn) => fn())
        inFlightRef.current.delete(messageId)
        if (queueRef.current.length > 0) {
          scheduleIdle(processQueue)
        }
      })
      if (unsubDone) cleanupFns.push(unsubDone)

      const unsubError = window.emailInbox?.onAiAnalyzeError?.(({ messageId: mid }) => {
        if (mid !== messageId) return
        cleanupFns.forEach((fn) => fn())
        inFlightRef.current.delete(messageId)
        if (queueRef.current.length > 0) {
          scheduleIdle(processQueue)
        }
      })
      if (unsubError) cleanupFns.push(unsubError)

      try {
        await window.emailInbox?.aiAnalyzeMessageStream?.(messageId)
      } catch {
        cleanupFns.forEach((fn) => fn())
        inFlightRef.current.delete(messageId)
        if (queueRef.current.length > 0) {
          scheduleIdle(processQueue)
        }
      }
    })
  }, [])

  const scheduleNext = useCallback(() => {
    if (queueRef.current.length === 0) return
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
    console.log('[ANALYSIS] Preload queue effect fired. Messages:', messages.length, 'Cached:', Object.keys(analysisCache).length)
    const newIds = messages
      .map((m) => m.id)
      .filter((id) => !analysisCache[id] && !inFlightRef.current.has(id))
    console.log('[ANALYSIS] Unanalyzed messages:', newIds.length)

    queueRef.current = [
      ...newIds.filter((id) => !queueRef.current.includes(id)),
      ...queueRef.current.filter((id) => analysisCache[id] === undefined),
    ]

    if (queueRef.current.length > 0) {
      scheduleNext()
    } else {
      console.log('[ANALYSIS] Queue skipped — reason: queue empty')
    }
  }, [messages, analysisCache, scheduleNext, analysisRestartCounter])

  useEffect(() => {
    const interval = setInterval(() => {
      const cache = useEmailInboxStore.getState().analysisCache
      const unanalyzed = messagesRef.current.filter((m) => !cache[m.id] && !inFlightRef.current.has(m.id))
      if (unanalyzed.length > 0 && Date.now() - lastAnalysisTimestamp.current > 15000) {
        console.warn('[ANALYSIS] Heartbeat: stalled. Restarting queue.')
        useEmailInboxStore.getState().triggerAnalysisRestart()
      }
    }, 10000)
    return () => clearInterval(interval)
  }, [])

  return {
    prioritize,
    queueLength: queueRef.current.length,
  }
}
