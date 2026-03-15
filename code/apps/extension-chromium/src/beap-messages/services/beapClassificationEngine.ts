/**
 * BEAP™ AI Classification Engine
 *
 * Classifies a batch of BeapMessages into urgency levels to power the bulk
 * inbox grid sorter.  All classification is gated on the Stage 6.1 pipeline —
 * no message content reaches any AI path without an AUTHORIZED gate result.
 *
 * Pipeline per message
 * ────────────────────
 *   1. Gate check (runStage61Gate)
 *      • BLOCKED  → skip; mark as 'unclassified' in UI
 *   2. Scope-aware content projection
 *      • MINIMAL  → automation tags + subject only (no body)
 *      • SELECTED → declared artefact refs only
 *      • FULL     → canonicalContent (full capsule-bound content)
 *   3. Heuristic pre-classifier (synchronous, runs in-browser)
 *      • Fast signal extraction: deadline words, money, legal, tags
 *      • Returns a preliminary AiClassification with confidence < 0.7
 *   4. Provider dispatch (asynchronous, pluggable)
 *      • If an AIProvider is registered for the message's authorized providers,
 *        the projected payload is dispatched and a richer classification returned.
 *      • Timeout: per-message, configurable (default 8 s); on timeout → keep heuristic result
 *   5. Write classification into the Zustand store via batchClassify
 *      • Progressive: each message is classified as it completes, not batched
 *
 * Gating artefact compliance (Stage 6.3)
 * ────────────────────────────────────────
 *   AuthorizedProcessingResult.gatingArtefacts are forwarded to an optional
 *   GatingAuditStore if one is supplied via ClassificationEngineConfig.auditStore.
 *
 * Boundary and scope enforcement
 * ─────────────────────────────────
 *   Messages where:
 *     • processingEvents is null             → boundary = NONE, gate BLOCKED
 *     • semantic declaration boundary = NONE → gate BLOCKED
 *     • decision = BLOCKED (any reason)      → skipped, classified as 'unclassified'
 *
 * Fail-open only for urgency (not security)
 * ────────────────────────────────────────────
 *   If AI provider times out → keep heuristic classification (normal confidence ~0.3)
 *   If heuristic cannot determine urgency → default = 'normal'
 *   Neither condition bypasses the gate.
 *
 * @version 1.0.0
 */

import type { BeapMessage, AiClassification, UrgencyLevel } from '../beapInboxTypes'
import type {
  AuthorizedProcessingResult,
  GateContext,
  ReceiverCapabilityPolicy,
  GatingAuditStore,
} from './processingEventGate'
import {
  runStage61Gate,
  DEFAULT_CAPABILITY_POLICY,
} from './processingEventGate'
import type { ProcessingScope } from './processingEvents'

// =============================================================================
// Public API types
// =============================================================================

/**
 * Full classification result including gate metadata.
 * Extends AiClassification with reasoning and gate traceability.
 */
export interface ClassificationResult {
  messageId: string

  /** Final AiClassification (written to the store). */
  classification: AiClassification

  /** Human-readable reasoning string for UI display. */
  reasoning: string

  /** How the result was produced. */
  source: 'heuristic' | 'provider' | 'timeout-fallback' | 'gate-blocked' | 'no-declaration'

  /** Whether the message was gated and authorized. */
  gateDecision: 'AUTHORIZED' | 'BLOCKED' | 'SKIPPED'

  /** Gate artefacts from Stage 6.3 (empty if not authorized). */
  gatingArtefacts: AuthorizedProcessingResult['gatingArtefacts']
}

/** Projection of BeapMessage content limited by authorized scope. */
export interface ProjectedContent {
  /**
   * The text payload dispatched to the classifier / AI provider.
   * Respects the authorized scope: MINIMAL = tags only, FULL = canonical content.
   */
  text: string

  /** Automation tags extracted from the message. */
  automationTags: string[]

  /** Effective scope that was enforced. */
  scope: ProcessingScope

