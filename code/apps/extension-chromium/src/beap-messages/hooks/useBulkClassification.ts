/**
 * useBulkClassification
 *
 * React hook that drives the AI classification engine for the bulk inbox grid.
 *
 * Responsibilities
 * ────────────────
 * 1. Accept a batch of BeapMessages and a toggle signal.
 * 2. On toggle ON: launch classifyBatch with bounded concurrency.
 *    - Feed classifications into the Zustand store progressively
 *      (each result immediately calls batchClassify with a single-entry map).
 *    - For 'irrelevant' + high-confidence results: auto-schedule deletion via
 *      scheduleDeletion(id, irrelevanceGracePeriodMs).
 * 3. On toggle OFF: cancel pending work (via AbortSignal convention).
 * 4. Expose per-message classification state for the UI.
 * 5. Background grace-period manager: periodic interval purges expired deletions.
 *
 * Progressive update flow
 * ────────────────────────
 *   classifyBatch calls onProgress after each message.
 *   onProgress → batchClassify([ id ], map) in the store → Zustand notifies.
 *   BeapBulkInbox reads urgency from the store → grid re-renders that cell.
 *
 * No content leaves the BEAP boundary without gate authorization:
 *   The engine calls runStage61Gate internally before projecting any content.
 *   This hook treats the engine as a black box and simply wires store + config.
 *
 * @version 1.0.0
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { BeapMessage } from '../beapInboxTypes'
import { useBeapInboxStore } from '../useBeapInboxStore'
import {
  classifyBatch,
  selectMessagesForAutoDeletion,
  toStoreClassificationMap,
} from '../services/beapClassificationEngine'
import type {
  ClassificationResult,
  ClassificationEngineConfig,
  AIProvider,
  GatingAuditStore,
} from '../services/beapClassificationEngine'
import type { ReceiverCapabilityPolicy } from '../services/processingEventGate'
import { DEFAULT_CAPABILITY_POLICY } from '../services/processingEventGate'

// =============================================================================
// Public API types
// =============================================================================

/** Status of classification for a single message. */
export type MessageClassificationStatus =
  | 'idle'
  | 'classifying'
  | 'classified'
  | 'gate-blocked'
  | 'no-declaration'
  | 'error'

/** Per-message classification state exposed by the hook. */
export interface MessageClassificationState {
  status: MessageClassificationStatus
  result: ClassificationResult | null
  /** Elapsed time in ms (only set after completion). */
  elapsedMs: number | null
}

/** Configuration for useBulkClassification. */
export interface UseBulkClassificationConfig {
  /**
   * Receiver-side capability policy.
   *
   * IMPORTANT: For any classification to succeed you MUST set
   * `allowSemanticProcessing: true` AND ensure the messages have
   * a non-NONE semantic ProcessingEventOffer declaration.
   *
   * Defaults to DEFAULT_CAPABILITY_POLICY (all blocked).
   */
  policy?: ReceiverCapabilityPolicy

  /** Optional audit store for Stage 6.3 artefacts. */
  auditStore?: GatingAuditStore

  /** Optional AI provider registry. */
  providers?: AIProvider[]

  /** Per-message AI provider timeout in ms. Default: 8000. */
  providerTimeoutMs?: number

  /** Max concurrent classifications. Default: 4. */
  concurrency?: number

  /**
   * Grace period for auto-deletion of irrelevant messages (ms).
   * Default: 172_800_000 (48 hours).
   */
  irrelevanceGracePeriodMs?: number

  /**
   * Minimum confidence to trigger auto-deletion for irrelevant messages.
   * Default: 0.8.
   */
  irrelevanceConfidenceThreshold?: number

  /**
   * How often to check for expired deletions (ms).
   * Default: 10_000 (10 seconds).
   */
  purgePollIntervalMs?: number

  /**
   * Partial GateContext for artefact generation.
   * sessionId is typically the receiver's stable session identifier.
   */
  gateContext?: ClassificationEngineConfig['gateContext']
}

/** Return type of useBulkClassification. */
export interface UseBulkClassificationReturn {
  /**
   * Whether batch classification is currently running.
   * True between the call to startClassification and the last message completing.
   */
  isClassifying: boolean

