// ============================================================================
// WRVault — Insertion Pipeline Architecture & Interfaces
// ============================================================================
//
// Location : packages/shared/src/vault/insertionPipeline.ts
// Depends on: packages/shared/src/vault/fieldTaxonomy.ts
//
// This file defines the complete insertion pipeline:
//   1. Field detection → candidate scoring
//   2. Overlay preview with shadow DOM isolation
//   3. Consent-gated commit with DOM-fingerprint validation
//   4. QuickSelect manual fallback
//   5. Hard security constraints at every boundary
//
// ZERO DOM dependencies — types and contracts only.
// Runtime implementations live in apps/extension-chromium/src/vault/autofill/.
//
// ============================================================================

import type {
  FieldKind,
  VaultSection,
  VaultProfile,
  FieldEntry,
  AutofillSectionToggles,
  FormContext,
} from './fieldTaxonomy'

// ============================================================================
// §1  SEQUENCE DIAGRAMS (ascii, for inline documentation)
// ============================================================================
//
// ─────────────────────────────────────────────────────────────────────────────
// FLOW A:  Auto-Detected Field → Overlay Preview → Consent → Commit Insert
// ─────────────────────────────────────────────────────────────────────────────
//
//  ┌──────────┐   ┌──────────────┐   ┌───────────┐   ┌───────────┐   ┌───────┐
//  │  Page    │   │ FieldScanner │   │ VaultAPI  │   │ Overlay   │   │Committer│
//  │  DOM     │   │ (content)    │   │ (bg→main) │   │ (shadow)  │   │(content)│
//  └────┬─────┘   └──────┬───────┘   └─────┬─────┘   └─────┬─────┘   └───┬───┘
//       │                │                  │               │             │
//  [1]  │ page load /    │                  │               │             │
//       │ DOM mutation   │                  │               │             │
//       │───────────────>│                  │               │             │
//       │                │                  │               │             │
//  [2]  │                │ scanFields()     │               │             │
//       │                │ (score all       │               │             │
//       │                │  <input>,        │               │             │
//       │                │  <select>,       │               │             │
//       │                │  <textarea>)     │               │             │
//       │                │                  │               │             │
//  [3]  │                │ fields ≥ threshold               │             │
//       │                │──── filter by ───│               │             │
//       │                │  section toggles │               │             │
//       │                │                  │               │             │
//  [4]  │                │─── getAutofillCandidates(domain) │             │
//       │                │                  │               │             │
//  [5]  │                │<── VaultProfile[] │              │             │
//       │                │                  │               │             │
//  [6]  │                │ match profiles   │               │             │
//       │                │ to detected      │               │             │
//       │                │ FieldCandidates  │               │             │
//       │                │                  │               │             │
//  [7]  │                │───────── createOverlaySession() ─│             │
//       │                │                  │               │             │
//  [8]  │                │                  │  takeFingerprint()          │
//       │                │                  │  of each target element     │
//       │                │                  │               │             │
//  [9]  │                │                  │ render shadow │             │
//       │                │                  │ overlay near  │             │
//       │                │                  │ each field    │             │
//       │                │                  │ with PREVIEW  │             │
//       │                │                  │ values        │             │
//       │                │                  │               │             │
//  [10] │                │                  │ User sees:    │             │
//       │                │                  │ [🔒 ••••••]  │             │
//       │                │                  │ [✓ Fill]      │             │
//       │                │                  │ [✕ Dismiss]   │             │
//       │                │                  │               │             │
//  [11] │                │                  │ USER CLICKS   │             │
//       │                │                  │  [✓ Fill]     │             │
//       │                │                  │               │             │
//  [12] │                │                  │──── validateFingerprint() ──│
//       │                │                  │               │             │
//  [13] │                │                  │   fingerprint │ matches?    │
//       │                │                  │               │ YES         │
//       │                │                  │               │             │
//  [14] │                │                  │               │ safetyChecks()
//       │                │                  │               │ • isVisible?
//       │                │                  │               │ • isFocusable?
//       │                │                  │               │ • notHidden?
//       │                │                  │               │ • sameOrigin?
//       │                │                  │               │ • notDetached?
//       │                │                  │               │             │
//  [15] │<──────────────────────────────────────────────────── commitValue()
//       │  el.focus()                       │               │             │
//       │  el.value = v                     │               │             │
//       │  dispatch InputEvent              │               │             │
//       │  dispatch ChangeEvent             │               │             │
//       │                │                  │               │             │
//  [16] │                │                  │ teardown      │             │
//       │                │                  │ overlay       │             │
//       │                │                  │               │             │
//  [17] │                │                  │──── CommitResult ───────────│
//       │                │                  │               │             │
//
// ─────────────────────────────────────────────────────────────────────────────
// FLOW B:  QuickSelect Manual Target → Overlay Preview → Consent → Commit
// ─────────────────────────────────────────────────────────────────────────────
//
//  ┌──────────┐   ┌──────────────┐   ┌───────────┐   ┌───────────┐   ┌───────┐
//  │  Page    │   │ QuickSelect  │   │ VaultAPI  │   │ Overlay   │   │Committer│
//  │  DOM     │   │ (content)    │   │ (bg→main) │   │ (shadow)  │   │(content)│
//  └────┬─────┘   └──────┬───────┘   └─────┬─────┘   └─────┬─────┘   └───┬───┘
//       │                │                  │               │             │
//  [1]  │ User clicks    │                  │               │             │
//       │ WRVault icon   │                  │               │             │
//       │ or presses     │                  │               │             │
//       │ keyboard       │                  │               │             │
//       │ shortcut       │                  │               │             │
//       │───────────────>│                  │               │             │
//       │                │                  │               │             │
//  [2]  │                │ show QuickSelect │               │             │
//       │                │ dropdown (shadow │               │             │
//       │                │ DOM popover)     │               │             │
//       │                │                  │               │             │
//  [3]  │                │─── listItems(domain) ──────────> │             │
//       │                │                  │               │             │
//  [4]  │                │<── VaultProfile[] (all sections) │             │
//       │                │                  │               │             │
//  [5]  │                │ User picks a     │               │             │
//       │                │ profile + field  │               │             │
//       │                │ from dropdown    │               │             │
//       │                │                  │               │             │
//  [6]  │ User clicks    │                  │               │             │
//       │ (or tabs to)   │                  │               │             │
//       │ target <input> │                  │               │             │
//       │                │                  │               │             │
//  [7]  │                │ validate target: │               │             │
//       │                │ • isVisible?     │               │             │
//       │                │ • isFocusable?   │               │             │
//       │                │ • sameOrigin?    │               │             │
//       │                │ • notHidden?     │               │             │
//       │                │                  │               │             │
//  [8]  │                │───────── createOverlaySession() ─│             │
//       │                │                  │ takeFingerprint()           │
//       │                │                  │               │             │
//  [9]  │                │                  │ render inline │             │
//       │                │                  │ preview       │             │
//       │                │                  │ on target     │             │
//       │                │                  │ [🔒 j***@…]   │             │
//       │                │                  │ [✓] [✕]       │             │
//       │                │                  │               │             │
//  [10] │                │                  │ USER CLICKS   │             │
//       │                │                  │  [✓ Fill]     │             │
//       │                │                  │               │             │
//  [11-17] (same as Flow A steps 12-17)     │               │             │
//       │                │                  │               │             │
//
// ─────────────────────────────────────────────────────────────────────────────
// FLOW C:  Save-Password Prompt (post-submit detection)
// ─────────────────────────────────────────────────────────────────────────────
//
//  ┌──────────┐   ┌──────────────┐   ┌───────────┐   ┌──────────┐
//  │  Page    │   │SubmitWatcher │   │ VaultAPI  │   │ SaveBar  │
//  │  DOM     │   │ (content)    │   │ (bg→main) │   │ (shadow) │
//  └────┬─────┘   └──────┬───────┘   └─────┬─────┘   └─────┬────┘
//       │                │                  │               │
//  [1]  │ <form> submit  │                  │               │
//       │ or navigation  │                  │               │
//       │───────────────>│                  │               │
//       │                │                  │               │
//  [2]  │                │ extract:         │               │
//       │                │ • password field │               │
//       │                │ • username/email │               │
//       │                │ • current domain │               │
//       │                │                  │               │
//  [3]  │                │ check existing   │               │
//       │                │─── getAutofillCandidates(domain) │
//       │                │                  │               │
//  [4]  │                │<── matches[]     │               │
//       │                │                  │               │
//  [5]  │                │ if new:          │               │
//       │                │   "Save password?"│              │
//       │                │ if changed:      │               │
//       │                │   "Update password?"             │
//       │                │                  │               │
//  [6]  │                │──────── show SaveBar ───────────>│
//       │                │                  │               │
//  [7]  │                │                  │ User clicks   │
//       │                │                  │ [Save] or     │
//       │                │                  │ [Never for    │
//       │                │                  │  this site]   │
//       │                │                  │               │
//  [8]  │                │<── createItem / updateItem ──────│
//       │                │                  │               │
//       ▼                ▼                  ▼               ▼
//
// ============================================================================