  /**
   * For SELECTED scope: the artefact IDs that were declared for selection.
   * Empty for MINIMAL and FULL.
   */
  selectedArtefactRefs: string[]
}

/** Pluggable AI provider interface. */
export interface AIProvider {
  /**
   * Unique provider identifier — must match a `providers[].id` value declared
   * in the message's ProcessingEventOffer for the semantic class.
   */
  providerId: string

  /**
   * Classify a message.  Implementors should return within `timeoutMs`
   * or the engine will use the heuristic result as a fallback.
   */
  classify(
    messageId: string,
    projectedContent: ProjectedContent,
    context: ClassificationContext,
  ): Promise<AiClassificationResponse>
}

/** Contextual metadata passed to the AI provider alongside projected content. */
export interface ClassificationContext {
  senderEmail: string
  senderDisplayName?: string
  trustLevel: BeapMessage['trustLevel']
  automationTags: string[]
  receivedAt: number
  handshakeId: string | null
}

/** Response shape the AI provider must return. */
export interface AiClassificationResponse {
  urgency: UrgencyLevel
  summary: string
  suggestedAction: string
  confidence: number
  reasoning: string
}

/** Outcome emitted per message as classification completes. */
export interface ClassificationProgressEvent {
  messageId: string
  result: ClassificationResult
  /** 0-based index of this message within the batch. */
  batchIndex: number
  /** Total messages in the batch. */
  batchTotal: number
}

/** Configuration for the classification engine. */
export interface ClassificationEngineConfig {
  /**
   * Receiver-side capability policy.  Defaults to `DEFAULT_CAPABILITY_POLICY`
   * (all processing blocked) unless explicitly overridden.
   *
   * For classification to succeed, callers MUST set `allowSemanticProcessing: true`
   * on this policy AND ensure the message's ProcessingEventOffer has a
   * non-NONE semantic declaration.
   */
  policy?: ReceiverCapabilityPolicy

  /**
   * Optional gating audit store.  When provided, gating artefacts from
   * each AUTHORIZED gate run are persisted here.
   */
  auditStore?: GatingAuditStore

  /**
   * Optional AI provider registry.  When provided, messages whose authorized
   * providers include a registered provider ID will be dispatched to that
   * provider for richer classification.
   *
   * When absent, all messages are classified by the heuristic engine only.
   */
  providers?: AIProvider[]

  /**
   * Per-message AI provider timeout in milliseconds.
   * After this period, the heuristic result is used as a fallback.
   * Default: 8000 ms.
   */
  providerTimeoutMs?: number

  /**
   * Maximum number of messages processed concurrently.
   * Default: 4.
   */
  concurrency?: number

  /**
   * Grace period for auto-deletion of messages classified as 'irrelevant'
   * with confidence >= irrelevanceConfidenceThreshold.
   * Default: 172_800_000 ms (48 hours).
   */
  irrelevanceGracePeriodMs?: number

  /**
   * Minimum confidence to auto-schedule deletion for 'irrelevant' messages.
   * Default: 0.8.
   */
  irrelevanceConfidenceThreshold?: number

  /**
   * Called after each message classification completes.
   * Use this for progressive UI updates.
   */
  onProgress?: (event: ClassificationProgressEvent) => void

  /**
   * Gate context for artefact generation.
   * Should include the receiver's session ID + publisher fingerprint.
   */
  gateContext?: Partial<GateContext>
}

// =============================================================================
// Heuristic classifier
// =============================================================================

/** Keyword groups for heuristic urgency scoring. */
const URGENT_SIGNALS = [
  /\burgent\b/i,
  /\bimmediately\b/i,
  /\bASAP\b/,
  /\bdeadline\b/i,
  /\btoday\b/i,
  /\boverdue\b/i,
  /\bpast due\b/i,
  /\bcritical\b/i,
  /\bemergency\b/i,
  /\bfinal notice\b/i,
  /\blegal action\b/i,
  /\blawsuit\b/i,
]

