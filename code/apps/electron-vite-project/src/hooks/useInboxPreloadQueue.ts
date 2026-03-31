/**
 * useInboxPreloadQueue — Background preload of AI analysis for Normal Inbox.
 * Processes unanalyzed messages one at a time so results are ready when user selects.
 * Preload cadence adapts to measured inference time (cooldown) with caps and failure backoff.
 */

import { useRef, useCallback, useEffect } from 'react'
import type { InboxMessage } from '../stores/useEmailInboxStore'
import type { NormalInboxAiResult } from '../types/inboxAi'
import { useEmailInboxStore } from '../stores/useEmailInboxStore'
import { tryParseAnalysis } from '../utils/parseInboxAiJson'

const CONCURRENCY = 1

// ─── Adaptive preload timing ───
const MIN_INTERVAL_MS = 1_000
const MAX_INTERVAL_MS = 60_000
const DEFAULT_INTERVAL_MS = 5_000
const COOLDOWN_MULTIPLIER = 1.5
const BACKOFF_MULTIPLIER = 2
const MAX_CONSECUTIVE_FAILURES = 5

/** Stall: pending work, nothing in flight, no completion for this long → watchdog restart. */
const WATCHDOG_STALL_MS = 180_000
/** Watchdog tick — must be coarse vs adaptive polls so we rarely false-positive. */
const WATCHDOG_TICK_MS = 30_000

const IDLE_TIMEOUT_MS = 1500

