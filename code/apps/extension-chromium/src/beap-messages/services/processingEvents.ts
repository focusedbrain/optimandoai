/**
 * BEAP™ Processing Event Policy Model
 *
 * Implements A.3.054.9.1 (Normative): Processing Event declaration schema.
 * Implements A.3.054.10.1 (Normative): Provider binding and retention.
 *
 * A Processing Event is any operation that:
 *   (a) transforms Capsule-bound content into derived representations for
 *       semantic analysis (embeddings, LLM inference, RAG, summarisation,
 *       OCR-to-indexing), OR
 *   (b) produces system-level or external effects (automation/actuation).
 *
 * GOVERNANCE RULE (A.3.054.9.1):
 *   All declarations are SENDER-REQUESTED INTENT ONLY.
 *   They SHALL NOT be execution-authoritative and SHALL NOT override
 *   receiver-side policy. Effective permission is determined exclusively
 *   by the receiver's own policy evaluation at processing time.
 *
 * DEFAULT RULE (A.3.054.14.1):
 *   Absence of a declaration for any class is canonically equivalent to
 *   declaring boundary=NONE for that class. No implicit processing by omission.
 *
 * PROVIDER BINDING RULE (A.3.054.10.1):
 *   Where any Semantic Processing Event is declared as permitted, ALL processing
 *   providers MUST be declared by explicit provider identity. If provider identity
 *   cannot be expressed deterministically, the boundary MUST be NONE.
 *
 * SCOPE BOUNDARY NOTE (A.3.054.10.1):
 *   A REMOTE declaration defines only the permitted execution scope.
 *   It does NOT assert or guarantee provider-side data handling properties.
 *   Those are governed by separate contractual agreements.
 *
 * PLACEMENT NOTE:
 *   Provider declarations currently travel in the unencrypted outer envelope
 *   header (AAD-bound for tamper detection). They are annotated
 *   @encryptedInnerEnvelope as candidates for migration to the encrypted inner
 *   envelope in Gap 2 (inner/outer envelope split). The AAD binding already
 *   provides tamper evidence — any modification of declared providers fails
 *   AEAD authentication at decryption time.
 *
 * @version 2.0.0
 */

// =============================================================================
// Core Enumerations (Normative per A.3.054.9.1)
// =============================================================================

/**
 * The two independently gated classes of processing events.
 *
 * 'semantic'  — transforms Capsule-bound content into derived representations
 *               without producing external effects (embeddings, LLM inference,
 *               RAG lookups, summarisation, OCR-to-indexing).
 *
 * 'actuating' — produces system-level or external effects (automation,
 *               state changes, external API calls, file writes).
 */
export type ProcessingEventClass = 'semantic' | 'actuating'

/**
 * Boundary declaration: where processing is permitted to occur.
 *
 * 'NONE'   — processing is prohibited for this class.
 * 'LOCAL'  — processing is permitted only within the receiver's verified
 *             local enforcement boundary (on-device, no external transmission).
 * 'REMOTE' — processing is permitted at explicitly authorized remote providers.
 *             Requires at least one entry in providers[].
 */
export type ProcessingBoundary = 'NONE' | 'LOCAL' | 'REMOTE'

/**
 * Scope declaration: how much Capsule-bound content may be consumed.
 *
 * 'MINIMAL'  — only the smallest excerpts necessary for the declared purpose.
 * 'SELECTED' — explicitly enumerated artefacts only (see selectedArtefactRefs).
 * 'FULL'     — the entire Capsule-bound canonical content.
 *
 * Scope is ignored when boundary is 'NONE'.
 */
export type ProcessingScope = 'MINIMAL' | 'SELECTED' | 'FULL'

/**
 * Retention declaration: how long derived representations may be retained.
 *
 * 'NONE'       — no retention; derived state must be discarded immediately
 *                after the processing operation completes (DEFAULT).
 * 'SESSION'    — retained only for the duration of the current session;
 *                must be discarded when the session ends.
 * 'PERSISTENT' — may be retained persistently; receiver policy governs
 *                actual retention period.
 *
 * Default when omitted: 'NONE' (most restrictive).
 * Required (and SHOULD be explicit) when boundary is 'REMOTE'.
 */