  /** Number of messages classified so far in the current run. */
  classifiedCount: number

  /** Total messages in the current batch. */
  totalCount: number

  /** Per-message state map keyed by messageId. */
  messageStates: Map<string, MessageClassificationState>

  /**
   * Start classifying the provided batch of messages.
   * If a classification is already running, it is cancelled first.
   */
  startClassification: (messages: BeapMessage[]) => void

  /** Cancel any in-progress classification run. */
  cancelClassification: () => void

  /** Clear all per-message state (does not touch the Zustand store). */
  reset: () => void

  /** Results from the most recent completed run, keyed by messageId. */
  lastResults: Map<string, ClassificationResult>
}

// =============================================================================
// Default config resolution
// =============================================================================

const DEFAULT_CONFIG: Required<UseBulkClassificationConfig> = {
  policy:                         DEFAULT_CAPABILITY_POLICY,
  auditStore:                     undefined as unknown as GatingAuditStore,
  providers:                      [],
  providerTimeoutMs:              8_000,
  concurrency:                    4,
  irrelevanceGracePeriodMs:       172_800_000,
  irrelevanceConfidenceThreshold: 0.8,
  purgePollIntervalMs:            10_000,
  gateContext:                    {},
}

function resolveConfig(cfg?: UseBulkClassificationConfig): Required<UseBulkClassificationConfig> {
  if (!cfg) return DEFAULT_CONFIG
  return {
    policy:                         cfg.policy                         ?? DEFAULT_CONFIG.policy,
    auditStore:                     cfg.auditStore                     ?? DEFAULT_CONFIG.auditStore,
    providers:                      cfg.providers                      ?? DEFAULT_CONFIG.providers,
    providerTimeoutMs:              cfg.providerTimeoutMs              ?? DEFAULT_CONFIG.providerTimeoutMs,
    concurrency:                    cfg.concurrency                    ?? DEFAULT_CONFIG.concurrency,
    irrelevanceGracePeriodMs:       cfg.irrelevanceGracePeriodMs       ?? DEFAULT_CONFIG.irrelevanceGracePeriodMs,
    irrelevanceConfidenceThreshold: cfg.irrelevanceConfidenceThreshold ?? DEFAULT_CONFIG.irrelevanceConfidenceThreshold,
    purgePollIntervalMs:            cfg.purgePollIntervalMs            ?? DEFAULT_CONFIG.purgePollIntervalMs,
    gateContext:                    cfg.gateContext                    ?? DEFAULT_CONFIG.gateContext,
  }
}

// =============================================================================
// Hook implementation
// =============================================================================

/**
 * Drives the classification engine for the bulk inbox grid.
 *
 * Usage:
 * ```typescript
 * const { isClassifying, startClassification, messageStates } = useBulkClassification({
 *   policy: { allowSemanticProcessing: true, allowActuatingProcessing: false },
 *   providers: [myOpenAiProvider],
 *   irrelevanceGracePeriodMs: 48 * 60 * 60 * 1000,
 * })
 *
 * // When batch AI toggled ON:
 * startClassification(visibleMessages)
 * ```
 */