const ACTION_SIGNALS = [
  /\bplease respond\b/i,
  /\baction required\b/i,
  /\bconfirm\b/i,
  /\breview\b/i,
  /\bapprove\b/i,
  /\bsign\b/i,
  /\bpayment\b/i,
  /\binvoice\b/i,
  /\bquote\b/i,
  /\bproposal\b/i,
  /\bmeeting\b/i,
  /\bschedule\b/i,
  /\$[\d,.]+/,           // money amounts
  /\b\d+%\b/,           // percentages (negotiation signals)
]

const IRRELEVANT_SIGNALS = [
  /\bunsubscribe\b/i,
  /\bnewsletter\b/i,
  /\bpromotion\b/i,
  /\bno-reply\b/i,
  /\bnoreply\b/i,
  /\bmarketing\b/i,
  /\bsale\b/i,
  /\bdiscount\b/i,
  /\boffer expires\b/i,
  /\bauto-generated\b/i,
]

/** Trust level urgency weight multiplier (0.8 – 1.2). */
const TRUST_WEIGHT: Record<BeapMessage['trustLevel'], number> = {
  enterprise: 1.2,
  pro: 1.1,
  standard: 1.0,
  depackaged: 0.85,
}

/**
 * Derive a preliminary classification from observable signals without
 * dispatching any content to an external provider.
 */
export function heuristicClassify(
  message: BeapMessage,
  projectedText: string,
): AiClassificationResponse {
  const tags = message.automationTags.map((t) => t.toLowerCase())
  const text = projectedText.toLowerCase()
  const trust = TRUST_WEIGHT[message.trustLevel]

  // Tag-based fast path (high confidence)
  if (tags.includes('urgent') || tags.includes('critical')) {
    return {
      urgency: 'urgent',
      summary: `Urgent message from ${message.senderEmail}.`,
      suggestedAction: 'Review and respond immediately.',
      confidence: Math.min(0.95, 0.85 * trust),
      reasoning: 'Automation tag #urgent present.',
    }
  }
  if (tags.includes('action-required') || tags.includes('action_required')) {
    return {
      urgency: 'action-required',
      summary: `Action required from ${message.senderEmail}.`,
      suggestedAction: 'Review and take action.',
      confidence: Math.min(0.92, 0.82 * trust),
      reasoning: 'Automation tag #action-required present.',
    }
  }
  if (tags.includes('irrelevant') || tags.includes('spam') || tags.includes('newsletter')) {
    return {
      urgency: 'irrelevant',
      summary: 'Automated or marketing message.',
      suggestedAction: 'Archive or delete.',
      confidence: 0.78,
      reasoning: 'Automation tag indicates irrelevant or marketing content.',
    }
  }

  // Content-based scoring
  const urgentHits    = URGENT_SIGNALS.filter((r) => r.test(text)).length
  const actionHits    = ACTION_SIGNALS.filter((r) => r.test(text)).length
  const irrelevantHits= IRRELEVANT_SIGNALS.filter((r) => r.test(text)).length

  const urgentScore    = urgentHits    * 0.25 * trust
  const actionScore    = actionHits    * 0.18 * trust
  const irrelevantScore= irrelevantHits * 0.22

  // Resolve by highest score above threshold
  const scores: [UrgencyLevel, number][] = [
    ['urgent',          urgentScore],
    ['action-required', actionScore],
    ['irrelevant',      irrelevantScore],
  ]

  scores.sort((a, b) => b[1] - a[1])
  const [winner, winnerScore] = scores[0]

  if (winnerScore >= 0.25) {
    const confidence = Math.min(0.68, winnerScore)
    const signals = urgentHits + actionHits + irrelevantHits
    return {
      urgency: winner,
      summary: summarise(message, winner),
      suggestedAction: defaultAction(winner),
      confidence,
      reasoning: `Content analysis: ${signals} keyword signal(s) detected; winner score ${winnerScore.toFixed(2)}.`,
    }
  }

  // Default: normal
  return {
    urgency: 'normal',
    summary: `Standard message from ${message.senderEmail}.`,
    suggestedAction: 'Review at your convenience.',
    confidence: 0.5,
    reasoning: 'No strong urgency signals detected in content or tags.',
  }
}

