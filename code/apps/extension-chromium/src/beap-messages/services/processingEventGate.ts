/**
 * Processing Event Gate — Stage 6.1 (A.3.055 + A.3.054 Stage 6.1.1 — Normative)
 *
 * Implements the full receiver-side gating engine that must run AFTER successful
 * Capsule depackaging and BEFORE any semantic processing or actuation.
 *
 * Pipeline:
 *   1. extractImpliedEvents()          — derive all processing events implied by capsule content
 *   2. alignImpliedWithDeclarations()  — verify each implied event is covered by sender's declaration
 *   3. evaluateCapabilityTokens()      — enforce data-class + access-scope constraints (A.3.054 Stage 6.1.1)
 *   4. evaluateProcessingEventGate()   — existing boundary/scope/provider/retention check
 *   5. resolveConsentRequirements()    — Stage 6.2: evaluate per-class consent state against policy
 *   6. generateGatingArtefacts()       — Stage 6.3: produce tamper-evident commitments
 *   → compose AuthorizedProcessingResult
 *
 * Fail-closed semantics: ANY violation at ANY stage → decision = 'BLOCKED',
 * authorizedEvents = [], and no processing SHALL occur.
 *
 * Data Access as Capability Property (A.3.054 Stage 6.1.1):
 *   Access is governed exclusively by Capability Tokens. An agent MUST NOT
 *   access data beyond its token scope. The enforcement boundary is this
 *   gate, not the agent's execution path.
 */

import type { DecryptedCapsulePayload, DecryptedArtefact } from './beapDecrypt'
import {
  evaluateProcessingEventGate,
  type ReceiverProcessingPolicy,
  type ProcessingGateResult,
} from './beapDecrypt'
import type {
  ProcessingEventOffer,
  ProcessingEventClass,
  ProcessingBoundary,
  ProcessingScope,
} from './processingEvents'
import { getDeclarationForClass } from './processingEvents'
import { sha256String, stableCanonicalize } from './beapCrypto'

// =============================================================================
// Data-Class Taxonomy (A.3.054 Stage 6.1.1 — Normative)
// =============================================================================

/**
 * Classification of data accessible through a processing event.
 *
 * Per A.3.054 Stage 6.1.1, capability tokens enumerate permitted data classes.
 * An agent MUST NOT access data in a class not covered by its token.
 *
 * Ordering from most to least sensitive:
 *   PII > BUSINESS_CRITICAL > INFORMATIONAL > NON_SENSITIVE
 */
export type DataClass =
  | 'PII'
  | 'BUSINESS_CRITICAL'
  | 'INFORMATIONAL'
  | 'NON_SENSITIVE'

// =============================================================================
// Capability Token Model (A.3.054 Stage 6.1.1 — Normative)
// =============================================================================

/**
 * Access scope on a Capability Token.
 *
 * - read:        read-only access to data (minimum for semantic processing)
 * - write:       may produce derived outputs (embeddings, summaries)
 * - activate:    may trigger system-level or external effects (minimum for actuating)
 * - synchronize: may synchronise state with external or local stores
 */
export type AccessScope = 'read' | 'write' | 'activate' | 'synchronize'

/**
 * A Capability Token authorising a specific agent to access a defined set
 * of data classes with a defined set of access scopes for a stated purpose.
 *
 * Per A.3.054 Stage 6.1.1 (Normative):
 * - Tokens define permitted data classes, access scopes, and purpose identifiers.
 * - An agent MUST NOT access data beyond its token scope.
 * - The enforcement boundary is the capability gate, not the agent execution path.
 * - Expired tokens (expiresAt < Date.now()) are treated as absent.
 */
export interface CapabilityToken {
  /** Stable unique identifier for this token (used in audit / authorized result). */
  tokenId: string

  /**
   * Human-readable purpose identifier (e.g. 'inbox-semantic-summary',
   * 'automation-tag-routing'). Not governance-authoritative; for audit only.
   */
  purposeId: string

  /** Data classes this token permits access to. */
  permittedDataClasses: DataClass[]

  /** Access scopes granted by this token. */
  accessScopes: AccessScope[]

  /**
   * Optional Unix timestamp (ms) after which the token is expired.
   * Absent = no expiry. Expired tokens are silently treated as absent.
   */
  expiresAt?: number
}

// =============================================================================
// Receiver Capability Policy
// =============================================================================

/**
 * Extended receiver policy that adds Capability Tokens to the base processing
 * event boundary/scope/provider/retention policy.
 *
 * `ReceiverCapabilityPolicy` is a strict superset of `ReceiverProcessingPolicy`
 * — any existing caller passing a `ReceiverProcessingPolicy` is fully
 * backward-compatible (capability token checks are skipped when no tokens are
 * present, which is fail-open only for data-class access; the boundary/scope
 * checks in the base policy remain authoritative).
 *
 * When `capabilityTokens` is provided, at least one valid non-expired token
 * covering all required data classes and access scopes MUST exist for each
 * implied processing event, otherwise that event is BLOCKED.
 */
export interface ReceiverCapabilityPolicy extends ReceiverProcessingPolicy {
  /**
   * Capability tokens authorising data access.
   *
   * Per A.3.054 Stage 6.1.1: if this list is provided (even empty), ALL
   * implied events must be covered by at least one valid token.
   * If this field is absent entirely, token gating is skipped (legacy mode).
   */
  capabilityTokens?: CapabilityToken[]

  /**
   * Previously recorded consent decisions for this receiver context.
   *
   * Per A.3.055 Stage 6.2: interactive consent MUST be obtained immediately
   * prior to remote processing UNLESS a previously recorded authorization
   * matches: provider identity + processing scope class + session/template/
   * publisher/assurance binding.
   *
   * When present, matching records allow `REMOTE` processing without a new
   * interactive consent action. Records that don't match cause consent to be
   * required.
   *
   * When absent, no prior consent is known — treat as if no consent exists
   * (fail-closed for REMOTE, proceed for LOCAL within policy).
   */
  priorConsentRecords?: ConsentRecord[]