export type ProcessingRetention = 'NONE' | 'SESSION' | 'PERSISTENT'

// =============================================================================
// Provider Identity (Normative per A.3.054.10.1)
// =============================================================================

/**
 * Explicit, deterministic, immutable identity for a processing provider.
 *
 * Per A.3.054.10.1: ALL processing providers MUST be declared by explicit
 * provider identity where any Semantic Processing Event is permitted.
 * If provider identity cannot be expressed deterministically, the boundary
 * MUST be declared as NONE.
 *
 * @encryptedInnerEnvelope — candidate for migration to the encrypted inner
 * envelope in Gap 2. Currently travels in the AAD-bound outer header.
 */
export interface ProcessingProvider {
  /**
   * Human-readable provider name.
   * Example: "WR Desk Local LLM", "Anthropic Claude"
   */
  name: string

  /**
   * Immutable, globally unique provider identifier.
   * Format: reverse-DNS, e.g. "com.wrdesk.local.llm" or
   *         "com.anthropic.claude-3-7-sonnet-20250219".
   * MUST be deterministic and stable across package versions.
   */
  providerId: string
}

// =============================================================================
// Declaration Schema (A.3.054.9.1 + A.3.054.10.1)
// =============================================================================

/**
 * A single Processing Event declaration for one class.
 *
 * Per A.3.054.9.1: each class is independently declared. Omitting a class
 * is canonically equivalent to boundary='NONE' for that class.
 *
 * Per A.3.054.10.1: providers[] MUST be non-empty when boundary is LOCAL
 * or REMOTE. If provider identity cannot be expressed deterministically,
 * the builder MUST downgrade boundary to NONE (fail-closed).
 */
export interface ProcessingEventDeclaration {
  /** Which class of processing this declaration governs */
  class: ProcessingEventClass

  /**
   * Where processing is permitted.
   * When 'NONE': providers[] must be absent or empty.
   * When 'LOCAL' or 'REMOTE': providers[] MUST be non-empty.
   */
  boundary: ProcessingBoundary

  /**
   * How much content may be consumed.
   * Required (explicitly) when boundary is 'LOCAL' or 'REMOTE'.
   * Ignored (and SHOULD be 'MINIMAL') when boundary is 'NONE'.
   */
  scope: ProcessingScope

  /**
   * Explicit provider identities for all processing that will occur.
   *
   * Per A.3.054.10.1 (Normative):
   * - MUST be non-empty when boundary is 'LOCAL' or 'REMOTE'.
   * - MUST be absent or empty when boundary is 'NONE'.
   * - If this cannot be populated deterministically, boundary MUST be NONE.
   *
   * Multiple providers may be listed (e.g., primary + fallback).
   * Each entry must have a unique, non-empty providerId.
   *
   * @encryptedInnerEnvelope — candidate for Gap 2 inner envelope migration.
   */
  providers?: ProcessingProvider[]

  /**
   * How long derived representations may be retained.
   *
   * Per A.3.054.10.1:
   * - Default: 'NONE' (most restrictive, no storage beyond transient execution).
   * - Required (SHOULD be explicit) when boundary is 'REMOTE'.
   * - Ignored when boundary is 'NONE'.
   *
   * SCOPE BOUNDARY (A.3.054.10.1): retention declaration defines only the
   * sender-requested intent. It does NOT assert or guarantee provider-side
   * data handling. Those properties are governed by separate contractual
   * agreements with the named providers.
   */
  retention?: ProcessingRetention

  /**
   * Human-readable description of the processing purpose.
   * Informational only; not governance-authoritative.
   */
  description?: string

  /**
   * When scope is 'SELECTED': explicit list of artefact refs that may be
   * consumed. MUST be non-empty when scope is 'SELECTED'.
   * Ignored for other scope values.
   */
  selectedArtefactRefs?: string[]