// ============================================================================
// §2  CORE PIPELINE INTERFACES
// ============================================================================

// ---------------------------------------------------------------------------
// §2.1  FieldCandidate — a scored DOM element ready for filling
// ---------------------------------------------------------------------------

/**
 * Represents a single DOM input/select/textarea element that has been
 * evaluated against the field taxonomy and scored for matching confidence.
 *
 * Created by the FieldScanner, consumed by the OverlayManager.
 */
export interface FieldCandidate {
  /**
   * Opaque reference to the DOM element.
   * Typed as `unknown` here (shared package, no DOM dependency).
   * Runtime cast: `element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement`
   */
  element: unknown

  /** The best-matching field kind, or null if below threshold. */
  matchedKind: FieldKind | null

  /** Full match result with confidence and fired signals. */
  match: MatchResult

  /** DOM fingerprint taken at scan time for later invalidation. */
  fingerprint: DOMFingerprint

  /** Whether this element is inside a cross-origin iframe (auto-blocked). */
  crossOrigin: boolean

  /** Index within the form (for positional disambiguation). */
  formIndex: number

  /** The enclosing form's detected context. */
  formContext: FormContext
}

// ---------------------------------------------------------------------------
// §2.2  MatchResult — confidence score + reasoning
// ---------------------------------------------------------------------------

/**
 * Detailed match result for a single element-to-FieldKind evaluation.
 * Returned by the signal scorer, used for debugging and threshold gating.
 */
export interface MatchResult {
  /** Cumulative confidence score (sum of all fired signal weights). */
  confidence: number

  /** Whether the confidence exceeds CONFIDENCE_THRESHOLD (60). */
  accepted: boolean

  /** The FieldKind with highest score. */
  bestKind: FieldKind | null