  /**
   * Whether unattended actuation is explicitly permitted under the receiver's
   * verified assurance profile (A.3.055 Stage 6.2 — Actuating Events).
   *
   * Default: false. When false, all actuating events require explicit per-event
   * authorization (interactive confirmation or policy-level explicit permit).
   */
  allowUnattendedActuation?: boolean

  /**
   * Audit store for persisting gating artefacts (Stage 6.3).
   *
   * When provided, `generateGatingArtefact()` results are forwarded to this
   * store after each gate run. When absent, artefacts are returned in
   * `AuthorizedProcessingResult.gatingArtefacts` only (caller's responsibility).
   */
  auditStore?: GatingAuditStore
}

/** Canonical fail-closed capability policy with no processing permitted. */
export const DEFAULT_CAPABILITY_POLICY: ReceiverCapabilityPolicy = {
  allowSemanticProcessing: false,
  allowActuatingProcessing: false,
  maxSemanticBoundary: 'NONE',
  maxActuatingBoundary: 'NONE',
  maxSemanticRetention: 'NONE',
  maxActuatingRetention: 'NONE',
  // No capabilityTokens — token gating skipped; base policy is authoritative
}

// =============================================================================
// Implied Processing Event (derived from capsule content inspection)
// =============================================================================

/**
 * A processing event implied by the actual content of a decrypted Capsule.
 *
 * These are NOT declarations — they are facts about what would need to happen
 * for an agent to process the capsule. They must be reconciled against the
 * sender's declared ProcessingEventOffer before any processing occurs.
 *
 * Per A.3.055: all implied events must be declared; undeclared implied events
 * cause the gate to fail closed.
 */
export interface ImpliedProcessingEvent {
  /** Which processing class this event belongs to. */
  class: ProcessingEventClass

  /**
   * Short machine-readable reason code for why this event was implied.
   * Values follow the pattern 'capsule.<field>' or 'artefact.<field>'.
   * Used for audit logs and violation messages.
   */
  reason:
    | 'capsule.body'
    | 'capsule.attachment.semanticContent'
    | 'capsule.attachment.documentType'
    | 'capsule.automation.tags'
    | 'capsule.attachment.mediaContent'

  /** Minimum boundary required to perform this event. */
  impliedBoundary: ProcessingBoundary

  /** Minimum scope required to perform this event. */
  impliedScope: ProcessingScope

  /** Data classes that would be accessed by this event. */
  dataClasses: DataClass[]

  /** Human-readable description for audit / UI display. */
  description: string
}

// =============================================================================
// Gate Decision and Authorized Result
// =============================================================================

/** Outcome of the Stage 6.1 gate. */
export type GateDecision = 'AUTHORIZED' | 'BLOCKED'

/**
 * The authoritative result of the full Stage 6.1 gating pipeline.
 *
 * Consumers MUST check `decision === 'AUTHORIZED'` before performing any
 * processing. A `BLOCKED` result means NO processing event may proceed,
 * regardless of `authorizedEvents` (which will always be empty when blocked).
 *
 * The forwarded `processingGate` field preserves the existing
 * `ProcessingGateResult` structure for backward compatibility — callers that
 * previously read `pkg.processingGate` can read `pkg.authorizedProcessing.processingGate`.
 */
export interface AuthorizedProcessingResult {
  /** Top-level gate decision. BLOCKED means nothing may proceed. */
  decision: GateDecision

  /**
   * Forwarded result from `evaluateProcessingEventGate`.
   * Always populated, even when decision is BLOCKED.
   */
  processingGate: ProcessingGateResult

  /** All events implied by capsule content inspection. */
  impliedEvents: ImpliedProcessingEvent[]

  /**
   * Subset of impliedEvents that passed all checks.
   * Empty when decision is BLOCKED.
   */
  authorizedEvents: ImpliedProcessingEvent[]

  /** Subset of impliedEvents that were blocked by any check. */
  blockedEvents: ImpliedProcessingEvent[]

  /**
   * Violations produced during declaration alignment (Step 2).
   * Each entry is a human-readable string citing the specific mismatch.
   */
  alignmentViolations: string[]

  /**
   * Violations produced during capability token evaluation (Step 3).
   * Each entry names the implied event reason and the missing coverage.
   */
  capabilityViolations: string[]

  /**
   * Token IDs that were matched and used for authorisation.
   * Empty when decision is BLOCKED or no tokens were provided.
   */
  authorizedTokenIds: string[]

  /**
   * Stage 6.2 consent resolution outcome for each processing class.
   * Always populated; consumers use this to determine if interactive
   * consent must be solicited before dispatching any processing.
   */
  consentResolution: ConsentResolutionResult

  /**
   * Stage 6.2 violations (consent/approval failures).
   * Non-empty means REMOTE processing is blocked or ACTUATING is not permitted.
   */
  consentViolations: string[]

  /**
   * Stage 6.3 gating artefacts generated for this gate run.
   * One artefact per authorized implied event class (semantic / actuating).
   * Empty when decision is BLOCKED.
   */
  gatingArtefacts: GatingArtefact[]
}

// =============================================================================
// Step 1: Implied Event Extraction
// =============================================================================

/**
 * Inspect decrypted capsule content and derive all processing events that
 * would be implied if an agent were to process this capsule.
 *
 * This does NOT trigger any processing — it is a structural analysis only.
 * The derived events are then reconciled against the sender's declarations
 * in Step 2.
 *
 * Classification rules (conservative — minimal implied boundary/scope):
 *
 * | Content                            | Class     | Boundary | Scope    | Data Classes              |
 * |------------------------------------|-----------|----------|----------|---------------------------|
 * | capsule.body non-empty             | semantic  | LOCAL    | MINIMAL  | INFORMATIONAL             |
 * | attachment.semanticContent present | semantic  | LOCAL    | SELECTED | INFORMATIONAL             |
 * | attachment type is pdf/image       | semantic  | LOCAL    | SELECTED | INFORMATIONAL             |
 * | attachment type is media           | semantic  | LOCAL    | SELECTED | NON_SENSITIVE             |
 * | automation.tags non-empty          | actuating | LOCAL    | MINIMAL  | BUSINESS_CRITICAL         |
 *
 * @param capsule  - Decrypted capsule payload (post-AEAD)
 * @param artefacts - Decrypted artefacts associated with the capsule
 * @returns List of implied processing events derived from content inspection
 */