  /**
   * Sender requests that the receiver generate and return a PoAE-R log
   * (A.3.055 Stage 7) if execution occurs under this declaration.
   *
   * This is a REQUEST ONLY — per A.3.055 Stage 7:
   *   - The request SHALL NOT mandate execution or disclosure.
   *   - The receiver's policy governs whether a log is generated/returned.
   *   - Absence/delay/non-return SHALL NOT be interpreted as a processing outcome.
   *
   * Default: false (no PoAE-R log requested).
   */
  returnPoaeLog?: boolean
}

/**
 * The full Processing Event offer embedded in the Envelope header.
 *
 * Contains one declaration per class (semantic, actuating).
 * Missing classes are implicitly NONE (A.3.054.14.1).
 *
 * Governance metadata — travels in the Envelope header (unencrypted outer
 * layer, AAD-bound) so receivers can evaluate the offer before deciding
 * whether to accept the package. Tamper-evident via AEAD AAD binding.
 */
export interface ProcessingEventOffer {
  /**
   * Schema version for forward compatibility.
   * Must be '1.0' for this implementation.
   */
  schemaVersion: '1.0'

  /**
   * Per-class declarations. At most one entry per class.
   * Order is not significant; duplicate classes are a validation error.
   */
  declarations: ProcessingEventDeclaration[]

  /**
   * Canonical statement that these are sender-requested intents only.
   * Hard-coded to true; present for auditability.
   */
  senderIntentOnly: true

  /**
   * Optional consent-selectable offer set (per A.3.054.14.1).
   *
   * A finite list of processing options the receiver MAY present to the user
   * during a consent or approval flow. Presence of an offer set MUST NOT
   * trigger any processing — selection of an offer by the receiver is a
   * distinct, explicit consent decision.
   *
   * When present, the effective default compiles to NONE unless one entry
   * has isDefault: true. That default is a REQUESTED PREFERENCE ONLY and
   * MUST be confirmed by explicit receiver-side consent before any
   * processing occurs.
   */
  offerSet?: ConsentSelectableOfferSet
}

// =============================================================================
// Consent-Selectable Offer Set (A.3.054.14.1 — Normative)
// =============================================================================

/**
 * A single option within a consent-selectable offer set.
 *
 * Each option presents one concrete ProcessingEventDeclaration that the
 * receiver may choose to consent to. Options must be self-contained:
 * the declaration fully specifies boundary, scope, providers, and retention.
 *
 * Per A.3.054.14.1:
 * - Offer presence MUST NOT trigger processing.
 * - Selection of an option MUST be recorded as a distinct consent decision.
 * - Consent MUST NOT be inferred from Capsule presence alone.
 */
export interface ConsentSelectableOffer {
  /**
   * Stable, unique identifier for this option within the offer set.
   * Used by the receiver to record which option was consented to.
   * Format: short slug, e.g. "local-summary" or "remote-index-session".
   */
  id: string

  /**
   * The concrete processing declaration this option represents.
   * Must pass individual declaration validation (boundary/scope/providers/retention).
   */
  declaration: ProcessingEventDeclaration

  /**
   * Whether the sender requests this as the preferred default option.
   *
   * At most one entry in the set may have isDefault: true.
   * This is a REQUESTED PREFERENCE ONLY — it MUST NOT be treated as
   * implicit consent. The receiver must still obtain explicit confirmation
   * before activating any processing under this option.
   */
  isDefault: boolean

  /**
   * Human-readable label for display in the receiver's consent UI.
   * Informational only; not governance-authoritative.
   * Example: "Local summarisation only (on-device)"
   */
  label?: string

  /**
   * Extended description for the receiver's consent UI.
   * Informational only.
   */
  description?: string
}

/**
 * A finite, ordered list of consent-selectable processing options.
 *
 * Per A.3.054.14.1 (Normative):
 * - Offer set MUST be a finite list of explicitly enumerated options.
 * - Effective default MUST be NONE unless an explicit isDefault: true entry
 *   exists; even then that default is a requested preference, not consent.
 * - Embedding generation, background indexing, prefetch semantic analysis,
 *   or remote inference MUST NOT occur implicitly as part of build, packaging,
 *   or transport emission.
 * - All such operations remain independently gated by receiver-side policy
 *   and explicit consent.
 * - Receiver-side selection MUST be recorded as a distinct consent decision.
 * - Consent MUST NOT be inferred from Capsule presence alone.
 *
 * @encryptedInnerEnvelope — candidate for Gap 2 inner envelope migration.
 */
