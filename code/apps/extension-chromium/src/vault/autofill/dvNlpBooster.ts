// ============================================================================
// WRVault DataVault — Optional Local NLP Booster (Pluggable Interface)
// ============================================================================
//
// Provides a pluggable NLP classification interface that can optionally
// improve field detection for mid-confidence fields.
//
// Design principles:
//   - The default implementation returns "no opinion" (no dependency).
//   - A real NLP backend can be feature-flagged in later.
//   - Input MUST be redacted: only label/placeholder/aria text + nearby
//     heading/button text.  NEVER field values.
//   - Output is candidate vaultKeys + scores.
//   - Merged into final classifier score with a small weight so heuristics
//     remain primary.
//
// Security contract:
//   - Input TextFeatures contain NO PII (no field values, no user data)
//   - Only structural/UI text features are sent
//   - The default stub never makes network calls
//
// Public API:
//   semanticClassify(features)     → Promise<NlpClassifyResult>
//   registerNlpBackend(backend)    → void
//   isNlpBoosterEnabled()          → boolean
//   NLP_BOOSTER_WEIGHT             → number (merge weight)
//
// ============================================================================

import type { FieldKind } from '../../../../../packages/shared/src/vault/fieldTaxonomy'

// ============================================================================
// §1  Types
// ============================================================================

/**
 * Redacted text features extracted from the DOM around a field.
 *
 * CRITICAL: These MUST NOT contain field values or user-entered data.
 * Only structural text (labels, placeholders, headings, button text) is safe.
 */
export interface TextFeatures {
  /** Resolved label text (from <label>, aria-label, placeholder). */
  labelText: string
  /** Placeholder attribute value. */
  placeholder: string
  /** Nearest heading text (h1-h6 ancestor or preceding sibling). */
  nearbyHeading: string
  /** Submit/action button text in the same form. */
  nearbyButtonText: string
  /** aria-describedby text, if any. */
  ariaDescription: string
  /** The field's name attribute (structural, not PII). */
  fieldName: string
  /** The field's id attribute (structural, not PII). */
  fieldId: string
  /** Autocomplete attribute value. */
  autocomplete: string
  /** Language hint from the page (html[lang] or meta). */
  pageLang: string
}

/**
 * NLP classification result: candidate vaultKeys with scores.
 */
export interface NlpClassifyResult {
  /** Candidate vaultKeys ranked by NLP score (highest first). */
  candidates: Array<{
    vaultKey: FieldKind
    /** NLP confidence 0..1 (1 = very confident). */
    score: number
  }>
  /** Whether the NLP backend was actually invoked. */
  invoked: boolean
  /** Backend identifier (for telemetry). */
  backend: string
}

/**
 * Interface for NLP backend implementations.
 */
export interface NlpBackend {
  /** Unique identifier for this backend (e.g. 'spacy-local', 'tflite'). */
  readonly id: string

  /**
   * Classify text features into candidate vaultKeys.
   *
   * @param features Redacted text features (NO PII)
   * @returns Ranked candidates with scores
   */
  classify(features: TextFeatures): Promise<NlpClassifyResult>

  /**
   * Whether this backend is ready to accept requests.
   */
  isReady(): boolean
}

// ============================================================================
// §2  Feature Flag
// ============================================================================

/** Feature flag: when true, the NLP booster is called for mid-confidence fields. */
let _nlpBoosterEnabled = false

/**
 * Enable or disable the NLP booster.
 *
 * When disabled, `semanticClassify()` returns an empty/no-opinion result.
 */
export function setNlpBoosterEnabled(enabled: boolean): void {
  _nlpBoosterEnabled = enabled
}

/** Check if the NLP booster is enabled. */
export function isNlpBoosterEnabled(): boolean {
  return _nlpBoosterEnabled && _activeBackend !== null
}

// ============================================================================
// §3  Backend Registration
// ============================================================================

let _activeBackend: NlpBackend | null = null

/**
 * Register an NLP backend implementation.
 *
 * Only one backend can be active at a time; new registrations replace the old.
 */
export function registerNlpBackend(backend: NlpBackend): void {
  _activeBackend = backend
}

/**
 * Unregister the current NLP backend.
 */
export function unregisterNlpBackend(): void {
  _activeBackend = null
}

// ============================================================================
// §4  Merge Weight
// ============================================================================

/**
 * Weight applied to NLP scores when merging with heuristic scores.
 *
 * Kept intentionally low so heuristics remain primary.
 * NLP score contribution = nlpScore * NLP_BOOSTER_WEIGHT
 *
 * With a max NLP score of 1.0 and weight of 15, the max NLP contribution
 * is 15 points — enough to tip a mid-confidence field (0.50-0.65) over
 * the threshold but not enough to override strong heuristic signals.
 */