export function extractImpliedEvents(
  capsule: DecryptedCapsulePayload,
  _artefacts: DecryptedArtefact[]
): ImpliedProcessingEvent[] {
  const implied: ImpliedProcessingEvent[] = []

  // ── Capsule body ─────────────────────────────────────────────────────────
  if (capsule.body && capsule.body.trim().length > 0) {
    implied.push({
      class: 'semantic',
      reason: 'capsule.body',
      impliedBoundary: 'LOCAL',
      impliedScope: 'MINIMAL',
      dataClasses: ['INFORMATIONAL'],
      description: 'Capsule body text present — reading requires semantic access.',
    })
  }

  // ── Attachment-level events ───────────────────────────────────────────────
  for (const attachment of capsule.attachments ?? []) {
    // Pre-extracted semantic content (already in plaintext inside the capsule)
    if (attachment.semanticContent && attachment.semanticContent.trim().length > 0) {
      implied.push({
        class: 'semantic',
        reason: 'capsule.attachment.semanticContent',
        impliedBoundary: 'LOCAL',
        impliedScope: 'SELECTED',
        dataClasses: ['INFORMATIONAL'],
        description: `Attachment '${attachment.originalName}' contains pre-extracted semantic content.`,
      })
    }

    // Document types that imply OCR-to-indexing or page analysis
    const type = (attachment.originalType ?? '').toLowerCase()
    const isDocument =
      type.includes('pdf') ||
      type.includes('word') ||
      type.includes('document') ||
      type.includes('presentation') ||
      type.includes('spreadsheet') ||
      type.includes('text/')

    if (isDocument && !attachment.semanticContent) {
      implied.push({
        class: 'semantic',
        reason: 'capsule.attachment.documentType',
        impliedBoundary: 'LOCAL',
        impliedScope: 'SELECTED',
        dataClasses: ['INFORMATIONAL'],
        description: `Attachment '${attachment.originalName}' is a document type — OCR/indexing path implied.`,
      })
    }

    // Media files (images, video) that may imply visual processing
    const isMedia =
      attachment.isMedia === true ||
      type.startsWith('image/') ||
      type.startsWith('video/') ||
      type.startsWith('audio/')

    if (isMedia) {
      implied.push({
        class: 'semantic',
        reason: 'capsule.attachment.mediaContent',
        impliedBoundary: 'LOCAL',
        impliedScope: 'SELECTED',
        dataClasses: ['NON_SENSITIVE'],
        description: `Attachment '${attachment.originalName}' is a media file — visual/audio processing implied.`,
      })
    }
  }

  // ── Automation tags (actuating) ───────────────────────────────────────────
  const automation = capsule.automation
  if (
    automation &&
    automation.tags.length > 0 &&
    automation.tagSource !== 'none'
  ) {
    implied.push({
      class: 'actuating',
      reason: 'capsule.automation.tags',
      impliedBoundary: 'LOCAL',
      impliedScope: 'MINIMAL',
      dataClasses: ['BUSINESS_CRITICAL'],
      description: `Capsule contains ${automation.tags.length} automation tag(s) from source '${automation.tagSource}' — actuation implied.`,
    })
  }

  return implied
}

// =============================================================================
// Step 2: Declaration Alignment
// =============================================================================

/**
 * Verify that each implied processing event is covered by the sender's
 * ProcessingEventOffer declarations.
 *
 * An implied event is "covered" when:
 *   - The corresponding class declaration exists in the offer (or defaults to NONE)
 *   - The declared boundary is >= the implied boundary (NONE < LOCAL < REMOTE)
 *   - The declared scope is >= the implied scope (MINIMAL < SELECTED < FULL)
 *
 * If a declaration is NONE for a class that has implied events → violation.
 * If a declaration's boundary is lower than what the implied event requires → violation.
 * If a declaration's scope is lower than what the implied event requires → violation.
 *
 * Per A.3.055: if ANY implied event is not declared or exceeds declared
 * constraints → FAIL CLOSED, execute NO processing events.
 *
 * @param implied - Events derived from capsule content inspection
 * @param offer   - Sender's declared ProcessingEventOffer from the envelope header
 * @returns Array of human-readable violation strings; empty = all aligned
 */
export function alignImpliedWithDeclarations(
  implied: ImpliedProcessingEvent[],
  offer: ProcessingEventOffer | undefined | null
): string[] {
  const violations: string[] = []

  const boundaryLevel: Record<ProcessingBoundary, number> = { NONE: 0, LOCAL: 1, REMOTE: 2 }
  const scopeLevel: Record<ProcessingScope, number> = { MINIMAL: 0, SELECTED: 1, FULL: 2 }

  for (const event of implied) {
    const decl = getDeclarationForClass(offer, event.class)

    if (decl.boundary === 'NONE') {
      violations.push(
        `STAGE_6.1 [ALIGN]: Implied ${event.class} event (reason='${event.reason}') ` +
        `requires boundary>='${event.impliedBoundary}' but declaration is 'NONE'. ` +
        `Processing BLOCKED.`
      )
      continue
    }

    if (boundaryLevel[decl.boundary] < boundaryLevel[event.impliedBoundary]) {
      violations.push(
        `STAGE_6.1 [ALIGN]: Implied ${event.class} event (reason='${event.reason}') ` +
        `requires boundary>='${event.impliedBoundary}' but declared boundary='${decl.boundary}'. ` +
        `Processing BLOCKED.`
      )
    }

    if (scopeLevel[decl.scope] < scopeLevel[event.impliedScope]) {
      violations.push(
        `STAGE_6.1 [ALIGN]: Implied ${event.class} event (reason='${event.reason}') ` +
        `requires scope>='${event.impliedScope}' but declared scope='${decl.scope}'. ` +
        `Processing BLOCKED.`
      )
    }
  }

  return violations
}