export type ConsentSelectableOfferSet = ConsentSelectableOffer[]

// =============================================================================
// Validation Errors
// =============================================================================

/**
 * A typed validation failure for a processing event declaration.
 */
export interface ProcessingEventValidationError {
  /** Which declaration index produced the error (0-based) */
  declarationIndex: number
  /** Machine-readable error code */
  code:
    | 'INVALID_CLASS'
    | 'INVALID_BOUNDARY'
    | 'INVALID_SCOPE'
    | 'INVALID_RETENTION'
    | 'LOCAL_REQUIRES_PROVIDERS'
    | 'REMOTE_REQUIRES_PROVIDERS'
    | 'NONE_MUST_HAVE_NO_PROVIDERS'
    | 'PROVIDER_MISSING_NAME'
    | 'PROVIDER_MISSING_ID'
    | 'PROVIDER_EMPTY_ID'
    | 'PROVIDER_DUPLICATE_ID'
    | 'SELECTED_SCOPE_REQUIRES_REFS'
    | 'DUPLICATE_CLASS'
    | 'REMOTE_MISSING_RETENTION'
    | 'OFFER_EMPTY_ID'
    | 'OFFER_DUPLICATE_ID'
    | 'OFFER_MULTIPLE_DEFAULTS'
    | 'OFFER_INVALID_DECLARATION'
  /** Human-readable description */
  message: string
}

// =============================================================================
// Validation (Fail-Closed)
// =============================================================================

const VALID_CLASSES = new Set<string>(['semantic', 'actuating'])
const VALID_BOUNDARIES = new Set<string>(['NONE', 'LOCAL', 'REMOTE'])
const VALID_SCOPES = new Set<string>(['MINIMAL', 'SELECTED', 'FULL'])
const VALID_RETENTIONS = new Set<string>(['NONE', 'SESSION', 'PERSISTENT'])

/**
 * Validate a single ProcessingProvider entry.
 * Returns an array of error objects (declarationIndex pre-filled by caller).
 */
function validateProvider(
  provider: ProcessingProvider,
  providerIndex: number,
  declarationIndex: number,
  allProviderIds: Set<string>
): ProcessingEventValidationError[] {
  const errors: ProcessingEventValidationError[] = []

  if (!provider.name || typeof provider.name !== 'string' || provider.name.trim().length === 0) {
    errors.push({
      declarationIndex,
      code: 'PROVIDER_MISSING_NAME',
      message: `Declaration[${declarationIndex}].providers[${providerIndex}]: name must be a non-empty string`
    })
  }

  if (!provider.providerId || typeof provider.providerId !== 'string') {
    errors.push({
      declarationIndex,
      code: 'PROVIDER_MISSING_ID',
      message: `Declaration[${declarationIndex}].providers[${providerIndex}]: providerId must be a non-empty string`
    })
  } else if (provider.providerId.trim().length === 0) {
    errors.push({
      declarationIndex,
      code: 'PROVIDER_EMPTY_ID',
      message: `Declaration[${declarationIndex}].providers[${providerIndex}]: providerId must not be whitespace-only`
    })
  } else if (allProviderIds.has(provider.providerId)) {
    errors.push({
      declarationIndex,
      code: 'PROVIDER_DUPLICATE_ID',
      message: `Declaration[${declarationIndex}].providers[${providerIndex}]: providerId '${provider.providerId}' is duplicated within this declaration`
    })
  } else {
    allProviderIds.add(provider.providerId)
  }

  return errors
}

/**
 * Validate a ProcessingEventOffer.
 *
 * Returns an array of validation errors. An empty array means the offer is
 * valid. Fail-closed: any structural ambiguity is treated as an error rather
 * than silently normalised.
 *
 * @param offer - The offer to validate
 * @returns Array of errors (empty = valid)
 */