export function useBulkClassification(
  config?: UseBulkClassificationConfig,
): UseBulkClassificationReturn {
  const resolved = resolveConfig(config)

  // Store actions
  const batchClassify        = useBeapInboxStore((s) => s.batchClassify)
  const scheduleDeletion     = useBeapInboxStore((s) => s.scheduleDeletion)
  const purgeExpiredDeletions= useBeapInboxStore((s) => s.purgeExpiredDeletions)

  // Local state
  const [isClassifying, setIsClassifying]     = useState(false)
  const [classifiedCount, setClassifiedCount] = useState(0)
  const [totalCount, setTotalCount]           = useState(0)
  const [messageStates, setMessageStates]     = useState<Map<string, MessageClassificationState>>(
    () => new Map(),
  )
  const [lastResults, setLastResults] = useState<Map<string, ClassificationResult>>(
    () => new Map(),
  )

  // Cancellation token: incremented each time startClassification is called.
  // Progress callbacks check against this generation and discard stale results.
  const generationRef  = useRef(0)
  const startTimesRef  = useRef<Map<string, number>>(new Map())

  // ── Background purge ─────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      purgeExpiredDeletions()
    }, resolved.purgePollIntervalMs)
    return () => clearInterval(id)
  }, [purgeExpiredDeletions, resolved.purgePollIntervalMs])

  // ── Classification ────────────────────────────────────────────────
  const startClassification = useCallback(
    (messages: BeapMessage[]) => {
      if (messages.length === 0) return

      // Bump generation — any in-flight progress from previous runs is discarded
      const generation = ++generationRef.current

      // Reset per-message state to 'classifying'
      const initialStates = new Map<string, MessageClassificationState>()
      const startTimes    = new Map<string, number>()
      const now           = Date.now()

      for (const m of messages) {
        initialStates.set(m.messageId, { status: 'classifying', result: null, elapsedMs: null })
        startTimes.set(m.messageId, now)
      }

      startTimesRef.current = startTimes
      setMessageStates(initialStates)
      setIsClassifying(true)
      setClassifiedCount(0)
      setTotalCount(messages.length)

      // Build engine config with progressive callback
      const engineConfig: ClassificationEngineConfig = {
        policy:                         resolved.policy,
        auditStore:                     resolved.auditStore,
        providers:                      resolved.providers,
        providerTimeoutMs:              resolved.providerTimeoutMs,
        concurrency:                    resolved.concurrency,
        irrelevanceGracePeriodMs:       resolved.irrelevanceGracePeriodMs,
        irrelevanceConfidenceThreshold: resolved.irrelevanceConfidenceThreshold,
        gateContext:                    resolved.gateContext,

        onProgress: ({ messageId, result }) => {
          // Discard stale results from cancelled runs
          if (generationRef.current !== generation) return

          const elapsed = Date.now() - (startTimesRef.current.get(messageId) ?? now)

          // Determine per-message status
          let status: MessageClassificationStatus
          if (result.source === 'gate-blocked') {
            status = 'gate-blocked'
          } else if (result.source === 'no-declaration') {
            status = 'no-declaration'
          } else {
            status = 'classified'
          }

          // Progressive store update: single-message batchClassify
          const classificationMap = new Map([[messageId, result.classification]])
          batchClassify([messageId], classificationMap)

          // Update per-message state
          setMessageStates((prev) => {
            const next = new Map(prev)
            next.set(messageId, { status, result, elapsedMs: elapsed })
            return next
          })

          setClassifiedCount((c) => c + 1)
        },
      }

      classifyBatch(messages, engineConfig)
        .then((results) => {
          // Discard stale completions
          if (generationRef.current !== generation) return

          // Auto-schedule deletion for high-confidence irrelevant messages
          const toDelete = selectMessagesForAutoDeletion(
            messages,
            results,
            resolved.irrelevanceConfidenceThreshold,
          )
          for (const id of toDelete) {
            scheduleDeletion(id, resolved.irrelevanceGracePeriodMs)
          }

          setLastResults(results)
          setIsClassifying(false)
        })
        .catch(() => {
          if (generationRef.current !== generation) return
          setIsClassifying(false)
        })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      resolved.policy,
      resolved.auditStore,
      resolved.providers,
      resolved.providerTimeoutMs,
      resolved.concurrency,
      resolved.irrelevanceGracePeriodMs,
      resolved.irrelevanceConfidenceThreshold,
      resolved.gateContext,
      batchClassify,
      scheduleDeletion,
    ],
  )

  const cancelClassification = useCallback(() => {
    // Bumping the generation prevents further progress callbacks from applying
    generationRef.current++
    setIsClassifying(false)
  }, [])

  const reset = useCallback(() => {
    generationRef.current++
    setIsClassifying(false)
    setClassifiedCount(0)
    setTotalCount(0)
    setMessageStates(new Map())
    setLastResults(new Map())
  }, [])

  return {
    isClassifying,
    classifiedCount,
    totalCount,
    messageStates,
    startClassification,
    cancelClassification,
    reset,
    lastResults,
  }
}