// =============================================================================
// Step 3: Capability Token Evaluation (A.3.054 Stage 6.1.1)
// =============================================================================

/**
 * Evaluate Capability Tokens against the set of implied processing events.
 *
 * For each implied event, at least one valid non-expired token must exist that:
 *   - Covers ALL data classes required by the event (subset check)
 *   - Grants the minimum required access scope:
 *       semantic  → 'read' (minimum)
 *       actuating → 'activate' (minimum)
 *
 * An agent MUST NOT access data beyond its token scope.
 * The enforcement boundary is this gate, not the agent execution path.
 *
 * When `tokens` is `undefined`, capability token gating is SKIPPED (legacy mode).
 * When `tokens` is an empty array `[]`, ALL events with implied data classes
 * other than NON_SENSITIVE are blocked (no token can cover them).
 *
 * @param implied - Events derived from capsule content inspection
 * @param tokens  - Receiver's capability tokens; undefined = skip gating
 * @returns Capability violations and the IDs of tokens that were matched
 */
export function evaluateCapabilityTokens(
  implied: ImpliedProcessingEvent[],
  tokens: CapabilityToken[] | undefined
): { capabilityViolations: string[]; authorizedTokenIds: string[] } {
  // Legacy mode: no token list provided → skip capability gating
  if (tokens === undefined) {
    return { capabilityViolations: [], authorizedTokenIds: [] }
  }

  const now = Date.now()
  const validTokens = tokens.filter(t => t.expiresAt === undefined || t.expiresAt > now)

  const capabilityViolations: string[] = []
  const authorizedTokenIdSet = new Set<string>()

  const requiredScopeForClass: Record<ProcessingEventClass, AccessScope> = {
    semantic: 'read',
    actuating: 'activate',
  }

  for (const event of implied) {
    const requiredScope = requiredScopeForClass[event.class]

    const matchingToken = validTokens.find(token => {
      const coversDataClasses = event.dataClasses.every(dc =>
        token.permittedDataClasses.includes(dc)
      )
      const coversScope = token.accessScopes.includes(requiredScope)
      return coversDataClasses && coversScope
    })

    if (matchingToken) {
      authorizedTokenIdSet.add(matchingToken.tokenId)
    } else {
      capabilityViolations.push(
        `STAGE_6.1 [TOKEN]: No valid capability token covers ${event.class} event ` +
        `(reason='${event.reason}', dataClasses=[${event.dataClasses.join(', ')}], ` +
        `requiredScope='${requiredScope}'). ` +
        `Processing BLOCKED.`
      )
    }
  }

  return {
    capabilityViolations,
    authorizedTokenIds: Array.from(authorizedTokenIdSet),
  }
}

// =============================================================================
// Stage 6.2: Consent and Approval Resolution (A.3.055 Stage 6.2 — Normative)
// =============================================================================

/**
 * Binding context that a consent record must match for reuse without
 * interactive re-consent (per A.3.055 Stage 6.2).
 *
 * A previously recorded authorization is reusable ONLY when ALL of the
 * following match:
 *   - provider identity (one or more declared providerIds)
 *   - processing scope class (semantic vs actuating)
 *   - session/template/publisher/assurance binding
 */
export interface ConsentBindingContext {
  /** Provider IDs that were consented to. */
  providerIds: string[]

  /** Processing class this consent covers. */
  processingClass: ProcessingEventClass

  /**
   * Template hash of the capsule this consent was granted for.
   * Used for template-scoped consent: same template = no re-consent needed.
   */
  templateHash?: string

  /** Session ID within which the consent was originally granted. */
  sessionId?: string

  /**
   * Publisher fingerprint (sender_fingerprint) that this consent is bound to.
   * Absent = not publisher-scoped (more permissive; use with caution).
   */
  publisherFingerprint?: string
}

/**
 * A recorded consent decision made by the receiver for a specific processing event.
 *
 * Per A.3.055 Stage 6.2: receiver-side selection of an offered processing
 * option MUST be recorded as a distinct consent decision. This record is that
 * stored artifact.
 *
 * Consent records are NOT authoritative — the receiver's policy is authoritative.
 * Records are used to determine whether interactive re-consent is required, or
 * whether a prior matching record exists that permits processing without
 * a new interactive confirmation.
 */
export interface ConsentRecord {
  /** Stable unique ID for this consent record. Referenced in GatingArtefact. */
  consentId: string

  /**
   * When this consent was granted.
   * Unix timestamp (ms).
   */
  grantedAt: number

  /**
   * Optional expiry (Unix timestamp ms). Expired records are treated as absent.
   * Absent = no expiry (valid until explicitly revoked).
   */
  expiresAt?: number

  /** Whether this consent has been explicitly revoked. */
  revoked: boolean

  /**
   * The processing class this consent covers.
   * Semantic and actuating consents are INDEPENDENT — one does NOT imply the other.
   */
  processingClass: ProcessingEventClass

  /**
   * The declared processing boundary consented to.
   * A consent for LOCAL does NOT cover REMOTE — boundary must match or exceed.
   */
  boundary: ProcessingBoundary

  /**
   * The declared processing scope consented to.
   * A consent for MINIMAL does NOT cover SELECTED or FULL.
   */
  scope: ProcessingScope

  /** Binding context that scopes this consent record. */
  binding: ConsentBindingContext

  /**
   * Purpose identifier for this consent (e.g. 'inbox-semantic-summary').
   * Matched against CapabilityToken.purposeId for purpose-bound activation.
   * May be undefined for legacy/unscoped records.
   */
  purposeId?: string