export function validateProcessingEventOffer(
  offer: ProcessingEventOffer
): ProcessingEventValidationError[] {
  const errors: ProcessingEventValidationError[] = []

  if (!offer || typeof offer !== 'object') {
    errors.push({
      declarationIndex: -1,
      code: 'INVALID_CLASS',
      message: 'ProcessingEventOffer must be a non-null object'
    })
    return errors
  }

  if (!Array.isArray(offer.declarations)) {
    errors.push({
      declarationIndex: -1,
      code: 'INVALID_CLASS',
      message: 'ProcessingEventOffer.declarations must be an array'
    })
    return errors
  }

  const seenClasses = new Map<string, number>()

  for (let i = 0; i < offer.declarations.length; i++) {
    const decl = offer.declarations[i]

    // ── Class ──────────────────────────────────────────────────────────────
    if (!VALID_CLASSES.has(decl.class)) {
      errors.push({
        declarationIndex: i,
        code: 'INVALID_CLASS',
        message: `Declaration[${i}].class must be 'semantic' or 'actuating', got: ${JSON.stringify(decl.class)}`
      })
    } else {
      if (seenClasses.has(decl.class)) {
        errors.push({
          declarationIndex: i,
          code: 'DUPLICATE_CLASS',
          message: `Declaration[${i}]: class '${decl.class}' declared more than once (first at index ${seenClasses.get(decl.class)})`
        })
      } else {
        seenClasses.set(decl.class, i)
      }
    }

    // ── Boundary ───────────────────────────────────────────────────────────
    if (!VALID_BOUNDARIES.has(decl.boundary)) {
      errors.push({
        declarationIndex: i,
        code: 'INVALID_BOUNDARY',
        message: `Declaration[${i}].boundary must be 'NONE', 'LOCAL', or 'REMOTE', got: ${JSON.stringify(decl.boundary)}`
      })
    }

    // ── Scope ──────────────────────────────────────────────────────────────
    if (!VALID_SCOPES.has(decl.scope)) {
      errors.push({
        declarationIndex: i,
        code: 'INVALID_SCOPE',
        message: `Declaration[${i}].scope must be 'MINIMAL', 'SELECTED', or 'FULL', got: ${JSON.stringify(decl.scope)}`
      })
    }

    // ── Retention ──────────────────────────────────────────────────────────
    if (decl.retention !== undefined && !VALID_RETENTIONS.has(decl.retention)) {
      errors.push({
        declarationIndex: i,
        code: 'INVALID_RETENTION',
        message: `Declaration[${i}].retention must be 'NONE', 'SESSION', or 'PERSISTENT', got: ${JSON.stringify(decl.retention)}`
      })
    }

    const boundaryValid = VALID_BOUNDARIES.has(decl.boundary)
    const scopeValid = VALID_SCOPES.has(decl.scope)
    const hasProviders = Array.isArray(decl.providers) && decl.providers.length > 0

    if (boundaryValid) {
      if (decl.boundary === 'NONE') {
        // NONE: providers MUST be absent or empty
        if (hasProviders) {
          errors.push({
            declarationIndex: i,
            code: 'NONE_MUST_HAVE_NO_PROVIDERS',
            message: `Declaration[${i}]: boundary='NONE' requires providers to be absent or empty`
          })
        }
      } else {
        // LOCAL or REMOTE: providers[] MUST be non-empty
        // Per A.3.054.10.1: if providers cannot be listed deterministically,
        // boundary MUST be NONE. The builder enforces this by failing closed.
        if (!hasProviders) {
          const code = decl.boundary === 'LOCAL'
            ? 'LOCAL_REQUIRES_PROVIDERS'
            : 'REMOTE_REQUIRES_PROVIDERS'
          errors.push({
            declarationIndex: i,
            code,
            message:
              `Declaration[${i}]: boundary='${decl.boundary}' requires at least one entry in providers[]. ` +
              `If provider identity cannot be expressed deterministically, boundary MUST be 'NONE' (A.3.054.10.1).`
          })
        } else {
          // Validate each provider entry
          const seenProviderIds = new Set<string>()
          for (let p = 0; p < decl.providers!.length; p++) {
            const provErrors = validateProvider(decl.providers![p], p, i, seenProviderIds)
            errors.push(...provErrors)
          }
        }

        // REMOTE: retention SHOULD be explicit; warn via a typed error
        // We treat omission as NONE (most restrictive default) but flag it.
        if (decl.boundary === 'REMOTE' && decl.retention === undefined) {
          errors.push({
            declarationIndex: i,
            code: 'REMOTE_MISSING_RETENTION',
            message:
              `Declaration[${i}]: boundary='REMOTE' SHOULD declare retention explicitly. ` +
              `Defaulting to 'NONE' (no retention). Add retention: 'NONE' to silence this warning.`
          })
        }
      }
    }

    // ── Scope cross-field: SELECTED requires refs ──────────────────────────
    if (boundaryValid && scopeValid && decl.boundary !== 'NONE') {
      if (decl.scope === 'SELECTED') {
        if (
          !Array.isArray(decl.selectedArtefactRefs) ||
          decl.selectedArtefactRefs.length === 0
        ) {
          errors.push({
            declarationIndex: i,
            code: 'SELECTED_SCOPE_REQUIRES_REFS',
            message: `Declaration[${i}]: scope='SELECTED' requires a non-empty selectedArtefactRefs array`
          })
        }
      }
    }
  }

  return errors
}