  /**
   * Runner-up FieldKind, if any.  Used to detect ambiguity.
   * When |bestScore - runnerUpScore| < 15, the match is ambiguous
   * and should be deferred to QuickSelect rather than auto-filled.
   */
  runnerUp: FieldKind | null
  runnerUpConfidence: number

  /** Every signal that was evaluated, with its contribution. */
  signals: FiredSignal[]

  /** Anti-signals that fired (negative weight). */
  antiSignals: FiredSignal[]

  /** Form-context boost applied (if any). */
  contextBoost: number
}

/** A signal that was tested during field evaluation. */
export interface FiredSignal {
  /** Signal source type. */
  source: string
  /** The pattern that was tested. */
  pattern: string
  /** Whether the pattern matched the DOM element. */
  matched: boolean
  /** Weight contribution (0 if not matched, may be negative for anti-signals). */
  contribution: number
}

// ---------------------------------------------------------------------------
// §2.3  DOMFingerprint — tamper-detection snapshot of a target element
// ---------------------------------------------------------------------------

/**
 * Lightweight structural fingerprint of a DOM element.
 * Captured at overlay-creation time, re-checked at commit time.
 *
 * If any property differs between capture and commit, the overlay is
 * INVALIDATED and the fill is BLOCKED (prevents DOM-swap attacks).
 *
 * Strategy:
 * ─────────
 * We capture a combination of identity properties and structural context
 * that are extremely unlikely to change legitimately between preview and
 * commit (typically <5 seconds), but WILL change if a page script swaps
 * the visible input for a hidden one, moves it off-screen, or replaces
 * it with a different element.
 *
 * Properties captured:
 *   1. tagName                — element type immutable for same node
 *   2. inputType              — <input type="..."> immutable in practice
 *   3. name + id              — stable identifiers
 *   4. autocomplete           — stable attribute
 *   5. boundingRect (rounded) — position/size (rounded to 4px grid)
 *   6. computedVisibility     — display, visibility, opacity snapshot
 *   7. parentChain            — first 3 ancestor tagName+className
 *   8. ownerFrameOrigin       — origin of the containing document
 *   9. tabIndex               — focusability indicator
 *  10. formAction             — enclosing <form> action URL
 *
 * Hash: all properties are JSON-serialized and SHA-256 hashed (truncated
 * to 16 hex chars for speed).  Comparison is hash-equality.
 *
 * Tolerance: boundingRect is rounded to a 4px grid to absorb sub-pixel
 * layout shifts from animations or scroll.  If larger layout changes
 * occur (>4px), the fingerprint intentionally fails.
 */
export interface DOMFingerprint {
  /** SHA-256 truncated hash of the serialized properties. */
  hash: string

  /** Timestamp when the fingerprint was taken (ms since epoch). */
  capturedAt: number

  /** Maximum age before the fingerprint expires (ms).  Default: 30 000. */
  maxAge: number

  /**
   * Raw properties (kept in memory for debugging, never serialized to
   * storage or sent over IPC).
   */
  properties: DOMFingerprintProperties
}

export interface DOMFingerprintProperties {
  tagName: string
  inputType: string
  name: string
  id: string
  autocomplete: string
  rect: { top: number; left: number; width: number; height: number }
  visibility: { display: string; visibility: string; opacity: string }
  parentChain: string  // "DIV.form-group > FORM.login-form > SECTION"
  frameOrigin: string
  tabIndex: number
  formAction: string
}

/** Fingerprint validation result. */
export interface FingerprintValidation {
  valid: boolean
  /** If invalid, the specific reason(s). */
  reasons: FingerprintInvalidReason[]
}

export type FingerprintInvalidReason =
  | 'hash_mismatch'       // structural properties changed
  | 'expired'             // maxAge exceeded
  | 'element_detached'    // element no longer in DOM
  | 'element_hidden'      // element became invisible
  | 'element_moved'       // bounding rect shifted >4px
  | 'frame_origin_changed'// frame origin changed (should never happen)
  | 'element_replaced'    // element reference is dead (GC'd or replaced)

// ---------------------------------------------------------------------------
// §2.4  OverlaySession — state of one active fill preview
// ---------------------------------------------------------------------------

/**
 * Represents a single fill-preview session.
 *
 * An OverlaySession is created when the overlay is shown and lives until
 * the user commits, dismisses, or the session is invalidated.
 *
 * One session may cover multiple fields (e.g., username + password pair).
 */
export interface OverlaySession {
  /** Unique session ID (crypto.randomUUID). */
  id: string

  /** The VaultProfile providing the values. */
  profile: VaultProfile

  /** Each field being previewed, with its target element and fingerprint. */
  targets: OverlayTarget[]

  /** When this session was created (ms since epoch). */
  createdAt: number

  /**
   * Session timeout (ms).  Overlay auto-dismisses after this.
   * Default: 60 000 (1 minute).  Hard max: 120 000.
   */
  timeoutMs: number

  /**
   * Whether the user initiated this via QuickSelect (manual) vs.
   * auto-detection.  Affects logging and telemetry classification.
   */
  origin: 'auto' | 'quickselect'

  /**
   * Current session state.
   *
   * Lifecycle:   preview → committed | dismissed | invalidated | expired
   * Terminal states cannot transition.
   */
  state: OverlaySessionState

  /** If state is 'invalidated', the reason(s) why. */
  invalidReasons?: FingerprintInvalidReason[]
}