  /**
   * Hardware attestation assurance level at the time of consent.
   * Required for PII/BUSINESS_CRITICAL data access (A.3.055 Stage 6.2.1).
   *
   * - 'hardware': hardware-attested environment verified
   * - 'software': software attestation only (insufficient for PII)
   * - 'none': no attestation
   */
  attestationLevel?: 'hardware' | 'software' | 'none'
}

/**
 * Consent status for a single processing class.
 */
export interface ClassConsentStatus {
  /**
   * Whether processing may proceed for this class based on consent state.
   * false = interactive consent is required before any processing occurs.
   */
  mayProceed: boolean

  /**
   * Whether interactive consent must be solicited from the user before
   * processing may commence. true = gate must pause and present consent UI.
   */
  requiresInteractiveConsent: boolean

  /**
   * The matched prior consent record that permits processing without
   * re-consent. null when no prior record matched.
   */
  matchedConsentRecord: ConsentRecord | null

  /**
   * Whether the matched record required hardware attestation and it was
   * present. null when no matching record or attestation not checked.
   */
  attestationSatisfied: boolean | null

  /** Consent/approval violations for this class. */
  violations: string[]
}

/**
 * Stage 6.2 consent resolution result for both processing classes.
 */
export interface ConsentResolutionResult {
  semantic: ClassConsentStatus
  actuating: ClassConsentStatus
}

/**
 * Attempt to find a prior consent record that matches the current gate context,
 * such that interactive re-consent is not required.
 *
 * Matching criteria (ALL must hold):
 *   1. Record is not revoked
 *   2. Record is not expired (expiresAt > now)
 *   3. processingClass matches
 *   4. boundary matches or record covers equal-or-higher boundary
 *   5. scope matches or record covers equal-or-higher scope
 *   6. provider IDs: all required provider IDs are in the record's binding
 *   7. If context.templateHash is set, record binding.templateHash matches
 *   8. If context.sessionId is set, record binding.sessionId matches
 *      (OR record has no session binding → applies across sessions)
 *   9. If context.publisherFingerprint is set, record binding.publisherFingerprint
 *      matches (OR record has no publisher binding → applies across publishers)
 */
function findMatchingConsentRecord(
  records: ConsentRecord[],
  processingClass: ProcessingEventClass,
  boundary: ProcessingBoundary,
  scope: ProcessingScope,
  requiredProviderIds: string[],
  context: GateContext | undefined
): ConsentRecord | null {
  const now = Date.now()
  const boundaryLevel: Record<ProcessingBoundary, number> = { NONE: 0, LOCAL: 1, REMOTE: 2 }
  const scopeLevel: Record<ProcessingScope, number> = { MINIMAL: 0, SELECTED: 1, FULL: 2 }

  for (const record of records) {
    if (record.revoked) continue
    if (record.expiresAt !== undefined && record.expiresAt <= now) continue
    if (record.processingClass !== processingClass) continue

    // Record must cover at least the required boundary and scope
    if (boundaryLevel[record.boundary] < boundaryLevel[boundary]) continue
    if (scopeLevel[record.scope] < scopeLevel[scope]) continue

    // All required provider IDs must be covered by the record binding
    const recordProviderSet = new Set(record.binding.providerIds)
    if (requiredProviderIds.some(id => !recordProviderSet.has(id))) continue

    // Template-hash binding: if record specifies, context must match
    if (record.binding.templateHash !== undefined) {
      if (!context || context.templateHash !== record.binding.templateHash) continue
    }

    // Session binding: if record specifies, context must match
    if (record.binding.sessionId !== undefined) {
      if (!context || context.sessionId !== record.binding.sessionId) continue
    }

    // Publisher binding: if record specifies, context must match
    if (record.binding.publisherFingerprint !== undefined) {
      if (!context || context.publisherFingerprint !== record.binding.publisherFingerprint) continue
    }

    return record
  }

  return null
}

/**
 * Resolve Stage 6.2 consent requirements for all processing classes implied
 * by the capsule.
 *
 * Per A.3.055 Stage 6.2:
 *   - NONE boundary → no consent needed (processing is prohibited anyway)
 *   - LOCAL boundary → MAY proceed within verified local enforcement boundary
 *     if receiver policy permits; no interactive consent required by default
 *     unless policy mandates it for the specific class
 *   - REMOTE boundary → MUST NOT execute unless:
 *       (a) interactive user consent action, OR
 *       (b) receiver-side policy rule explicitly permitting remote processing
 *           under declared constraints AND a matching prior consent record exists
 *   - Actuating events → MUST NOT execute without explicit authorization unless
 *     policy.allowUnattendedActuation is true
 *
 * Stage 6.2.1 (Purpose-Bound Activation):
 *   - PII/BUSINESS_CRITICAL data access requires hardware attestation
 *   - Processing without hardware attestation AND PII data = NOT PERMITTED
 *     regardless of consent
 *
 * @param impliedEvents  - All events derived from capsule content
 * @param offer          - Sender's declared ProcessingEventOffer
 * @param policy         - Receiver's capability policy including prior consent records
 * @param context        - Gate context for consent record matching
 * @returns Per-class consent resolution
 */