export const NLP_BOOSTER_WEIGHT = 15

// ============================================================================
// §5  Main API
// ============================================================================

/**
 * Classify text features using the registered NLP backend.
 *
 * Returns an empty result if:
 *   - NLP booster is disabled
 *   - No backend is registered
 *   - The backend is not ready
 *   - An error occurs (fails open with no opinion)
 *
 * @param features Redacted text features (MUST NOT contain PII)
 */
export async function semanticClassify(
  features: TextFeatures,
): Promise<NlpClassifyResult> {
  const emptyResult: NlpClassifyResult = {
    candidates: [],
    invoked: false,
    backend: 'none',
  }

  if (!_nlpBoosterEnabled || !_activeBackend) return emptyResult
  if (!_activeBackend.isReady()) return emptyResult

  // Validate: features must not be empty
  if (!features.labelText && !features.placeholder && !features.fieldName) {
    return emptyResult
  }

  try {
    const result = await _activeBackend.classify(features)
    return result
  } catch {
    // Fail open: NLP errors should never break autofill
    return emptyResult
  }
}

// ============================================================================
// §6  Feature Extraction
// ============================================================================

/**
 * Extract redacted TextFeatures from a DOM element.
 *
 * CRITICAL: This function extracts ONLY structural/UI text.
 * It NEVER reads field.value or any user-entered data.
 */
export function extractTextFeatures(element: HTMLElement): TextFeatures {
  const input = element as HTMLInputElement

  return {
    labelText: resolveLabel(element),
    placeholder: (input.placeholder ?? '').trim(),
    nearbyHeading: findNearbyHeading(element),
    nearbyButtonText: findNearbyButtonText(element),
    ariaDescription: resolveAriaDescription(element),
    fieldName: (input.name ?? '').toLowerCase(),
    fieldId: (element.id ?? '').toLowerCase(),
    autocomplete: (element.getAttribute('autocomplete') ?? '').toLowerCase(),
    pageLang: getPageLanguage(),
  }
}

// ============================================================================
// §7  DOM Helpers (NO PII)
// ============================================================================

function resolveLabel(element: HTMLElement): string {
  // <label for="id">
  if (element.id) {
    const label = document.querySelector<HTMLLabelElement>(
      `label[for="${CSS.escape(element.id)}"]`,
    )
    if (label?.textContent) return label.textContent.trim().toLowerCase()
  }

  // Parent <label>
  const parentLabel = element.closest('label')
  if (parentLabel?.textContent) return parentLabel.textContent.trim().toLowerCase()

  // aria-label
  const ariaLabel = element.getAttribute('aria-label')
  if (ariaLabel) return ariaLabel.trim().toLowerCase()

  // placeholder
  const placeholder = (element as HTMLInputElement).placeholder
  if (placeholder) return placeholder.trim().toLowerCase()

  return ''
}

function findNearbyHeading(element: HTMLElement): string {
  // Walk up to find the nearest heading
  let parent = element.parentElement
  let depth = 0
  while (parent && depth < 6) {
    // Check for heading siblings before this element
    const headings = parent.querySelectorAll('h1, h2, h3, h4, h5, h6')
    for (const h of headings) {
      if (h.textContent) return h.textContent.trim().toLowerCase().slice(0, 100)
    }
    parent = parent.parentElement
    depth++
  }
  return ''
}

function findNearbyButtonText(element: HTMLElement): string {
  const form = element.closest('form')
  if (!form) return ''

  const buttons = form.querySelectorAll(
    'button[type="submit"], input[type="submit"], button:not([type])',
  )
  const texts: string[] = []
  for (const btn of buttons) {
    const text = btn instanceof HTMLInputElement ? btn.value : btn.textContent
    if (text) texts.push(text.trim().toLowerCase())
  }
  return texts.join(' | ').slice(0, 200)
}

function resolveAriaDescription(element: HTMLElement): string {
  const describedBy = element.getAttribute('aria-describedby')
  if (!describedBy) return ''

  const ids = describedBy.split(/\s+/)
  const texts: string[] = []
  for (const id of ids) {
    const el = document.getElementById(id)
    if (el?.textContent) texts.push(el.textContent.trim().toLowerCase())
  }
  return texts.join(' ').slice(0, 200)
}

function getPageLanguage(): string {
  const htmlLang = document.documentElement.lang
  if (htmlLang) return htmlLang.toLowerCase().split('-')[0]

  const meta = document.querySelector('meta[http-equiv="content-language"]')
  if (meta) {
    const content = meta.getAttribute('content')
    if (content) return content.toLowerCase().split('-')[0]
  }

  return ''
}