// =============================================================================
// Builder Coercion (Fail-Closed Normalisation)
// =============================================================================

/**
 * Coerce a declaration to NONE if it cannot satisfy provider binding rules.
 *
 * Per A.3.054.10.1: if boundary is LOCAL or REMOTE but providers[] is empty
 * or missing, the builder MUST set boundary to NONE (fail-closed). This
 * function materialises that rule as a pure transformation, preserving the
 * original intent in the description for auditability.
 *
 * @param decl - Input declaration (may be mutated boundary)
 * @returns Normalised declaration with corrected boundary
 */
export function coerceDeclarationToNoneIfUnboundable(
  decl: ProcessingEventDeclaration
): ProcessingEventDeclaration {
  if (decl.boundary === 'NONE') return decl

  const hasProviders = Array.isArray(decl.providers) && decl.providers.length > 0
  if (hasProviders) return decl

  // Cannot express provider identity deterministically → downgrade to NONE
  return {
    class: decl.class,
    boundary: 'NONE',
    scope: 'MINIMAL',
    providers: undefined,
    retention: 'NONE',
    description:
      `[DOWNGRADED TO NONE] Original boundary='${decl.boundary}' could not be satisfied: ` +
      `no providers declared. Per A.3.054.10.1, boundary set to NONE.` +
      (decl.description ? ` Original description: ${decl.description}` : '')
  }
}

// =============================================================================
// Offer Set Validation (A.3.054.14.1 — Normative)
// =============================================================================

/**
 * Validates a ConsentSelectableOfferSet.
 *
 * Rules (per A.3.054.14.1):
 * - Each option must have a non-empty, unique id.
 * - At most one option may have isDefault: true.
 * - Each option's declaration must individually pass validateProcessingEventOffer
 *   (wrapped as a single-declaration offer for reuse of existing logic).
 *
 * Returns an array of errors; empty array means valid.
 *
 * NOTE: Offer set validation is purely structural. It does NOT imply consent.
 * The receiver must independently gate any processing behind explicit confirmation.
 */