export function resolveConsentRequirements(
  impliedEvents: ImpliedProcessingEvent[],
  offer: ProcessingEventOffer | undefined | null,
  policy: ReceiverCapabilityPolicy,
  context: GateContext | undefined
): ConsentResolutionResult {
  const buildClassStatus = (
    cls: ProcessingEventClass
  ): ClassConsentStatus => {
    const eventsForClass = impliedEvents.filter(e => e.class === cls)

    // No implied events for this class → trivially permitted (nothing to do)
    if (eventsForClass.length === 0) {
      return {
        mayProceed: true,
        requiresInteractiveConsent: false,
        matchedConsentRecord: null,
        attestationSatisfied: null,
        violations: [],
      }
    }

    const decl = getDeclarationForClass(offer, cls)
    const violations: string[] = []

    // NONE boundary → processing is prohibited; consent is moot
    if (decl.boundary === 'NONE') {
      return {
        mayProceed: false,
        requiresInteractiveConsent: false,
        matchedConsentRecord: null,
        attestationSatisfied: null,
        violations: [],
      }
    }

    // Stage 6.2.1: Hardware attestation gate for PII/BUSINESS_CRITICAL
    const requiresAttestation = eventsForClass.some(
      e => e.dataClasses.includes('PII') || e.dataClasses.includes('BUSINESS_CRITICAL')
    )
    let attestationSatisfied: boolean | null = null
    if (requiresAttestation) {
      // Check if a prior consent record with hardware attestation exists for this class
      const attestedRecord = (policy.priorConsentRecords ?? []).find(
        r =>
          !r.revoked &&
          (r.expiresAt === undefined || r.expiresAt > Date.now()) &&
          r.processingClass === cls &&
          r.attestationLevel === 'hardware'
      )
      attestationSatisfied = attestedRecord !== undefined

      if (!attestationSatisfied) {
        violations.push(
          `STAGE_6.2.1 [ATTESTATION]: ${cls} event requires hardware-attested environment ` +
          `(data classes: [${eventsForClass.flatMap(e => e.dataClasses).join(', ')}]) ` +
          `but no valid hardware-attested consent record exists. Processing BLOCKED.`
        )
        return {
          mayProceed: false,
          requiresInteractiveConsent: true,
          matchedConsentRecord: null,
          attestationSatisfied: false,
          violations,
        }
      }
    }

    // LOCAL boundary: permitted if receiver policy allows this class locally
    if (decl.boundary === 'LOCAL') {
      const policyPermitsLocal =
        cls === 'semantic'
          ? (policy.allowSemanticProcessing === true)
          : (policy.allowActuatingProcessing === true || policy.allowUnattendedActuation === true)

      if (!policyPermitsLocal) {
        violations.push(
          `STAGE_6.2 [CONSENT]: ${cls} LOCAL processing is not permitted by receiver policy ` +
          `(allow${cls === 'semantic' ? 'Semantic' : 'Actuating'}Processing=false). ` +
          `Processing BLOCKED.`
        )
        return {
          mayProceed: false,
          requiresInteractiveConsent: true,
          matchedConsentRecord: null,
          attestationSatisfied,
          violations,
        }
      }

      // Actuating LOCAL requires explicit authorization unless unattended is permitted
      if (cls === 'actuating' && !policy.allowUnattendedActuation) {
        // Check for prior consent record covering actuating LOCAL
        const requiredProviderIds = (decl.providers ?? []).map(p => p.providerId)
        const matchedRecord = findMatchingConsentRecord(
          policy.priorConsentRecords ?? [],
          cls,
          decl.boundary,
          decl.scope,
          requiredProviderIds,
          context
        )
        if (!matchedRecord) {
          return {
            mayProceed: false,
            requiresInteractiveConsent: true,
            matchedConsentRecord: null,
            attestationSatisfied,
            violations: [],
          }
        }
        return {
          mayProceed: true,
          requiresInteractiveConsent: false,
          matchedConsentRecord: matchedRecord,
          attestationSatisfied,
          violations: [],
        }
      }

      return {
        mayProceed: true,
        requiresInteractiveConsent: false,
        matchedConsentRecord: null,
        attestationSatisfied,
        violations: [],
      }
    }

    // REMOTE boundary: requires explicit authorization
    // Check for a prior matching consent record
    const requiredProviderIds = (decl.providers ?? []).map(p => p.providerId)
    const matchedRecord = findMatchingConsentRecord(
      policy.priorConsentRecords ?? [],
      cls,
      decl.boundary,
      decl.scope,
      requiredProviderIds,
      context
    )

    if (matchedRecord) {
      return {
        mayProceed: true,
        requiresInteractiveConsent: false,
        matchedConsentRecord: matchedRecord,
        attestationSatisfied,
        violations: [],
      }
    }

    // No prior record: interactive consent required
    // This does NOT produce a gate violation — it means the caller must
    // solicit consent before dispatching. The gate records this as
    // requiresInteractiveConsent: true but does not BLOCK the decision.
    // HOWEVER: if the policy does not permit remote for this class at all,
    // it IS a violation.
    const policyPermitsRemote =
      cls === 'semantic'
        ? policy.allowSemanticProcessing === true
        : policy.allowActuatingProcessing === true

    if (!policyPermitsRemote) {
      violations.push(
        `STAGE_6.2 [CONSENT]: ${cls} REMOTE processing requires explicit authorization ` +
        `but receiver policy does not permit remote ${cls} processing and no prior consent record matches. ` +
        `Processing BLOCKED.`
      )
      return {
        mayProceed: false,
        requiresInteractiveConsent: true,
        matchedConsentRecord: null,
        attestationSatisfied,
        violations,
      }
    }

    // Policy permits remote but no prior record: pause for interactive consent
    return {
      mayProceed: false,
      requiresInteractiveConsent: true,
      matchedConsentRecord: null,
      attestationSatisfied,
      violations: [],
    }
  }

  return {
    semantic: buildClassStatus('semantic'),
    actuating: buildClassStatus('actuating'),
  }
}

// =============================================================================
// Stage 6.3: Gating Artefacts and Audit Trail (A.3.055 Stage 6.3 — Normative)
// =============================================================================

/**
 * A verifiable, tamper-evident commitment to the outcome of a Stage 6.1–6.2
 * gate evaluation for a single processing class.
 *
 * Per A.3.055 Stage 6.3, gating artefacts MUST commit to:
 *   - Processing Event class
 *   - effective policy fingerprint
 *   - enforced boundary and scope
 *   - provider identity (where applicable)
 *   - retention class
 *   - consent/approval artefact identifier (where applicable)
 *   - stable session/execution identifier
 *
 * Artefacts MUST be tamper-evident (via commitmentHash) and linkable to
 * PoAE™ records (via poaeRecordId).
 *
 * @encryptedInnerEnvelope — candidate for Gap 2 inner envelope migration.
 */