export type OverlaySessionState =
  | 'preview'      // Overlay is visible, waiting for consent
  | 'committed'    // User clicked Fill, values were injected
  | 'dismissed'    // User clicked Dismiss or pressed Escape
  | 'invalidated'  // DOM fingerprint check failed — fill blocked
  | 'expired'      // Session timed out

/** A single field within an overlay session. */
export interface OverlayTarget {
  /** The field entry from the vault profile. */
  field: FieldEntry

  /** The DOM element (opaque ref, cast at runtime). */
  element: unknown

  /** Fingerprint captured at session creation. */
  fingerprint: DOMFingerprint

  /** The preview value shown in the overlay (may be masked). */
  displayValue: string

  /** The actual value to inject on commit (never shown unmasked in DOM). */
  commitValue: string

  /** Per-target commit result (populated after commit attempt). */
  result?: CommitFieldResult
}

// ---------------------------------------------------------------------------
// §2.5  CommitResult — outcome of a fill operation
// ---------------------------------------------------------------------------

/**
 * Result of committing an entire overlay session.
 */
export interface CommitResult {
  /** Overall success — true only if ALL targets succeeded. */
  success: boolean

  /** Session that was committed. */
  sessionId: string

  /** Per-field results. */
  fields: CommitFieldResult[]

  /** Aggregate error (if any field failed). */
  error?: CommitError
}

/** Per-field commit result. */
export interface CommitFieldResult {
  /** The field kind that was filled. */
  kind: FieldKind

  /** Whether the value was successfully injected. */
  success: boolean

  /** If failed, the error. */
  error?: CommitError
}

/**
 * Typed commit errors — every failure mode is enumerated.
 */
export interface CommitError {
  code: CommitErrorCode
  message: string
  /** The specific field that failed (if applicable). */
  field?: FieldKind
}

export type CommitErrorCode =
  // ── Pre-commit validation ──
  | 'FINGERPRINT_MISMATCH'      // DOM changed since preview
  | 'FINGERPRINT_EXPIRED'       // Session too old
  | 'ELEMENT_DETACHED'          // Target no longer in DOM tree
  | 'ELEMENT_HIDDEN'            // Target became invisible (display:none, etc.)
  | 'ELEMENT_MOVED'             // Target position shifted >4px
  | 'ELEMENT_NOT_FOCUSABLE'     // Target cannot receive focus
  | 'CROSS_ORIGIN_BLOCKED'      // Target is in a cross-origin iframe
  | 'SESSION_EXPIRED'           // OverlaySession timed out
  | 'SESSION_INVALID'           // Session in terminal state
  // ── Commit-time errors ──
  | 'VALUE_DISPATCH_FAILED'     // Failed to dispatch InputEvent/ChangeEvent
  | 'READONLY_ELEMENT'          // Input is readonly or disabled
  | 'FRAMEWORK_SETTER_FAILED'   // React/Vue native value setter failed
  // ── Vault errors ──
  | 'VAULT_LOCKED'              // Vault locked during session
  | 'VAULT_ITEM_DELETED'        // Source item was deleted
  | 'CAPABILITY_DENIED'         // Tier insufficient for record type
  // ── Safety errors ──
  | 'SUSPICIOUS_DOM_MUTATION'   // MutationObserver detected adversarial change
  | 'MULTIPLE_ELEMENTS_MATCH'   // Ambiguous target (safety: refuse)
  | 'USER_CANCELLED'            // User dismissed overlay

// ============================================================================
// §3  SAFETY CHECK INTERFACES
// ============================================================================

/**
 * Pre-commit safety check result.
 * ALL checks must pass for a commit to proceed (fail-closed).
 */
export interface SafetyCheckResult {
  /** All checks passed. */
  safe: boolean

  /** Individual check results. */
  checks: SafetyCheck[]
}

export interface SafetyCheck {
  /** Check identifier. */
  name: SafetyCheckName

  /** Whether this check passed. */
  passed: boolean

  /** Human-readable explanation (for debugging). */
  reason: string
}

export type SafetyCheckName =
  | 'is_visible'            // Element has non-zero bounding rect, not display:none
  | 'is_focusable'          // Element can receive focus (not disabled, not inert)
  | 'is_same_origin'        // Element is in same-origin frame (or top-level)
  | 'is_not_hidden_input'   // Element type is not "hidden"
  | 'is_not_detached'       // Element is connected to the document
  | 'is_user_intended'      // Element was the focus target at consent time
  | 'fingerprint_valid'     // DOMFingerprint matches current state
  | 'session_not_expired'   // OverlaySession is within timeout
  | 'no_suspicious_mutation' // MutationObserver saw no adversarial changes
  | 'bounding_rect_stable'  // Rect did not shift >4px since fingerprint

// ============================================================================
// §4  OVERLAY RENDERING CONTRACT
// ============================================================================

/**
 * Overlay rendering configuration.
 *
 * The overlay is a Shadow DOM element positioned near each target field.
 * It shows a PREVIEW of what will be filled and requires consent to commit.
 */
export interface OverlayRenderConfig {
  /** Shadow DOM mode — always 'closed' to prevent page script access. */
  shadowMode: 'closed'

  /** Z-index for the overlay host (must exceed page content). */
  zIndex: number  // 2147483645 (below the vault lightbox at 2147483649)

  /**
   * Background style for the overlay preview badge.
   * Semi-transparent to signal "not yet committed".
   */
  previewBackground: string  // 'rgba(15, 23, 42, 0.92)'