export function validateOfferSet(
  offerSet: ConsentSelectableOfferSet
): ProcessingEventValidationError[] {
  const errors: ProcessingEventValidationError[] = []
  const seenIds = new Set<string>()
  let defaultCount = 0

  for (let i = 0; i < offerSet.length; i++) {
    const offer = offerSet[i]

    // Each option gets declarationIndex = i for traceability
    const offerIndex = i

    if (!offer.id || offer.id.trim() === '') {
      errors.push({
        declarationIndex: offerIndex,
        code: 'OFFER_EMPTY_ID',
        message: `Offer at index ${offerIndex} has an empty id. Each offer must have a stable, non-empty unique id.`,
      })
    } else if (seenIds.has(offer.id)) {
      errors.push({
        declarationIndex: offerIndex,
        code: 'OFFER_DUPLICATE_ID',
        message: `Offer id '${offer.id}' appears more than once. Offer ids must be unique within the set.`,
      })
    } else {
      seenIds.add(offer.id)
    }

    if (offer.isDefault) {
      defaultCount++
    }

    // Validate the embedded declaration by wrapping it in a minimal offer
    const wrappedOffer: ProcessingEventOffer = {
      schemaVersion: '1.0',
      declarations: [offer.declaration],
      senderIntentOnly: true,
    }
    const declarationErrors = validateProcessingEventOffer(wrappedOffer)
    for (const declError of declarationErrors) {
      errors.push({
        declarationIndex: offerIndex,
        code: 'OFFER_INVALID_DECLARATION',
        message: `Offer '${offer.id || `[index ${offerIndex}]`}' contains an invalid declaration: [${declError.code}] ${declError.message}`,
      })
    }
  }

  if (defaultCount > 1) {
    errors.push({
      declarationIndex: -1,
      code: 'OFFER_MULTIPLE_DEFAULTS',
      message: `Offer set has ${defaultCount} entries with isDefault: true. At most one entry may be the default. The default is a requested preference only and MUST NOT be treated as implicit consent.`,
    })
  }

  return errors
}

// =============================================================================
// Factory Helpers
// =============================================================================

/**
 * Build the canonical NONE-for-all offer.
 *
 * The fail-closed default: no processing permitted for any class.
 * Used when a sender does not specify processingEvents at all.
 *
 * Per A.3.054.14.1: absence = NONE for that class.
 * This function materialises absence explicitly for auditability.
 */
export function buildDefaultProcessingOffer(): ProcessingEventOffer {
  return {
    schemaVersion: '1.0',
    declarations: [
      {
        class: 'semantic',
        boundary: 'NONE',
        scope: 'MINIMAL',
        providers: undefined,
        retention: 'NONE',
        description: 'Default: no semantic processing permitted (A.3.054.14.1)'
      },
      {
        class: 'actuating',
        boundary: 'NONE',
        scope: 'MINIMAL',
        providers: undefined,
        retention: 'NONE',
        description: 'Default: no actuating processing permitted (A.3.054.14.1)'
      }
    ],
    senderIntentOnly: true
  }
}

/**
 * Build a LOCAL semantic-only offer.
 *
 * Convenience factory for the most common AI inbox use case:
 * local LLM inference (summarisation, sorting, draft generation) with
 * no external transmission, session-only retention, actuating NONE.
 *
 * @param providers - Explicit local provider identities (MUST be non-empty)
 * @param scope - How much content the provider may consume
 * @param description - Human-readable purpose statement
 */
export function buildLocalSemanticOffer(
  providers: ProcessingProvider[],
  scope: ProcessingScope = 'MINIMAL',
  description = 'Local AI processing (on-device, session-only, no external transmission)'
): ProcessingEventOffer {
  if (!providers || providers.length === 0) {
    // Fail-closed per A.3.054.10.1: no deterministic provider → NONE
    return buildDefaultProcessingOffer()
  }

  return {
    schemaVersion: '1.0',
    declarations: [
      {
        class: 'semantic',
        boundary: 'LOCAL',
        scope,
        providers,
        retention: 'SESSION',
        description
      },
      {
        class: 'actuating',
        boundary: 'NONE',
        scope: 'MINIMAL',
        providers: undefined,
        retention: 'NONE',
        description: 'Actuating processing prohibited'
      }
    ],
    senderIntentOnly: true
  }
}

/**
 * Build a REMOTE semantic offer for an explicitly authorized provider.
 *
 * Use when the receiver is expected to forward content to a named remote
 * AI provider (e.g., a cloud API). Requires an explicit retention declaration.
 *
 * Per A.3.054.10.1 scope boundary note: this defines only permitted execution
 * scope. It does NOT assert or guarantee provider-side data handling properties.
 *
 * @param providers - Explicit remote provider identities (MUST be non-empty)
 * @param retention - How long derived representations may be retained
 * @param scope - How much content the provider may consume
 * @param description - Human-readable purpose statement
 */