export interface GatingArtefact {
  /** Unique identifier for this artefact (UUID-like, generated per gate run). */
  artefactId: string

  /** Processing class this artefact covers. */
  processingClass: ProcessingEventClass

  /** Gate decision for this class. */
  decision: GateDecision

  /** Enforced processing boundary. */
  enforcedBoundary: ProcessingBoundary

  /** Enforced processing scope. */
  enforcedScope: ProcessingScope

  /** Enforced retention class. */
  enforcedRetention: string

  /**
   * Provider IDs that were authorized for this gate run.
   * Empty for NONE boundary or when no providers were declared.
   */
  authorizedProviderIds: string[]

  /**
   * Consent record ID that authorized this gate run.
   * Null when no prior consent record was matched (e.g. LOCAL without record).
   */
  consentRecordId: string | null

  /**
   * Stable session identifier binding this artefact to a session.
   * From GateContext.sessionId.
   */
  sessionId: string

  /**
   * Template hash of the capsule this artefact was generated for.
   * From GateContext.templateHash.
   */
  templateHash: string

  /**
   * Publisher fingerprint from the capsule envelope.
   * From GateContext.publisherFingerprint.
   */
  publisherFingerprint: string

  /**
   * PoAE record ID for full audit trail linkage.
   * Null when no PoAE record was associated with this gate run.
   */
  poaeRecordId: string | null

  /**
   * Unix timestamp (ms) when this artefact was generated.
   */
  generatedAt: number

  /**
   * Fingerprint of the effective receiver policy at the time of gate evaluation.
   * Computed as a stable hash of the serialized policy (boundary/scope/retention/
   * provider allowlists). Not the full policy — only governance-relevant fields.
   */
  policyFingerprint: string

  /**
   * SHA-256 commitment hash over the canonical serialization of this artefact's
   * governance fields (all fields except commitmentHash itself).
   * Provides tamper evidence: any modification of artefact fields invalidates
   * the hash.
   */
  commitmentHash: string
}

/**
 * Audit storage interface for persisting gating artefacts.
 *
 * Implementors may persist to IndexedDB, a remote audit log, or an
 * Electron vault store. The gate itself does not depend on persistence —
 * artefacts are returned in AuthorizedProcessingResult regardless.
 *
 * The interface is intentionally minimal: only persistence is required.
 * Querying is implementation-specific.
 */
export interface GatingAuditStore {
  /**
   * Persist one or more gating artefacts.
   * Called after each successful gate run (decision = AUTHORIZED).
   * Implementors MUST NOT throw — log errors internally and return.
   */
  persistGatingArtefacts(artefacts: GatingArtefact[]): Promise<void>
}

/**
 * Compute a stable policy fingerprint from governance-relevant fields of
 * the receiver capability policy.
 *
 * Only boundary/scope/retention/provider constraints are included — not tokens
 * or consent records (those are session-specific).
 */
async function computePolicyFingerprint(policy: ReceiverCapabilityPolicy): Promise<string> {
  const governanceFields = {
    allowSemanticProcessing: policy.allowSemanticProcessing ?? false,
    allowActuatingProcessing: policy.allowActuatingProcessing ?? false,
    maxSemanticBoundary: policy.maxSemanticBoundary ?? 'NONE',
    maxActuatingBoundary: policy.maxActuatingBoundary ?? 'NONE',
    maxSemanticRetention: policy.maxSemanticRetention ?? 'NONE',
    maxActuatingRetention: policy.maxActuatingRetention ?? 'NONE',
    allowedSemanticProviderIds: policy.allowedSemanticProviderIds
      ? Array.from(policy.allowedSemanticProviderIds).sort()
      : null,
    allowedActuatingProviderIds: policy.allowedActuatingProviderIds
      ? Array.from(policy.allowedActuatingProviderIds).sort()
      : null,
    allowUnattendedActuation: policy.allowUnattendedActuation ?? false,
  }
  const serialized = JSON.stringify(stableCanonicalize(governanceFields))
  return sha256String(serialized)
}

/**
 * Generate a stable artefact ID.
 * Uses crypto.randomUUID() when available; falls back to timestamp+random.
 */