function scheduleIdle(cb: () => void): void {
  if ('requestIdleCallback' in window) {
    ;(window as Window & { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback(
      cb,
      { timeout: IDLE_TIMEOUT_MS },
    )
  } else {
    setTimeout(cb, IDLE_TIMEOUT_MS)
  }
}

type AdaptiveState = {
  lastInferenceMs: number
  currentIntervalMs: number
  consecutiveFailures: number
  timerId: ReturnType<typeof setTimeout> | null
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

  const adaptiveRef = useRef<AdaptiveState>({
    lastInferenceMs: 0,
    currentIntervalMs: DEFAULT_INTERVAL_MS,
    consecutiveFailures: 0,
    timerId: null,
  })
  const adaptiveUnmountedRef = useRef(false)
  const inferenceStartMsRef = useRef<number | null>(null)
  const inferenceStreamErroredRef = useRef(false)

  /** Compute pending visible message ids: visible, excluding fully analyzed, excluding in-flight */
  const computePendingVisible = useCallback(() => {
    const cache = useEmailInboxStore.getState().analysisCache
    const visibleIds = messagesRef.current.map((m) => m.id)
    return visibleIds.filter((id) => !cache[id] && !inFlightRef.current.has(id))
  }, [])

  const clearAdaptiveTimer = useCallback(() => {
    const st = adaptiveRef.current
    if (st.timerId !== null) {
      clearTimeout(st.timerId)
      st.timerId = null
    }
  }, [])

  const scheduleAdaptivePreload = useCallback(() => {
    const st = adaptiveRef.current
    if (adaptiveUnmountedRef.current) return
    if (st.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return

    clearAdaptiveTimer()

    st.timerId = setTimeout(() => {
      st.timerId = null
      if (adaptiveUnmountedRef.current) return

      if (document.visibilityState !== 'visible') {
        scheduleAdaptivePreload()
        return
      }

      if (queueRef.current.length > 0 || inFlightRef.current.size > 0) {
        scheduleAdaptivePreload()
        return
      }

      const cache = useEmailInboxStore.getState().analysisCache
      const visible = messagesRef.current.map((m) => m.id)
      const unanalyzed = visible.filter(
        (id) => !cache[id] && !inFlightRef.current.has(id) && !queueRef.current.includes(id),
      )

      if (unanalyzed.length === 0) {
        scheduleAdaptivePreload()
        return
      }

      queueRef.current.push(unanalyzed[0])
      console.log('[ANALYSIS] queue start (adaptive preload)')
      if (queueRef.current.length > 0) {
        scheduleIdle(() => processQueueRef.current())
      }
    }, st.currentIntervalMs)
  }, [clearAdaptiveTimer])

  const scheduleAdaptivePreloadRef = useRef(scheduleAdaptivePreload)
  scheduleAdaptivePreloadRef.current = scheduleAdaptivePreload

  const processQueueRef = useRef<() => void>(() => {})

  const processQueue = useCallback(() => {
    const setAnalysisCache = useEmailInboxStore.getState().setAnalysisCache
    const cache = useEmailInboxStore.getState().analysisCache

    const available = CONCURRENCY - inFlightRef.current.size
    if (available <= 0 || queueRef.current.length === 0) return

    const messageId = queueRef.current.shift()
    if (!messageId || cache[messageId]) {
      if (queueRef.current.length > 0) {
        console.log('[ANALYSIS] queue pending', queueRef.current.length)
        scheduleIdle(processQueueRef.current)
      } else {
        scheduleAdaptivePreloadRef.current()
      }
      return
    }

    inFlightRef.current.add(messageId)
    console.log('[ANALYSIS] item start', messageId)

    inferenceStreamErroredRef.current = false
    inferenceStartMsRef.current = performance.now()

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
      inferenceStreamErroredRef.current = true
      console.log('[ANALYSIS] item done (error)', messageId)
    })
    if (unsubError) cleanupFns.push(unsubError)

    const updateAdaptiveAfterInference = (ok: boolean) => {
      const start = inferenceStartMsRef.current
      inferenceStartMsRef.current = null
      const st = adaptiveRef.current
      if (start == null) return

      const elapsed = Math.max(1, performance.now() - start)

      if (ok) {
        st.consecutiveFailures = 0
        st.lastInferenceMs = elapsed
        st.currentIntervalMs = Math.max(
          MIN_INTERVAL_MS,
          Math.min(MAX_INTERVAL_MS, elapsed * COOLDOWN_MULTIPLIER),
        )
      } else {
        st.consecutiveFailures += 1
        st.currentIntervalMs = Math.min(MAX_INTERVAL_MS, st.currentIntervalMs * BACKOFF_MULTIPLIER)
        if (st.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          console.warn(
            '[ANALYSIS] Preload queue stopped after',
            MAX_CONSECUTIVE_FAILURES,
            'consecutive failures. Resumes when the window is focused again (visibility).',
          )
        }
      }
    }

    const streamPromise = window.emailInbox?.aiAnalyzeMessageStream?.(messageId)
    const hadStream = !!streamPromise

    const finish = () => {
      cleanupFns.forEach((fn) => fn())
      inFlightRef.current.delete(messageId)
      lastCompletionTimestamp.current = Date.now()
      watchdogRestartedRef.current = false

      const st = adaptiveRef.current
      const ok = hadStream && !inferenceStreamErroredRef.current
      updateAdaptiveAfterInference(ok)

      if (queueRef.current.length > 0) {
        console.log('[ANALYSIS] queue pending', queueRef.current.length)
        scheduleIdle(processQueueRef.current)
      } else if (st.consecutiveFailures < MAX_CONSECUTIVE_FAILURES) {
        scheduleAdaptivePreloadRef.current()
      }
    }

    if (streamPromise) {
      streamPromise
        .catch(() => {
          inferenceStreamErroredRef.current = true
        })
        .finally(finish)
    } else {
      finish()
    }
  }, [])

  processQueueRef.current = processQueue

  const scheduleNext = useCallback(() => {
    if (queueRef.current.length === 0) return
    console.log('[ANALYSIS] queue start')
    clearAdaptiveTimer()
    scheduleIdle(processQueue)
  }, [clearAdaptiveTimer, processQueue])

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
    [scheduleNext],
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
      scheduleAdaptivePreload()
    }
  }, [messages, analysisCache, scheduleNext, scheduleAdaptivePreload, analysisRestartCounter, computePendingVisible])

  useEffect(() => {
    adaptiveUnmountedRef.current = false
    scheduleAdaptivePreload()

    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      const pending = computePendingVisible()
      const inFlight = inFlightRef.current.size
      const stalled =
        pending.length > 0 &&
        inFlight === 0 &&
        Date.now() - lastCompletionTimestamp.current > WATCHDOG_STALL_MS
      if (stalled && !watchdogRestartedRef.current) {
        watchdogRestartedRef.current = true
        console.log('[ANALYSIS] Watchdog restart')
        useEmailInboxStore.getState().triggerAnalysisRestart()
      }
    }, WATCHDOG_TICK_MS)

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        adaptiveRef.current.consecutiveFailures = 0
        adaptiveRef.current.currentIntervalMs = DEFAULT_INTERVAL_MS
        if (adaptiveRef.current.timerId === null && queueRef.current.length === 0 && inFlightRef.current.size === 0) {
          scheduleAdaptivePreload()
        }
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      adaptiveUnmountedRef.current = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
      clearAdaptiveTimer()
    }
  }, [computePendingVisible, clearAdaptiveTimer, scheduleAdaptivePreload])

  return {
    prioritize,
    queueLength: queueRef.current.length,
  }
}