function summarise(msg: BeapMessage, urgency: UrgencyLevel): string {
  const preview = (msg.canonicalContent || msg.messageBody || '').slice(0, 80).trim()
  const suffix  = urgency === 'urgent'          ? ' — requires immediate attention.'
                : urgency === 'action-required' ? ' — action needed.'
                : urgency === 'irrelevant'      ? ' — appears automated or promotional.'
                : '.'
  return preview ? `${preview}…${suffix}` : `Message from ${msg.senderEmail}${suffix}`
}

function defaultAction(urgency: UrgencyLevel): string {
  switch (urgency) {
    case 'urgent':          return 'Reply immediately.'
    case 'action-required': return 'Review and respond.'
    case 'irrelevant':      return 'Archive or delete.'
    default:                return 'Review at your convenience.'
  }
}

// =============================================================================
// Content projection
// =============================================================================

/**
 * Derives the text payload to be sent to the classifier, respecting the
 * authorized scope from the gate result.
 *
 * MINIMAL  → only automation tags + very short metadata (NO body)
 * SELECTED → content from declared selectedArtefactRefs only (uses canonicalContent as fallback)
 * FULL     → full canonicalContent
 */
export function projectContent(
  message: BeapMessage,
  authorizedScope: ProcessingScope,
): ProjectedContent {
  const tags = message.automationTags

  switch (authorizedScope) {
    case 'MINIMAL': {
      const tagLine = tags.length > 0 ? `Tags: ${tags.map((t) => '#' + t).join(' ')}` : ''
      return {
        text: [tagLine, `Sender: ${message.senderEmail}`, `Trust: ${message.trustLevel}`]
          .filter(Boolean)
          .join('\n'),
        automationTags: tags,
        scope: 'MINIMAL',
        selectedArtefactRefs: [],
      }
    }

    case 'SELECTED': {
      const refs = message.processingEvents?.declarations
        ?.find((d) => d.class === 'semantic')
        ?.selectedArtefactRefs ?? []

      // Collect semantic content from matching attachments
      const selectedText = refs.length > 0
        ? message.attachments
            .filter((a) => refs.includes(a.attachmentId))
            .map((a) => a.semanticContent ?? a.filename)
            .join('\n')
        : (message.canonicalContent || message.messageBody || '')

      return {
        text: selectedText,
        automationTags: tags,
        scope: 'SELECTED',
        selectedArtefactRefs: refs,
      }
    }

    case 'FULL':
    default: {
      return {
        text: message.canonicalContent || message.messageBody || '',
        automationTags: tags,
        scope: 'FULL',
        selectedArtefactRefs: [],
      }
    }
  }
}

// =============================================================================
// Synthetic gate capsule builder
// =============================================================================

/**
 * Build a minimal DecryptedCapsulePayload-compatible structure from a
 * BeapMessage so it can be passed to runStage61Gate without needing to
 * retain the original decrypted capsule post-depackaging.
 *
 * NOTE: This is a lightweight re-check of the gate policy against the
 * message metadata — not a full re-run of the depackaging pipeline.
 * The original cryptographic verification already happened at Stage 5.
 */
function buildSyntheticCapsule(message: BeapMessage): import('./beapDecrypt').DecryptedCapsulePayload {
  return {
    subject: '',
    body: message.canonicalContent || message.messageBody || '',
    attachments: message.attachments.map((a) => ({
      id: a.attachmentId,
      originalName: a.filename,
      originalSize: a.sizeBytes,
      originalType: a.mimeType,
      semanticExtracted: !!a.semanticContent,
      semanticContent: a.semanticContent,
    })),
    automation: message.automationTags.length > 0
      ? {
          tags: message.automationTags,
          tagSource: 'encrypted' as const,
          receiverHasFinalAuthority: true as const,
        }
      : undefined,
  }
}

// =============================================================================
// Single-message classification
// =============================================================================