  /** Border style to indicate vault origin. */
  borderStyle: string  // '2px solid rgba(99, 102, 241, 0.6)'

  /** Max width of the overlay badge. */
  maxWidth: number  // 320px

  /** Padding inside the badge. */
  padding: string  // '8px 12px'

  /** Font stack (system fonts, no external loads). */
  fontFamily: string  // '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
}

/** Default overlay render config. */
export const DEFAULT_OVERLAY_CONFIG: OverlayRenderConfig = {
  shadowMode: 'closed',
  zIndex: 2147483645,
  previewBackground: 'rgba(15, 23, 42, 0.92)',
  borderStyle: '2px solid rgba(99, 102, 241, 0.6)',
  maxWidth: 320,
  padding: '8px 12px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
} as const

// ============================================================================
// §5  PASSWORD MASKING UX RULES
// ============================================================================
//
// These rules govern how sensitive values are displayed in the overlay preview
// and QuickSelect dropdown.  They are UX constraints, not crypto constraints
// (the actual values are always available in memory during the session).
//
// ─────────────────────────────────────────────────────────────────────────────
//
//  RULE 1: Default Masked
//  ──────────────────────
//  All fields where FieldSignalSpec.sensitive === true are displayed as:
//    • Overlay preview:  "••••••••"  (8 bullet chars, regardless of length)
//    • QuickSelect list: "••••••••"
//
//  RULE 2: Peek on Hover (overlay only)
//  ─────────────────────────────────────
//  When the user hovers over a masked preview badge:
//    • Show first 2 chars + "•••" + last 2 chars  (e.g., "pa•••rd")
//    • If value length ≤ 4: show only "••••" (too short to partially reveal)
//    • Hover state persists for 3 seconds max, then auto-re-masks
//    • Touch: tap-and-hold triggers peek, release re-masks
//
//  RULE 3: Reveal Button (overlay only)
//  ─────────────────────────────────────
//  Each masked field has a 👁 toggle button:
//    • Click → reveals full value in monospace font for 5 seconds
//    • After 5 seconds → auto-re-masks
//    • Button text toggles: 👁 → 👁‍🗨 while revealed
//    • Only one field may be revealed at a time (revealing another re-masks previous)
//
//  RULE 4: Copy Button
//  ───────────────────
//  Each sensitive field has a 📋 copy button:
//    • Copies to clipboard via navigator.clipboard.writeText()
//    • Visual feedback: button shows "✓" for 1.5 seconds
//    • Clipboard is cleared after 30 seconds via setTimeout
//    • Copy works regardless of mask state (always copies real value)
//
//  RULE 5: Non-Sensitive Fields
//  ────────────────────────────
//  Fields where sensitive === false are shown in cleartext:
//    • Username: "john@example.com"
//    • Full name: "John Smith"
//    • Truncated at 24 chars with "…" suffix
//
//  RULE 6: QuickSelect Dropdown
//  ────────────────────────────
//  In the dropdown list:
//    • Item title is always visible (e.g., "GitHub Login")
//    • Username/email shown in cleartext (for identification)
//    • Passwords always "••••••••" (no reveal in dropdown)
//    • Reveal and copy only available AFTER overlay preview is shown
//
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Masking rules for display values.
 */
export interface MaskingConfig {
  /** Character used for masking. */
  maskChar: string          // '•'

  /** Number of mask characters shown. */
  maskLength: number        // 8

  /** Max display length for non-sensitive values before truncation. */
  maxClearLength: number    // 24

  /** Truncation suffix. */
  truncationSuffix: string  // '…'

  /** Peek: chars revealed at start. */
  peekStartChars: number    // 2

  /** Peek: chars revealed at end. */
  peekEndChars: number      // 2

  /** Minimum value length for partial peek (below this → full mask). */
  peekMinLength: number     // 5

  /** Peek auto-remask timeout (ms). */
  peekTimeoutMs: number     // 3000

  /** Reveal auto-remask timeout (ms). */
  revealTimeoutMs: number   // 5000

  /** Clipboard auto-clear timeout (ms). */
  clipboardClearMs: number  // 30000
}

export const DEFAULT_MASKING: MaskingConfig = {
  maskChar: '\u2022',
  maskLength: 8,
  maxClearLength: 24,
  truncationSuffix: '\u2026',
  peekStartChars: 2,
  peekEndChars: 2,
  peekMinLength: 5,
  peekTimeoutMs: 3000,
  revealTimeoutMs: 5000,
  clipboardClearMs: 30000,
} as const

/**
 * Compute the display value for a field entry based on masking rules.
 * Pure function — no DOM dependency.
 */
export function computeDisplayValue(
  value: string,
  sensitive: boolean,
  maskState: 'masked' | 'peeked' | 'revealed',
  config: MaskingConfig = DEFAULT_MASKING,
): string {
  if (!sensitive) {
    return value.length > config.maxClearLength
      ? value.slice(0, config.maxClearLength) + config.truncationSuffix
      : value
  }

  switch (maskState) {
    case 'revealed':
      return value

    case 'peeked':
      if (value.length < config.peekMinLength) {
        return config.maskChar.repeat(config.maskLength)
      }
      return (
        value.slice(0, config.peekStartChars) +
        config.maskChar.repeat(3) +
        value.slice(-config.peekEndChars)
      )

    case 'masked':
    default:
      return config.maskChar.repeat(config.maskLength)
  }
}

// ============================================================================
// §6  SERVICE INTERFACES (implemented in extension-chromium)
// ============================================================================