function generateArtefactId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `artefact-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * Generate tamper-evident gating artefacts for all authorized processing
 * event classes in this gate run (A.3.055 Stage 6.3 — Normative).
 *
 * One artefact is generated per distinct processing class among authorizedEvents.
 * For a capsule with both semantic and actuating implied events that both
 * pass, two artefacts are generated.
 *
 * @param authorizedEvents  - Subset of implied events that passed all gate checks
 * @param offer             - Sender's declared ProcessingEventOffer
 * @param policy            - Receiver's capability policy
 * @param consentResolution - Stage 6.2 consent resolution result
 * @param context           - Gate context (session/template/publisher IDs)
 * @returns Array of tamper-evident GatingArtefact records (one per class)
 */
export async function generateGatingArtefacts(
  authorizedEvents: ImpliedProcessingEvent[],
  offer: ProcessingEventOffer | undefined | null,
  policy: ReceiverCapabilityPolicy,
  consentResolution: ConsentResolutionResult,
  context: GateContext
): Promise<GatingArtefact[]> {
  const classes = Array.from(
    new Set(authorizedEvents.map(e => e.class))
  ) as ProcessingEventClass[]

  const policyFingerprint = await computePolicyFingerprint(policy)
  const generatedAt = Date.now()
  const artefacts: GatingArtefact[] = []

  for (const cls of classes) {
    const decl = getDeclarationForClass(offer, cls)
    const consentStatus = cls === 'semantic' ? consentResolution.semantic : consentResolution.actuating

    const artefactId = generateArtefactId()
    const authorizedProviderIds = (decl.providers ?? []).map(p => p.providerId)
    const enforcedRetention = decl.retention ?? 'NONE'
    const consentRecordId = consentStatus.matchedConsentRecord?.consentId ?? null

    // Governance fields that are committed to by the hash
    const commitmentFields = {
      artefactId,
      processingClass: cls,
      decision: 'AUTHORIZED' as GateDecision,
      enforcedBoundary: decl.boundary,
      enforcedScope: decl.scope,
      enforcedRetention,
      authorizedProviderIds: authorizedProviderIds.slice().sort(),
      consentRecordId,
      sessionId: context.sessionId,
      templateHash: context.templateHash,
      publisherFingerprint: context.publisherFingerprint,
      poaeRecordId: context.poaeRecordId ?? null,
      generatedAt,
      policyFingerprint,
    }

    const commitmentHash = await sha256String(
      JSON.stringify(stableCanonicalize(commitmentFields))
    )

    artefacts.push({
      ...commitmentFields,
      commitmentHash,
    })
  }

  return artefacts
}



/**
 * Gate context: stable identifiers that bind a gate run to a specific
 * capsule/session, required for PoAE™ linkage and audit traceability.
 */
export interface GateContext {
  /**
   * Stable session identifier for the current receiver session.
   * Used as the `sessionId` field in GatingArtefact.
   */
  sessionId: string

  /**
   * Template hash of the capsule (from BeapEnvelopeHeader.template_hash).
   * Binds consent checks and gating artefacts to the specific capsule template.
   */
  templateHash: string

  /**
   * Publisher fingerprint (sender_fingerprint from the envelope header).
   * Used for consent record matching and artefact commitment.
   */
  publisherFingerprint: string

  /**
   * Optional: PoAE record ID to link this gate run to a Proof of Artefact
   * Existence record for full audit trail linkage.
   */
  poaeRecordId?: string
}

/**
 * Run the full Stage 6.1–6.3 Processing Event Gate pipeline (A.3.055 — Normative).
 *
 * Must be called AFTER successful Capsule depackaging and BEFORE any
 * semantic processing, actuation, or data access.
 *
 * Pipeline steps:
 *   1. Extract implied events from capsule content
 *   2. Align implied events with sender's declarations → fail closed on mismatch
 *   3. Evaluate Capability Tokens → fail closed on missing coverage
 *   4. Evaluate boundary/scope/provider/retention gate → fail closed on violation
 *   5. Resolve consent requirements per class → fail closed for REMOTE without consent
 *   6. Generate tamper-evident gating artefacts for authorized events
 *
 * If any step produces violations, `decision = 'BLOCKED'` and
 * `authorizedEvents = []`. No processing SHALL occur.
 *
 * @param capsule   - Decrypted capsule payload
 * @param artefacts - Decrypted artefacts associated with this capsule
 * @param offer     - Sender's ProcessingEventOffer from the envelope header
 * @param policy    - Receiver's capability policy (base + optional tokens + consent records)
 * @param context   - Stable gate context (session/template/publisher IDs)
 * @returns AuthorizedProcessingResult with top-level decision and full audit trail
 */
export async function runStage61Gate(
  capsule: DecryptedCapsulePayload,
  artefacts: DecryptedArtefact[],
  offer: ProcessingEventOffer | undefined | null,
  policy: ReceiverCapabilityPolicy = DEFAULT_CAPABILITY_POLICY,
  context?: GateContext
): Promise<AuthorizedProcessingResult> {
  // Step 1: Extract implied events from capsule content
  const impliedEvents = extractImpliedEvents(capsule, artefacts)

  // Step 2: Declaration alignment
  const alignmentViolations = alignImpliedWithDeclarations(impliedEvents, offer)

  // Step 3: Capability token evaluation
  const { capabilityViolations, authorizedTokenIds } = evaluateCapabilityTokens(
    impliedEvents,
    policy.capabilityTokens
  )

  // Step 4: Boundary/scope/provider/retention gate (existing engine)
  const processingGate = evaluateProcessingEventGate(offer, policy)

  // Step 5: Consent resolution (Stage 6.2)
  const consentResolution = resolveConsentRequirements(impliedEvents, offer, policy, context)
  const consentViolations = [
    ...consentResolution.semantic.violations,
    ...consentResolution.actuating.violations,
  ]

  // Aggregate all violation sources
  const allViolations = [
    ...alignmentViolations,
    ...capabilityViolations,
    ...processingGate.violations,
    ...consentViolations,
  ]

  const decision: GateDecision = allViolations.length === 0 ? 'AUTHORIZED' : 'BLOCKED'

  // Resolve which implied events are authorized vs blocked
  const blockedReasons = new Set<string>()
  for (const v of [...alignmentViolations, ...capabilityViolations, ...consentViolations]) {
    const match = v.match(/reason='([^']+)'/)
    if (match) blockedReasons.add(match[1])
  }

  let authorizedEvents: ImpliedProcessingEvent[]
  let blockedEvents: ImpliedProcessingEvent[]

  if (decision === 'BLOCKED') {
    authorizedEvents = []
    blockedEvents = [...impliedEvents]
  } else {
    authorizedEvents = impliedEvents.filter(e => !blockedReasons.has(e.reason))
    blockedEvents = impliedEvents.filter(e => blockedReasons.has(e.reason))
  }

  // Step 6: Generate gating artefacts for authorized events (Stage 6.3)
  let gatingArtefacts: GatingArtefact[] = []
  if (decision === 'AUTHORIZED' && context) {
    gatingArtefacts = await generateGatingArtefacts(
      authorizedEvents,
      offer,
      policy,
      consentResolution,
      context
    )
    // Forward to audit store if configured
    if (policy.auditStore && gatingArtefacts.length > 0) {
      await policy.auditStore.persistGatingArtefacts(gatingArtefacts)
    }
  }

  return {
    decision,
    processingGate,
    impliedEvents,
    authorizedEvents,
    blockedEvents,
    alignmentViolations,
    capabilityViolations,
    authorizedTokenIds: decision === 'AUTHORIZED' ? authorizedTokenIds : [],
    consentResolution,
    consentViolations,
    gatingArtefacts,
  }
}