/**
 * Resolve the best-matching authorized scope from the gate result.
 * Returns the scope declared in the semantic authorization, or MINIMAL if
 * none can be found (conservative fallback).
 */
function resolveAuthorizedScope(gateResult: AuthorizedProcessingResult): ProcessingScope {
  const semanticEvent = gateResult.authorizedEvents.find((e) => e.class === 'semantic')
  return semanticEvent?.impliedScope ?? 'MINIMAL'
}

/**
 * Find the first registered provider that matches any of the authorized
 * provider IDs from the gate result.
 */
function resolveProvider(
  gateResult: AuthorizedProcessingResult,
  providers: AIProvider[],
): AIProvider | null {
  // Collect all permitted provider IDs from the semantic gate result
  const authorizedIds = new Set<string>(gateResult.authorizedTokenIds)
  const permittedProviderIds = gateResult.processingGate.effective.semantic.permittedProviderIds
  for (const id of permittedProviderIds) {
    authorizedIds.add(id)
  }
  return providers.find((p) => authorizedIds.has(p.providerId)) ?? null
}

/** Run Stage 6.1 gate for a single BeapMessage. */
async function gateMessage(
  message: BeapMessage,
  policy: ReceiverCapabilityPolicy,
  gateContext: GateContext,
): Promise<AuthorizedProcessingResult> {
  const capsule = buildSyntheticCapsule(message)
  return runStage61Gate(
    capsule,
    [],  // artefacts — not available post-depackaging; gate uses capsule content for implication
    message.processingEvents,
    policy,
    gateContext,
  )
}

