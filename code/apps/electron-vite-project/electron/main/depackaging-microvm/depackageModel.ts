/**
 * B2.1 (D4) — shared guest depackage model. Pure; no electron, no network.
 *
 * Extracted so BOTH input forms converge on ONE internal representation
 * (`ParseOut`) and ONE failure taxonomy:
 *   - the RFC822 path (`emailDepackage.ts:hardenedParse`)
 *   - the provider-structured-json path (`providerStructuredWalker.ts`)
 * Everything after the parse — carrier detection (R3), HTML→SafeText (R1),
 * sealing, the typed result union — is shared, not duplicated (spec 0010 D4.3).
 *
 * Living here (rather than in `emailDepackage.ts`) keeps the walker free of any
 * runtime dependency on `emailDepackage`, so there is no import cycle.
 */

import type { DisplayEnvelope, ThreadingHints } from './displayEnvelope'

// ── Typed failure taxonomy (INV-7) ──────────────────────────────────────────

export type DepackageFailureCode =
  | 'E_MALFORMED_MIME'
  | 'E_LIMITS_EXCEEDED'
  | 'E_DECOMPRESSION_BOMB'
  | 'E_AMBIGUOUS_CLASSIFICATION'
  | 'E_AMBIGUOUS_STRUCTURE'
  | 'E_ARTIFACT_CUSTODY_FAILED'

/** Thrown inside the guest; mapped to a typed failure result at the entry. */
export class DepackageFailure extends Error {
  constructor(public readonly code: DepackageFailureCode, message?: string) {
    super(message ?? code)
    this.name = 'DepackageFailure'
  }
}

// ── Hardened limits (C4) ─────────────────────────────────────────────────────

export interface DepackageLimits {
  /** Spec value wins over the hardcoded default (C4). */
  readonly maxInputBytes?: number
}

export const DEPACKAGE_DEFAULTS = {
  MAX_INPUT_BYTES: 8 * 1024 * 1024,
  MAX_PARTS: 256,
  MAX_DEPTH: 8,
  MAX_HEADERS_BYTES: 64 * 1024,
  /** decoded/raw ratio ceiling — base64 shrinks, QP ~1x; >this ⇒ bomb. */
  MAX_DECODE_RATIO: 8,
} as const

/** C4: the spec `maxInputBytes` wins over the hardcoded default, capped by it. */
export function resolveMaxInputBytes(limits?: DepackageLimits): number {
  return limits?.maxInputBytes != null && limits.maxInputBytes > 0
    ? Math.min(limits.maxInputBytes, DEPACKAGE_DEFAULTS.MAX_INPUT_BYTES)
    : DEPACKAGE_DEFAULTS.MAX_INPUT_BYTES
}

// ── The shared internal representation (the convergence point, D4.3) ─────────

export interface Leaf {
  contentType: string
  filename?: string
  isAttachment: boolean
  /** decoded bytes of the leaf */
  bytes: Buffer
}

/**
 * The pre-SafeText, pre-carrier-detection representation. Both the RFC822 parser
 * and the provider-structured-json walker MUST produce exactly this shape:
 *   - `text/plain` body parts → `plainTextParts` only (never sealed)
 *   - `text/html` body parts → `htmlParts` (for R1 derivation) AND a `leaf`
 *     (so the original HTML is custody-sealed)
 *   - attachments → `leaves` (with `isAttachment: true`, `filename`)
 */
export interface ParseOut {
  subject: string
  plainTextParts: string[]
  htmlParts: string[]
  /** every leaf (for carrier detection + sealing) */
  leaves: Leaf[]
  /**
   * B2.2: the decoded + normalized display envelope (subject/from/to/cc/reply-to/
   * date), derived in-guest. Both producers populate it (RFC822 + structured-json).
   */
  displayEnvelope: DisplayEnvelope
  /**
   * B2.2: threading keys (Message-ID/In-Reply-To/References), derived in-guest so
   * IMAP threading + MOVE relocation never depend on an orchestrator header parse.
   */
  threadingHints: ThreadingHints
}