export function buildRemoteSemanticOffer(
  providers: ProcessingProvider[],
  retention: ProcessingRetention = 'NONE',
  scope: ProcessingScope = 'MINIMAL',
  description = 'Remote AI processing at explicitly authorized provider'
): ProcessingEventOffer {
  if (!providers || providers.length === 0) {
    // Fail-closed per A.3.054.10.1
    return buildDefaultProcessingOffer()
  }

  return {
    schemaVersion: '1.0',
    declarations: [
      {
        class: 'semantic',
        boundary: 'REMOTE',
        scope,
        providers,
        retention,
        description
      },
      {
        class: 'actuating',
        boundary: 'NONE',
        scope: 'MINIMAL',
        providers: undefined,
        retention: 'NONE',
        description: 'Actuating processing prohibited'
      }
    ],
    senderIntentOnly: true
  }
}

/**
 * Merge partial sender declarations with canonical NONE defaults.
 *
 * Any class not covered by the provided declarations is filled in as NONE,
 * per A.3.054.14.1. The result is always a fully-specified two-class offer.
 *
 * Each declaration is run through coerceDeclarationToNoneIfUnboundable()
 * before merging, so undeclared providers cause a silent NONE downgrade
 * rather than a later validation error.
 *
 * @param declarations - Partial declarations from sender config
 * @returns Fully-specified ProcessingEventOffer with NONE defaults applied
 */
export function mergeWithNoneDefaults(
  declarations: ProcessingEventDeclaration[]
): ProcessingEventOffer {
  const noneDefault = (cls: ProcessingEventClass): ProcessingEventDeclaration => ({
    class: cls,
    boundary: 'NONE',
    scope: 'MINIMAL',
    providers: undefined,
    retention: 'NONE',
    description: `Default: no ${cls} processing permitted (A.3.054.14.1)`
  })

  const hasClass = (cls: ProcessingEventClass) =>
    declarations.some(d => d.class === cls)

  // Apply fail-closed provider coercion to each supplied declaration
  const coerced = declarations.map(coerceDeclarationToNoneIfUnboundable)

  const merged: ProcessingEventDeclaration[] = [...coerced]
  if (!hasClass('semantic')) merged.push(noneDefault('semantic'))
  if (!hasClass('actuating')) merged.push(noneDefault('actuating'))

  return {
    schemaVersion: '1.0',
    declarations: merged,
    senderIntentOnly: true
  }
}

// =============================================================================
// Accessor Helpers
// =============================================================================

/**
 * Get the declaration for a specific class from an offer.
 * Returns the canonical NONE default if the class is not declared.
 *
 * Per A.3.054.14.1: absence of a declaration = NONE for that class.
 */
export function getDeclarationForClass(
  offer: ProcessingEventOffer | undefined | null,
  cls: ProcessingEventClass
): ProcessingEventDeclaration {
  const found = offer?.declarations.find(d => d.class === cls)
  if (found) return found

  // Canonical default (A.3.054.14.1)
  return {
    class: cls,
    boundary: 'NONE',
    scope: 'MINIMAL',
    providers: undefined,
    retention: 'NONE'
  }
}

/**
 * Check whether the offer permits any non-NONE processing for a given class.
 * Convenience predicate for gating decisions.
 */
export function isProcessingPermitted(
  offer: ProcessingEventOffer | undefined | null,
  cls: ProcessingEventClass
): boolean {
  return getDeclarationForClass(offer, cls).boundary !== 'NONE'
}

/**
 * Get all declared provider IDs for a given class.
 * Returns an empty array when boundary is NONE.
 */
export function getProviderIdsForClass(
  offer: ProcessingEventOffer | undefined | null,
  cls: ProcessingEventClass
): string[] {
  const decl = getDeclarationForClass(offer, cls)
  if (decl.boundary === 'NONE' || !decl.providers) return []
  return decl.providers.map(p => p.providerId)
}

/**
 * Get the effective retention for a given class.
 * Returns 'NONE' (most restrictive default) when absent or boundary is NONE.
 */
export function getRetentionForClass(
  offer: ProcessingEventOffer | undefined | null,
  cls: ProcessingEventClass
): ProcessingRetention {
  const decl = getDeclarationForClass(offer, cls)
  if (decl.boundary === 'NONE') return 'NONE'
  return decl.retention ?? 'NONE'
}