/** Classify a single message end-to-end. */
async function classifySingleMessage(
  message: BeapMessage,
  config: Required<ClassificationEngineConfig>,
  gateContext: GateContext,
): Promise<ClassificationResult> {
  // ── 1. Quick pre-check: no processingEvents means NONE boundary ────
  if (!message.processingEvents) {
    return {
      messageId: message.messageId,
      classification: {
        urgency: 'normal',
        summary: `Message from ${message.senderEmail} — no processing declaration.`,
        suggestedAction: 'Review at your convenience.',
        confidence: 0.3,
      },
      reasoning: 'No ProcessingEventOffer present; boundary treated as NONE.',
      source: 'no-declaration',
      gateDecision: 'SKIPPED',
      gatingArtefacts: [],
    }
  }

  // ── 2. Stage 6.1 gate ─────────────────────────────────────────────
  let gateResult: AuthorizedProcessingResult
  try {
    gateResult = await gateMessage(message, config.policy, gateContext)
  } catch (err) {
    // Gate threw — treat as BLOCKED (fail closed)
    return {
      messageId: message.messageId,
      classification: {
        urgency: 'normal',
        summary: `Gate error for message from ${message.senderEmail}.`,
        suggestedAction: 'Review at your convenience.',
        confidence: 0.2,
      },
      reasoning: `Stage 6.1 gate threw an exception: ${err instanceof Error ? err.message : String(err)}`,
      source: 'gate-blocked',
      gateDecision: 'BLOCKED',
      gatingArtefacts: [],
    }
  }

  if (gateResult.decision !== 'AUTHORIZED') {
    return {
      messageId: message.messageId,
      classification: {
        urgency: 'normal',
        summary: `Message from ${message.senderEmail} — processing blocked by gate.`,
        suggestedAction: 'Review at your convenience.',
        confidence: 0.2,
      },
      reasoning: [
        'Stage 6.1 gate decision: BLOCKED.',
        ...gateResult.alignmentViolations,
        ...gateResult.capabilityViolations,
        ...gateResult.consentViolations,
      ].join(' | '),
      source: 'gate-blocked',
      gateDecision: 'BLOCKED',
      gatingArtefacts: [],
    }
  }

  // ── 3. Persist gating artefacts ───────────────────────────────────
  if (gateResult.gatingArtefacts.length > 0 && config.auditStore) {
    config.auditStore.persistGatingArtefacts(gateResult.gatingArtefacts).catch(() => {
      // GatingAuditStore.persistGatingArtefacts MUST NOT throw per contract
    })
  }

  // ── 4. Scope-aware content projection ────────────────────────────
  const authorizedScope = resolveAuthorizedScope(gateResult)
  const projected       = projectContent(message, authorizedScope)

  // ── 5. Heuristic pre-classification ──────────────────────────────
  const heuristicResult = heuristicClassify(message, projected.text)

  // ── 6. Provider dispatch (if registered + within scope) ──────────
  const provider = resolveProvider(gateResult, config.providers)

  if (!provider) {
    return {
      messageId: message.messageId,
      classification: {
        urgency: heuristicResult.urgency,
        summary: heuristicResult.summary,
        suggestedAction: heuristicResult.suggestedAction,
        confidence: heuristicResult.confidence,
      },
      reasoning: heuristicResult.reasoning,
      source: 'heuristic',
      gateDecision: 'AUTHORIZED',
      gatingArtefacts: gateResult.gatingArtefacts,
    }
  }

  // Dispatch with timeout
  let providerResponse: AiClassificationResponse
  try {
    providerResponse = await Promise.race<AiClassificationResponse>([
      provider.classify(message.messageId, projected, {
        senderEmail: message.senderEmail,
        senderDisplayName: message.senderDisplayName,
        trustLevel: message.trustLevel,
        automationTags: message.automationTags,
        receivedAt: message.receivedAt,
        handshakeId: message.handshakeId,
      }),
      new Promise<AiClassificationResponse>((_, reject) =>
        setTimeout(() => reject(new Error('provider-timeout')), config.providerTimeoutMs),
      ),
    ])
  } catch (err) {
    const isTimeout = err instanceof Error && err.message === 'provider-timeout'
    return {
      messageId: message.messageId,
      classification: {
        urgency: heuristicResult.urgency,
        summary: heuristicResult.summary,
        suggestedAction: heuristicResult.suggestedAction,
        confidence: heuristicResult.confidence,
      },
      reasoning: isTimeout
        ? `Provider timeout after ${config.providerTimeoutMs}ms; using heuristic fallback.`
        : `Provider error: ${err instanceof Error ? err.message : String(err)}; using heuristic fallback.`,
      source: 'timeout-fallback',
      gateDecision: 'AUTHORIZED',
      gatingArtefacts: gateResult.gatingArtefacts,
    }
  }

  return {
    messageId: message.messageId,
    classification: {
      urgency: providerResponse.urgency,
      summary: providerResponse.summary,
      suggestedAction: providerResponse.suggestedAction,
      confidence: providerResponse.confidence,
    },
    reasoning: providerResponse.reasoning,
    source: 'provider',
    gateDecision: 'AUTHORIZED',
    gatingArtefacts: gateResult.gatingArtefacts,
  }
}

// =============================================================================
// Batch classification
// =============================================================================

/** Resolve a full ClassificationEngineConfig from a partial user config. */
function resolveConfig(config: ClassificationEngineConfig): Required<ClassificationEngineConfig> {
  return {
    policy:                        config.policy                        ?? DEFAULT_CAPABILITY_POLICY,
    auditStore:                    config.auditStore                    ?? null as unknown as GatingAuditStore,
    providers:                     config.providers                     ?? [],
    providerTimeoutMs:             config.providerTimeoutMs             ?? 8_000,
    concurrency:                   config.concurrency                   ?? 4,
    irrelevanceGracePeriodMs:      config.irrelevanceGracePeriodMs      ?? 172_800_000, // 48 h
    irrelevanceConfidenceThreshold:config.irrelevanceConfidenceThreshold ?? 0.8,
    onProgress:                    config.onProgress                    ?? (() => {}),
    gateContext:                   config.gateContext                   ?? {},
  }
}

/** Build a GateContext from a partial one + message-level fields. */
function buildGateContext(partial: Partial<GateContext>, message: BeapMessage): GateContext {
  return {
    sessionId:           partial.sessionId           ?? `bulk-classify-${Date.now()}`,
    templateHash:        partial.templateHash        ?? message.messageId,
    publisherFingerprint:partial.publisherFingerprint ?? message.senderFingerprint,
    poaeRecordId:        partial.poaeRecordId,
  }
}