/**
 * Field scanner — runs in content script context.
 * Scans the page DOM for fillable fields and scores them.
 */
export interface IFieldScanner {
  /**
   * Scan the current page for fillable fields.
   * Only evaluates fields within the enabled section toggles.
   */
  scan(toggles: AutofillSectionToggles): FieldCandidate[]

  /**
   * Re-scan a specific form element (after DOM mutation).
   */
  rescan(formElement: unknown, toggles: AutofillSectionToggles): FieldCandidate[]

  /**
   * Score a single element against the field taxonomy.
   */
  scoreElement(element: unknown): MatchResult
}

/**
 * Overlay manager — creates and manages shadow DOM overlays.
 * Runs in content script context.
 */
export interface IOverlayManager {
  /**
   * Create a new overlay session for the given targets.
   * Returns the session ID.
   */
  createSession(
    profile: VaultProfile,
    targets: Array<{ element: unknown; field: FieldEntry }>,
    origin: 'auto' | 'quickselect',
  ): OverlaySession

  /**
   * Show the overlay for a session (renders shadow DOM badges).
   */
  show(sessionId: string): void

  /**
   * Dismiss an overlay session (user clicked Dismiss or pressed Escape).
   */
  dismiss(sessionId: string): void

  /**
   * Get the current session (if any).
   */
  getActiveSession(): OverlaySession | null

  /**
   * Destroy all overlays and sessions.
   */
  teardownAll(): void
}

/**
 * Committer — injects values into DOM elements.
 * Runs in content script context.
 */
export interface ICommitter {
  /**
   * Commit all values for an overlay session.
   *
   * Steps:
   * 1. Validate all fingerprints
   * 2. Run all safety checks
   * 3. Inject values into each target element
   * 4. Return result
   *
   * If ANY pre-commit check fails, NO values are injected (atomic).
   */
  commit(session: OverlaySession): Promise<CommitResult>
}

/**
 * QuickSelect — manual field selection dropdown.
 * Runs in content script context.
 */
export interface IQuickSelect {
  /**
   * Open the QuickSelect dropdown near the currently focused element.
   * @param profiles - Available vault profiles for the current domain
   */
  open(profiles: VaultProfile[]): void

  /**
   * Close the dropdown.
   */
  close(): void

  /**
   * Whether the dropdown is currently open.
   */
  isOpen(): boolean
}

/**
 * Submit watcher — detects form submissions for save-password prompts.
 * Runs in content script context.
 */
export interface ISubmitWatcher {
  /**
   * Start watching for form submissions on the current page.
   */
  start(): void

  /**
   * Stop watching.
   */
  stop(): void

  /**
   * Register a callback for when a credential submission is detected.
   */
  onCredentialSubmit(
    callback: (extracted: ExtractedCredentials) => void,
  ): void
}

/** Credentials extracted from a form submission. */
export interface ExtractedCredentials {
  /** The domain where the form was submitted. */
  domain: string

  /** Extracted username or email (may be empty). */
  username: string

  /** Extracted password (always present for this to fire). */
  password: string

  /** The form action URL (if available). */
  formAction?: string

  /** Whether this is a signup (new-password) vs. login (current-password). */
  formType: 'login' | 'signup' | 'unknown'

  /** Timestamp. */
  extractedAt: number
}

// ============================================================================
// §7  MESSAGE TYPES (content script ↔ background ↔ vault)
// ============================================================================

/**
 * Message types for the autofill pipeline.
 * Sent via chrome.runtime.sendMessage from content script to background.
 */
export type AutofillMessage =
  | { type: 'VAULT_AUTOFILL_CANDIDATES'; domain: string }
  | { type: 'VAULT_AUTOFILL_PROFILES'; domain: string }
  | { type: 'VAULT_SAVE_CREDENTIAL'; credential: ExtractedCredentials }
  | { type: 'VAULT_UPDATE_CREDENTIAL'; itemId: string; credential: ExtractedCredentials }
  | { type: 'VAULT_AUTOFILL_STATUS' }  // Is vault unlocked + autofill enabled?

/**
 * Response types from background to content script.
 */
export type AutofillResponse =
  | { success: true; profiles: VaultProfile[] }
  | { success: true; saved: boolean; itemId: string }
  | { success: true; status: { unlocked: boolean; enabled: boolean; toggles: AutofillSectionToggles } }
  | { success: false; error: string }

// ============================================================================
// §8  CONSTANTS & CONFIGURATION
// ============================================================================

/** Maximum overlay session duration before auto-expire (ms). */
export const MAX_SESSION_TIMEOUT_MS = 120_000  // 2 minutes

/** Default overlay session timeout (ms). */
export const DEFAULT_SESSION_TIMEOUT_MS = 60_000  // 1 minute

/** Fingerprint max age before expiry (ms). */
export const FINGERPRINT_MAX_AGE_MS = 30_000  // 30 seconds

/** Bounding rect tolerance for fingerprint comparison (px). */
export const RECT_TOLERANCE_PX = 4

/** Maximum number of simultaneous overlay sessions (safety limit). */
export const MAX_ACTIVE_SESSIONS = 1

/** Debounce time for MutationObserver-triggered rescan (ms). */
export const MUTATION_RESCAN_DEBOUNCE_MS = 500

/** Minimum interval between full page scans (ms). */
export const SCAN_THROTTLE_MS = 2000

/**
 * DOM element types that are valid fill targets.
 * Anything else is rejected at scan time.
 */
export const VALID_TARGET_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA'])