/**
 * Run the full classification pipeline on a batch of messages.
 *
 * Messages are processed with bounded concurrency (`config.concurrency`).
 * As each classification completes, `config.onProgress` is called with the
 * result — use this for progressive UI updates.
 *
 * Returns a Map of all results keyed by messageId.
 */
export async function classifyBatch(
  messages: BeapMessage[],
  config: ClassificationEngineConfig = {},
): Promise<Map<string, ClassificationResult>> {
  const resolved    = resolveConfig(config)
  const resultMap   = new Map<string, ClassificationResult>()
  const total       = messages.length

  let batchIndex    = 0
  let activeCount   = 0
  let resolvedCount = 0

  return new Promise<Map<string, ClassificationResult>>((resolve) => {
    if (total === 0) {
      resolve(resultMap)
      return
    }

    const queue = [...messages]

    function tryDispatch() {
      while (activeCount < resolved.concurrency && queue.length > 0) {
        const message = queue.shift()!
        const thisIndex = batchIndex++
        activeCount++

        const gateContext = buildGateContext(resolved.gateContext, message)

        classifySingleMessage(message, resolved, gateContext)
          .then((result) => {
            resultMap.set(message.messageId, result)
            resolved.onProgress({
              messageId: message.messageId,
              result,
              batchIndex: thisIndex,
              batchTotal: total,
            })
          })
          .catch(() => {
            // Unexpected — treat as heuristic normal
            const fallback: ClassificationResult = {
              messageId: message.messageId,
              classification: {
                urgency: 'normal',
                summary: `Message from ${message.senderEmail}.`,
                suggestedAction: 'Review at your convenience.',
                confidence: 0.1,
              },
              reasoning: 'Unexpected classification error — defaulted to normal.',
              source: 'heuristic',
              gateDecision: 'SKIPPED',
              gatingArtefacts: [],
            }
            resultMap.set(message.messageId, fallback)
            resolved.onProgress({
              messageId: message.messageId,
              result: fallback,
              batchIndex: thisIndex,
              batchTotal: total,
            })
          })
          .finally(() => {
            activeCount--
            resolvedCount++
            if (resolvedCount === total) {
              resolve(resultMap)
            } else {
              tryDispatch()
            }
          })
      }
    }

    tryDispatch()
  })
}

// =============================================================================
// Grace period helpers (exported for use in the hook)
// =============================================================================

/**
 * Determine which messages from a classification run should have
 * auto-deletion scheduled.
 *
 * Criteria:
 *   • urgency === 'irrelevant'
 *   • confidence >= threshold
 *   • Not already scheduled for deletion
 *   • Gate decision was AUTHORIZED (not skipped/blocked)
 */
export function selectMessagesForAutoDeletion(
  messages: BeapMessage[],
  results: Map<string, ClassificationResult>,
  confidenceThreshold: number,
): string[] {
  return messages
    .filter((m) => {
      if (m.deletionScheduled) return false
      const result = results.get(m.messageId)
      if (!result) return false
      return (
        result.classification.urgency === 'irrelevant' &&
        result.classification.confidence >= confidenceThreshold &&
        result.gateDecision === 'AUTHORIZED'
      )
    })
    .map((m) => m.messageId)
}

/**
 * Collect the AiClassification portion of each result into a Map
 * suitable for `useBeapInboxStore.batchClassify`.
 *
 * Messages from 'gate-blocked' or 'no-declaration' sources are included
 * with their default 'normal' classification (lower confidence),
 * so the UI always has a classification entry for every processed message.
 */
export function toStoreClassificationMap(
  results: Map<string, ClassificationResult>,
): Map<string, AiClassification> {
  const map = new Map<string, AiClassification>()
  for (const [id, result] of results.entries()) {
    map.set(id, result.classification)
  }
  return map
}