/**
 * Input types that are NEVER valid fill targets.
 * Overlaps with ANTI_SIGNALS but enforced independently as a hard block.
 */
export const BLOCKED_INPUT_TYPES = new Set([
  'hidden', 'submit', 'button', 'reset', 'image', 'file',
  'range', 'color', 'checkbox', 'radio',
])

// ============================================================================
// §9  IMPLEMENTATION PLAN — file-level changes
// ============================================================================
//
// All new files live under apps/extension-chromium/src/vault/autofill/.
// Shared types stay in packages/shared/src/vault/.
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  PHASE 1: Field Scanning (no UI, no filling — detection only)          │
// │  Estimated: 3 files, ~600 lines                                        │
// ├─────────────────────────────────────────────────────────────────────────┤
// │                                                                         │
// │  packages/shared/src/vault/fieldTaxonomy.ts        [EXISTS]             │
// │    — Already created.  Field kinds, signals, weights.                   │
// │                                                                         │
// │  packages/shared/src/vault/insertionPipeline.ts    [THIS FILE]          │
// │    — Interfaces, types, constants.  No runtime code.                    │
// │                                                                         │
// │  apps/extension-chromium/src/vault/autofill/                            │
// │  ├── fieldScanner.ts                               [NEW]                │
// │  │   Implements IFieldScanner.                                          │
// │  │   — querySelectorAll('input, select, textarea')                      │
// │  │   — For each: score against FIELD_REGISTRY signals                   │
// │  │   — Filter by BLOCKED_INPUT_TYPES, crossOrigin check                 │
// │  │   — Apply ANTI_SIGNALS, FORM_CONTEXT_SIGNALS                         │
// │  │   — Return FieldCandidate[] sorted by confidence                     │
// │  │   — MutationObserver watcher for dynamic forms                       │
// │  │                                                                      │
// │  ├── domFingerprint.ts                             [NEW]                │
// │  │   Implements DOMFingerprint capture + validation.                     │
// │  │   — takeFingerprint(element): DOMFingerprint                         │
// │  │   — validateFingerprint(fp, element): FingerprintValidation          │
// │  │   — SHA-256 truncated hash via SubtleCrypto                          │
// │  │   — Bounding-rect rounding to 4px grid                              │
// │  │   — Parent chain extraction (3 ancestors)                            │
// │  │                                                                      │
// │  ├── safetyChecks.ts                               [NEW]                │
// │  │   Implements all SafetyCheckName checks.                              │
// │  │   — isVisible: getComputedStyle + getBoundingClientRect              │
// │  │   — isFocusable: !disabled, !inert, tabIndex >= 0                   │
// │  │   — isSameOrigin: window.location.origin vs frame check              │
// │  │   — isNotHidden: input.type !== 'hidden'                             │
// │  │   — isNotDetached: document.contains(element)                        │
// │  │   — isUserIntended: document.activeElement === element                │
// │  │   — boundingRectStable: rect diff ≤ RECT_TOLERANCE_PX               │
// │  │                                                                      │
// ├─────────────────────────────────────────────────────────────────────────┤
// │  PHASE 2: Overlay Preview (shadow DOM rendering, no commit)            │
// │  Estimated: 3 files, ~800 lines                                        │
// ├─────────────────────────────────────────────────────────────────────────┤
// │                                                                         │
// │  apps/extension-chromium/src/vault/autofill/                            │
// │  ├── overlayManager.ts                             [NEW]                │
// │  │   Implements IOverlayManager.                                        │
// │  │   — Creates <div> host, attachShadow({mode:'closed'})               │
// │  │   — Positions badge near target input (below or above)               │
// │  │   — Renders preview values (masked per §5 rules)                     │
// │  │   — Fill / Dismiss / Reveal / Copy buttons                           │
// │  │   — Session lifecycle management                                     │
// │  │   — Auto-dismiss on Escape, click-outside, timeout                   │
// │  │   — Re-positions on scroll/resize                                    │
// │  │                                                                      │
// │  ├── overlayStyles.ts                              [NEW]                │
// │  │   CSS-in-JS styles for the overlay badge.                            │
// │  │   — Constructed CSSStyleSheet for adoptedStyleSheets                 │
// │  │   — Dark theme (matches vault UI aesthetic)                          │
// │  │   — Animations: fade-in, slide-in, pulse on hover                   │
// │  │   — Responsive: clamps to viewport edges                            │
// │  │                                                                      │
// │  ├── maskingEngine.ts                              [NEW]                │
// │  │   Implements computeDisplayValue + mask state machine.               │
// │  │   — Pure functions (no DOM)                                          │
// │  │   — Clipboard clear timer management                                 │
// │  │   — One-revealed-at-a-time enforcement                              │
// │  │                                                                      │
// ├─────────────────────────────────────────────────────────────────────────┤
// │  PHASE 3: Commit Insert (value injection with safety checks)           │
// │  Estimated: 2 files, ~400 lines                                        │
// ├─────────────────────────────────────────────────────────────────────────┤
// │                                                                         │
// │  apps/extension-chromium/src/vault/autofill/                            │
// │  ├── committer.ts                                  [NEW]                │
// │  │   Implements ICommitter.                                              │
// │  │   — All-or-nothing commit: validate ALL targets first                │
// │  │   — Framework-aware value injection:                                  │
// │  │     • nativeInputValueSetter for React                               │
// │  │     • Object.getOwnPropertyDescriptor trick for Vue/Angular          │
// │  │     • Dispatch: InputEvent('input', {bubbles:true})                  │
// │  │     • Dispatch: Event('change', {bubbles:true})                      │
// │  │   — Focus management: focus → set → blur (if multi-field)            │
// │  │   — Return CommitResult with per-field results                       │
// │  │                                                                      │
// │  ├── mutationGuard.ts                              [NEW]                │
// │  │   MutationObserver watching overlay targets for suspicious           │
// │  │   DOM changes between preview and commit.                             │
// │  │   — Watches: childList, attributes, characterData                    │
// │  │   — Suspicious triggers:                                             │
// │  │     • Target element removed                                         │
// │  │     • Target type/name/id changed                                    │
// │  │     • Target reparented (moved in DOM tree)                          │
// │  │     • New hidden input added as sibling                              │
// │  │   — On trigger: invalidate OverlaySession immediately               │
// │  │                                                                      │
// ├─────────────────────────────────────────────────────────────────────────┤
// │  PHASE 4: QuickSelect + Save-Password                                  │
// │  Estimated: 3 files, ~700 lines                                        │
// ├─────────────────────────────────────────────────────────────────────────┤
// │                                                                         │
// │  apps/extension-chromium/src/vault/autofill/                            │
// │  ├── quickSelect.ts                                [NEW]                │
// │  │   Implements IQuickSelect.                                            │
// │  │   — Shadow DOM dropdown (closed mode)                                │
// │  │   — Positioned near focused input                                    │
// │  │   — Keyboard navigation (↑/↓/Enter/Escape)                          │
// │  │   — Profile list with section grouping                               │
// │  │   — Field picker within selected profile                             │
// │  │   — Search/filter within dropdown                                    │
// │  │   — Delegates to overlayManager for preview + commit                 │
// │  │                                                                      │
// │  ├── submitWatcher.ts                              [NEW]                │
// │  │   Implements ISubmitWatcher.                                          │
// │  │   — Intercepts <form> submit events                                  │
// │  │   — Intercepts navigation (beforeunload) after password fill         │
// │  │   — Extracts username + password from form fields                    │
// │  │   — Classifies login vs. signup (new-password presence)              │
// │  │   — Compares against existing vault entries                          │
// │  │   — Triggers save bar via chrome.runtime.sendMessage                 │
// │  │                                                                      │
// │  ├── saveBar.ts                                    [NEW]                │
// │  │   Top-of-page notification bar for save/update prompts.              │
// │  │   — Shadow DOM (closed mode)                                         │
// │  │   — "Save password for example.com?" with Save / Never buttons       │
// │  │   — Auto-dismiss after 30 seconds                                    │
// │  │   — Creates/updates vault item via message to background             │
// │  │                                                                      │
// ├─────────────────────────────────────────────────────────────────────────┤
// │  PHASE 5: Wiring + Integration                                         │
// │  Estimated: modifications to 5 existing files                           │
// ├─────────────────────────────────────────────────────────────────────────┤
// │                                                                         │
// │  apps/extension-chromium/src/vault/autofill/                            │
// │  ├── index.ts                                      [NEW]                │
// │  │   Pipeline orchestrator:                                             │
// │  │   — Initializes scanner, overlay, committer, quickselect, watcher    │
// │  │   — Connects MutationObserver for dynamic page changes               │
// │  │   — Listens for vault unlock/lock to enable/disable                  │
// │  │   — Registers keyboard shortcut (Ctrl+Shift+L / Cmd+Shift+L)        │
// │  │   — Exports init() function for content-script.tsx                   │
// │  │                                                                      │
// │  EXISTING FILE MODIFICATIONS:                                           │
// │                                                                         │
// │  apps/extension-chromium/src/vault/api.ts          [MODIFY]             │
// │    — Implement getAutofillCandidates() (remove throw, wire HTTP call)   │
// │    — Add getAutofillProfiles() that returns VaultProfile[]              │
// │    — Add saveCredential() / updateCredential() helpers                  │
// │                                                                         │
// │  apps/extension-chromium/src/vault/types.ts        [MODIFY]             │
// │    — Re-export fieldTaxonomy types                                      │
// │    — Re-export insertionPipeline types                                  │
// │                                                                         │
// │  apps/extension-chromium/src/content-script.tsx    [MODIFY]             │
// │    — Import autofill/index.ts                                           │
// │    — Call init() after DOM ready                                        │
// │    — Register OPEN_QUICKSELECT message handler                          │
// │    — Wire keyboard shortcut listener                                    │
// │                                                                         │
// │  apps/extension-chromium/src/background.ts         [MODIFY]             │
// │    — Add handlers for VAULT_AUTOFILL_* message types                    │
// │    — Route to HTTP API on port 51248                                    │
// │                                                                         │
// │  apps/extension-chromium/manifest.config.ts        [MODIFY]             │
// │    — No changes needed (content script already on <all_urls>)           │
// │    — Verify 'clipboardWrite' permission if needed (optional)            │
// │                                                                         │
// │  apps/electron-vite-project/electron/main/vault/rpc.ts  [MODIFY]       │
// │    — Add HTTP route for /autofill/candidates (wraps existing RPC)       │
// │    — Add HTTP route for /autofill/profiles (returns VaultProfile[])     │
// │                                                                         │
// └─────────────────────────────────────────────────────────────────────────┘
//
// TOTAL NEW FILES:  11
// TOTAL MODIFIED:    6
// ESTIMATED LINES: ~2500 (new code)
//
// ============================================================================
