// ============================================================================
// WRVault Autofill — Field Scanner (Matching Engine)
// ============================================================================
//
// Detects which page DOM fields map to which vault FieldKinds by scoring
// every input/select/textarea against the FIELD_REGISTRY signal table.
//
// Public API:
//   collectCandidates(toggles)  → ScanResult  (full-page scan)
//   scoreCandidate(element)     → ElementScore (single element)
//   pickBestMapping(scores, profiles) → FieldMapping[]
//
// Performance:
//   - Initial scan: one querySelectorAll + O(n × k) scoring
//     where n = number of fields, k = number of fillable FieldKinds (~25)
//   - Incremental: MutationObserver calls rescanElement() on new/changed nodes
//   - Label resolution cached per scan cycle (Map<element, text>)
//   - Form context cached per <form> (Map<form, FormContext>)
//   - Throttled: at most one full scan per SCAN_THROTTLE_MS (2s)
//
// Security:
//   - Cross-origin iframes are detected and excluded
//   - Hidden inputs (type=hidden) are hard-blocked before scoring
//   - Anti-signals apply negative weight to suppress false positives
//   - Threshold is fail-closed: default deny below CONFIDENCE_THRESHOLD (60)
// ============================================================================

import type {
  FieldKind,
  DOMSignal,
  FieldSignalSpec,
  FormContext,
  VaultProfile,
  FieldEntry,
  AutofillSectionToggles,
} from '../../../../../packages/shared/src/vault/fieldTaxonomy'
import {
  FILLABLE_FIELDS,
  ANTI_SIGNALS,
  FORM_CONTEXT_SIGNALS,
  CONFIDENCE_THRESHOLD,
  CONFIDENCE_HINT_THRESHOLD,
  MAX_SIGNALS_PER_ELEMENT,
} from '../../../../../packages/shared/src/vault/fieldTaxonomy'
import type {
  FieldCandidate,
  MatchResult,
  FiredSignal,
} from '../../../../../packages/shared/src/vault/insertionPipeline'
import {
  BLOCKED_INPUT_TYPES,
  VALID_TARGET_TAGS,
  SCAN_THROTTLE_MS,
  MUTATION_RESCAN_DEBOUNCE_MS,
} from '../../../../../packages/shared/src/vault/insertionPipeline'

// ============================================================================
// §1  Types
// ============================================================================

/** Full-page scan result with caching metadata. */
export interface ScanResult {
  /** All candidate fields above CONFIDENCE_THRESHOLD. */
  candidates: FieldCandidate[]
  /** Fields between HINT threshold and CONFIDENCE threshold (debug only). */
  hints: FieldCandidate[]
  /** Inferred form context for the primary form on the page. */
  formContext: FormContext
  /** Page domain at scan time. */
  domain: string
  /** Timestamp of the scan. */
  scannedAt: number
  /** Number of elements evaluated. */
  elementsEvaluated: number
  /** Time taken in ms. */
  durationMs: number
}

/** Score result for a single element against all FieldKinds. */
export interface ElementScore {
  /** The DOM element that was scored. */
  element: HTMLElement
  /** Best match with full signal detail. */
  best: MatchResult
  /** All FieldKind scores (for debugging; sorted descending by confidence). */
  allScores: Array<{ kind: FieldKind; confidence: number }>
  /** Whether the element is in a cross-origin iframe. */
  crossOrigin: boolean
  /** Ordinal index in its form. */
  formIndex: number
  /** Detected form context. */
  formContext: FormContext
}

/** A resolved mapping: vault profile field → page DOM element. */
export interface FieldMapping {
  /** The FieldKind from the vault profile. */
  kind: FieldKind
  /** The FieldEntry from the matched VaultProfile. */
  field: FieldEntry
  /** The page element to fill. */
  element: HTMLElement
  /** Confidence score for this mapping. */
  confidence: number
  /** Why this mapping was chosen (top signals that fired). */
  reasons: string[]
  /** Whether this mapping is ambiguous (close runner-up). */
  ambiguous: boolean
}

/** Configuration for the scan cycle. */
export interface ScanConfig {
  /** Root element to scan within (default: document.body). */
  root?: HTMLElement
  /** Maximum elements to evaluate per scan (performance guard). */
  maxElements?: number
  /** Whether to include select and textarea (default: true). */
  includeSelectTextarea?: boolean
}

const DEFAULT_SCAN_CONFIG: Required<ScanConfig> = {
  root: document.body,
  maxElements: 200,
  includeSelectTextarea: true,
}

// ============================================================================
// §2  Caches (reset per scan cycle)
// ============================================================================

/** Label text cache: element → resolved label text. */
let _labelCache: WeakMap<HTMLElement, string> = new WeakMap()

/** Form context cache: form element → detected FormContext. */
let _formContextCache: WeakMap<HTMLFormElement, FormContext> = new WeakMap()

/** Last full scan timestamp for throttling. */
let _lastScanAt = 0

/** Cached scan result for throttle window. */
let _cachedScanResult: ScanResult | null = null

/** MutationObserver instance for incremental updates. */
let _observer: MutationObserver | null = null

/** Debounce timer for mutation-triggered rescans. */
let _mutationTimer: ReturnType<typeof setTimeout> | null = null

/** Callback registered by the pipeline orchestrator. */
let _onFieldsChanged: ((result: ScanResult) => void) | null = null

// ============================================================================
// §3  collectCandidates — Full Page Scan
// ============================================================================

/**
 * Scan the page DOM for fillable fields and score each against the
 * FIELD_REGISTRY.
 *
 * Returns candidates (above threshold) and hints (between hint and
 * threshold, for debug tooling).
 *
 * Respects section toggles: if a section is disabled, its FieldKinds
 * are excluded from scoring (performance optimization + user intent).
 *
 * Throttled: returns cached result if called within SCAN_THROTTLE_MS
 * of the last scan.
 */
export function collectCandidates(
  toggles: AutofillSectionToggles,
  config: ScanConfig = {},
): ScanResult {
  const now = Date.now()
  const cfg = { ...DEFAULT_SCAN_CONFIG, ...config }

  // Throttle: return cached result if within throttle window
  if (_cachedScanResult && now - _lastScanAt < SCAN_THROTTLE_MS) {
    return _cachedScanResult
  }

  const startTime = performance.now()

  // Reset per-cycle caches
  _labelCache = new WeakMap()
  _formContextCache = new WeakMap()

  // Build the set of FieldKinds we'll score against
  const activeSpecs = getActiveSpecs(toggles)

  // Query all candidate elements
  const selector = cfg.includeSelectTextarea
    ? 'input, select, textarea'
    : 'input'
  const root = cfg.root ?? document.body
  const allElements = root.querySelectorAll<HTMLElement>(selector)

  const candidates: FieldCandidate[] = []
  const hints: FieldCandidate[] = []
  let evalCount = 0
  let primaryFormContext: FormContext = 'unknown'

  for (let i = 0; i < allElements.length && evalCount < cfg.maxElements; i++) {
    const el = allElements[i]

    // Hard-block: invalid tag or blocked input type
    if (!VALID_TARGET_TAGS.has(el.tagName)) continue
    const inputType = ((el as HTMLInputElement).type ?? '').toLowerCase()
    if (BLOCKED_INPUT_TYPES.has(inputType)) continue

    // Hard-block: zero-size (likely hidden trick)
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) continue

    // Detect cross-origin (content scripts only run in same-origin, but check defensively)
    const crossOrigin = isCrossOriginElement(el)

    // Detect form context (cached per <form>)
    const formContext = detectFormContext(el)
    if (primaryFormContext === 'unknown' && formContext !== 'unknown') {
      primaryFormContext = formContext
    }

    // Detect ordinal index within form
    const formIndex = getFormIndex(el)

    // Score against all active FieldKinds
    const score = scoreElementAgainstSpecs(el, activeSpecs, formContext)
    evalCount++

    const candidate: FieldCandidate = {
      element: el,
      matchedKind: score.bestKind,
      match: score,
      fingerprint: null as any, // Fingerprint taken later by overlayManager
      crossOrigin,
      formIndex,
      formContext,
    }

    if (score.accepted && !crossOrigin) {
      candidates.push(candidate)
    } else if (score.confidence >= CONFIDENCE_HINT_THRESHOLD && !crossOrigin) {
      hints.push(candidate)
    }
  }

  const durationMs = performance.now() - startTime
  _lastScanAt = now

  const result: ScanResult = {
    candidates,
    hints,
    formContext: primaryFormContext,
    domain: window.location.origin,
    scannedAt: now,
    elementsEvaluated: evalCount,
    durationMs,
  }

  _cachedScanResult = result
  return result
}

/**
 * Force-invalidate the scan cache.
 * Called by the MutationObserver when the DOM changes, or manually
 * when the user opens QuickSelect (needs fresh results).
 */
export function invalidateScanCache(): void {
  _cachedScanResult = null
  _lastScanAt = 0
}

// ============================================================================
// §4  scoreCandidate — Single Element Scoring
// ============================================================================

/**
 * Score a single DOM element against ALL fillable FieldKinds.
 *
 * Use this for:
 *   - Re-scoring a single element after DOM mutation
 *   - Manual QuickSelect targeting (score the focused element)
 *   - Debug inspection
 */
export function scoreCandidate(element: HTMLElement): ElementScore {
  const formContext = detectFormContext(element)
  const best = scoreElementAgainstSpecs(element, FILLABLE_FIELDS, formContext)
  const crossOrigin = isCrossOriginElement(element)

  // Build allScores by running each spec individually
  const allScores: Array<{ kind: FieldKind; confidence: number }> = []
  for (const spec of FILLABLE_FIELDS) {
    const score = scoreElementAgainstSingleSpec(element, spec, formContext)
    allScores.push({ kind: spec.kind, confidence: score })
  }
  allScores.sort((a, b) => b.confidence - a.confidence)

  return {
    element,
    best,
    allScores,
    crossOrigin,
    formIndex: getFormIndex(element),
    formContext,
  }
}

// ============================================================================
// §5  pickBestMapping — Profile-to-Page Field Assignment
// ============================================================================

/**
 * Given a set of scored page candidates and one or more VaultProfiles,
 * produce the optimal mapping: which vault field goes into which page field.
 *
 * Algorithm:
 *   1. For each candidate, find the vault fields that match its detected kind.
 *   2. Build a bipartite graph: (candidate, vaultField) → confidence.
 *   3. Greedy assignment: highest confidence first, each page element and
 *      vault field used at most once.
 *   4. Reject any mapping below CONFIDENCE_THRESHOLD.
 *   5. Flag ambiguous mappings (runner-up within 15 points).
 *
 * When multiple profiles are available, the first match from the
 * domain-specific profile wins; global profiles are fallback only.
 */
export function pickBestMapping(
  candidates: FieldCandidate[],
  profiles: VaultProfile[],
): FieldMapping[] {
  // Build pairs: (candidate, profileField) scored by candidate.match.confidence
  const pairs: Array<{
    candidate: FieldCandidate
    field: FieldEntry
    confidence: number
    profilePriority: number // 0 = domain-specific, 1 = global
    reasons: string[]
    ambiguous: boolean
  }> = []

  for (const candidate of candidates) {
    if (!candidate.matchedKind || !candidate.match.accepted) continue

    for (let pi = 0; pi < profiles.length; pi++) {
      const profile = profiles[pi]
      const profilePriority = profile.domain ? 0 : 1

      for (const field of profile.fields) {
        if (field.kind !== candidate.matchedKind) continue

        // Build human-readable reasons from top fired signals
        const reasons = candidate.match.signals
          .filter(s => s.matched && s.contribution > 0)
          .sort((a, b) => b.contribution - a.contribution)
          .slice(0, 3)
          .map(s => `${s.source}="${s.pattern}" (+${s.contribution})`)

        if (candidate.match.contextBoost > 0) {
          reasons.push(`form_context boost (+${candidate.match.contextBoost})`)
        }

        pairs.push({
          candidate,
          field,
          confidence: candidate.match.confidence,
          profilePriority,
          reasons,
          ambiguous: isAmbiguous(candidate.match),
        })
      }
    }
  }

  // Sort: highest confidence first, domain-specific profiles first
  pairs.sort((a, b) => {
    if (a.profilePriority !== b.profilePriority) return a.profilePriority - b.profilePriority
    return b.confidence - a.confidence
  })

  // Greedy assignment: each element and field used at most once
  const usedElements = new Set<unknown>()
  const usedFields = new Set<FieldEntry>()
  const mappings: FieldMapping[] = []

  for (const pair of pairs) {
    if (usedElements.has(pair.candidate.element)) continue
    if (usedFields.has(pair.field)) continue
    if (pair.confidence < CONFIDENCE_THRESHOLD) continue

    usedElements.add(pair.candidate.element)
    usedFields.add(pair.field)

    mappings.push({
      kind: pair.field.kind,
      field: pair.field,
      element: pair.candidate.element as HTMLElement,
      confidence: pair.confidence,
      reasons: pair.reasons,
      ambiguous: pair.ambiguous,
    })
  }

  return mappings
}

/** A match is ambiguous if the runner-up is within 15 points. */
function isAmbiguous(match: MatchResult): boolean {
  if (!match.runnerUp) return false
  return Math.abs(match.confidence - match.runnerUpConfidence) < 15
}

// ============================================================================
// §6  Core Scoring Engine
// ============================================================================

/**
 * Score one element against a list of FieldSignalSpecs.
 * Returns the best MatchResult (highest confidence) with full signal detail.
 */
function scoreElementAgainstSpecs(
  element: HTMLElement,
  specs: readonly FieldSignalSpec[],
  formContext: FormContext,
): MatchResult {
  let bestKind: FieldKind | null = null
  let bestConfidence = -Infinity
  let bestSignals: FiredSignal[] = []
  let bestAntiSignals: FiredSignal[] = []
  let bestContextBoost = 0

  let runnerUp: FieldKind | null = null
  let runnerUpConfidence = -Infinity

  // Pre-extract element attributes (once per element, used by all specs)
  const attrs = extractAttributes(element)

  // Evaluate anti-signals (applied globally)
  const antiResults = evaluateAntiSignals(attrs)
  const antiWeight = antiResults.reduce((sum, s) => sum + s.contribution, 0)

  for (const spec of specs) {
    const rawScore = evaluateSpec(attrs, spec, formContext)
    const totalScore = rawScore.score + antiWeight

    if (totalScore > bestConfidence) {
      // Demote current best to runner-up
      if (bestKind !== null) {
        runnerUp = bestKind
        runnerUpConfidence = bestConfidence
      }
      bestKind = spec.kind
      bestConfidence = totalScore
      bestSignals = rawScore.signals
      bestAntiSignals = antiResults
      bestContextBoost = rawScore.contextBoost
    } else if (totalScore > runnerUpConfidence) {
      runnerUp = spec.kind
      runnerUpConfidence = totalScore
    }
  }

  return {
    confidence: Math.max(0, bestConfidence),
    accepted: bestConfidence >= CONFIDENCE_THRESHOLD,
    bestKind: bestConfidence >= CONFIDENCE_HINT_THRESHOLD ? bestKind : null,
    runnerUp,
    runnerUpConfidence: Math.max(0, runnerUpConfidence),
    signals: bestSignals,
    antiSignals: bestAntiSignals,
    contextBoost: bestContextBoost,
  }
}

/** Score one element against a single FieldSignalSpec. Returns raw confidence number. */
function scoreElementAgainstSingleSpec(
  element: HTMLElement,
  spec: FieldSignalSpec,
  formContext: FormContext,
): number {
  const attrs = extractAttributes(element)
  const antiResults = evaluateAntiSignals(attrs)
  const antiWeight = antiResults.reduce((sum, s) => sum + s.contribution, 0)
  const rawScore = evaluateSpec(attrs, spec, formContext)
  return Math.max(0, rawScore.score + antiWeight)
}

// ============================================================================
// §7  Signal Evaluation
// ============================================================================

/** Pre-extracted attributes from a DOM element (extracted once, reused). */
interface ElementAttributes {
  tagName: string
  inputType: string
  name: string
  id: string
  autocomplete: string
  inputMode: string
  ariaAutocomplete: string
  labelText: string // resolved from <label>, aria-label, placeholder, title
}

/** Extract all relevant attributes from an element (cached per scan cycle for labels). */
function extractAttributes(element: HTMLElement): ElementAttributes {
  const input = element as HTMLInputElement
  return {
    tagName: element.tagName,
    inputType: (input.type ?? '').toLowerCase(),
    name: (input.name ?? '').toLowerCase(),
    id: (element.id ?? '').toLowerCase(),
    autocomplete: (element.getAttribute('autocomplete') ?? '').toLowerCase(),
    inputMode: (element.getAttribute('inputmode') ?? '').toLowerCase(),
    ariaAutocomplete: (element.getAttribute('aria-autocomplete') ?? '').toLowerCase(),
    labelText: resolveLabel(element),
  }
}

/**
 * Evaluate all signals for one FieldSignalSpec against pre-extracted attributes.
 *
 * Stops early on authoritative match (performance optimization).
 */
function evaluateSpec(
  attrs: ElementAttributes,
  spec: FieldSignalSpec,
  formContext: FormContext,
): { score: number; signals: FiredSignal[]; contextBoost: number } {
  let score = 0
  const signals: FiredSignal[] = []
  let signalsEvaluated = 0
  let contextBoost = 0

  for (const signal of spec.signals) {
    if (signalsEvaluated >= MAX_SIGNALS_PER_ELEMENT) break

    const matched = matchSignal(attrs, signal, formContext)
    const contribution = matched ? signal.weight : 0
    signalsEvaluated++

    signals.push({
      source: signal.source,
      pattern: signal.pattern,
      matched,
      contribution,
    })

    if (matched) {
      score += signal.weight
      if (signal.source === 'form_context') {
        contextBoost += signal.weight
      }
      // Early exit on authoritative signal
      if (signal.authoritative) break
    }
  }

  return { score, signals, contextBoost }
}

/** Evaluate anti-signals against an element. Returns all fired anti-signals. */
function evaluateAntiSignals(attrs: ElementAttributes): FiredSignal[] {
  const results: FiredSignal[] = []

  for (const signal of ANTI_SIGNALS) {
    const matched = matchAntiSignal(attrs, signal)
    if (matched) {
      results.push({
        source: signal.source,
        pattern: signal.pattern,
        matched: true,
        contribution: signal.weight, // negative
      })
    }
  }

  return results
}

/** Match a single signal against pre-extracted attributes. */
function matchSignal(
  attrs: ElementAttributes,
  signal: DOMSignal,
  formContext: FormContext,
): boolean {
  switch (signal.source) {
    case 'autocomplete':
      return attrs.autocomplete === signal.pattern

    case 'input_type':
      return attrs.inputType === signal.pattern

    case 'name_id': {
      const regex = new RegExp(signal.pattern, 'i')
      return regex.test(attrs.name) || regex.test(attrs.id)
    }

    case 'label_text': {
      if (!attrs.labelText) return false
      const keywords = signal.pattern.split('|')
      const lower = attrs.labelText
      return keywords.some(kw => lower.includes(kw))
    }

    case 'form_context':
      return formContext === signal.pattern

    case 'input_mode':
      return attrs.inputMode === signal.pattern

    case 'aria_autocomplete':
      return attrs.ariaAutocomplete === signal.pattern

    case 'field_position':
      return false // Not implemented yet (requires positional analysis)

    default:
      return false
  }
}

/** Match an anti-signal. */
function matchAntiSignal(attrs: ElementAttributes, signal: DOMSignal): boolean {
  switch (signal.source) {
    case 'input_type':
      return attrs.inputType === signal.pattern

    case 'name_id': {
      // Anti-signal patterns are stored as regex strings with slashes
      const patternBody = signal.pattern.replace(/^\/|\/[a-z]*$/g, '')
      const flags = signal.pattern.match(/\/([a-z]*)$/)?.[1] ?? 'i'
      try {
        const regex = new RegExp(patternBody, flags)
        return regex.test(attrs.name) || regex.test(attrs.id)
      } catch {
        return false
      }
    }

    case 'label_text': {
      if (!attrs.labelText) return false
      const keywords = signal.pattern.split('|')
      return keywords.some(kw => attrs.labelText.includes(kw))
    }

    default:
      return false
  }
}

// ============================================================================
// §8  Label Resolution
// ============================================================================

/**
 * Resolve the human-readable label text for an input element.
 *
 * Lookup order:
 *   1. <label for="id"> text content
 *   2. Closest ancestor <label> text content
 *   3. aria-label attribute
 *   4. aria-labelledby → referenced element text
 *   5. placeholder attribute
 *   6. title attribute
 *
 * Result is lowercased, trimmed, and collapsed whitespace.
 * Cached per scan cycle via WeakMap.
 */
function resolveLabel(element: HTMLElement): string {
  const cached = _labelCache.get(element)
  if (cached !== undefined) return cached

  let label = ''

  // 1. <label for="id">
  if (element.id) {
    const forLabel = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(element.id)}"]`)
    if (forLabel) {
      label = forLabel.textContent ?? ''
    }
  }

  // 2. Closest ancestor <label>
  if (!label) {
    const parentLabel = element.closest('label')
    if (parentLabel) {
      label = parentLabel.textContent ?? ''
    }
  }

  // 3. aria-label
  if (!label) {
    label = element.getAttribute('aria-label') ?? ''
  }

  // 4. aria-labelledby
  if (!label) {
    const labelledBy = element.getAttribute('aria-labelledby')
    if (labelledBy) {
      const ids = labelledBy.split(/\s+/)
      const texts = ids.map(id => document.getElementById(id)?.textContent ?? '').filter(Boolean)
      label = texts.join(' ')
    }
  }

  // 5. placeholder
  if (!label) {
    label = (element as HTMLInputElement).placeholder ?? ''
  }

  // 6. title
  if (!label) {
    label = element.title ?? ''
  }

  // Normalize
  const normalized = label.toLowerCase().trim().replace(/\s+/g, ' ')
  _labelCache.set(element, normalized)
  return normalized
}

// ============================================================================
// §9  Form Context Detection
// ============================================================================

/**
 * Detect the form context for an element's enclosing <form>.
 *
 * Inspects (in order):
 *   1. form.action URL
 *   2. form.id + form.className
 *   3. Submit button text within the form
 *
 * Cached per <form> element.
 */
function detectFormContext(element: HTMLElement): FormContext {
  const form = element.closest('form') as HTMLFormElement | null
  if (!form) return 'unknown'

  const cached = _formContextCache.get(form)
  if (cached !== undefined) return cached

  // Collect text to test against
  const signals = [
    form.action ?? '',
    form.id ?? '',
    form.className ?? '',
  ]

  // Submit button text
  const submitBtn = form.querySelector<HTMLElement>(
    'button[type="submit"], input[type="submit"], button:not([type])',
  )
  if (submitBtn) {
    signals.push(submitBtn.textContent ?? '')
    signals.push((submitBtn as HTMLInputElement).value ?? '')
  }

  const combined = signals.join(' ')

  for (const ctx of FORM_CONTEXT_SIGNALS) {
    if (ctx.pattern.test(combined)) {
      _formContextCache.set(form, ctx.context)
      return ctx.context
    }
  }

  _formContextCache.set(form, 'unknown')
  return 'unknown'
}

// ============================================================================
// §10  Cross-Origin Detection
// ============================================================================

/**
 * Check if an element is inside a cross-origin iframe.
 * Content scripts only execute in same-origin frames, so this is defensive.
 */
function isCrossOriginElement(element: HTMLElement): boolean {
  try {
    const ownerDoc = element.ownerDocument
    if (!ownerDoc) return true
    const win = ownerDoc.defaultView
    if (!win) return true
    // If we can read the origin, it's same-origin
    const _origin = win.location.origin
    return false
  } catch {
    return true
  }
}

// ============================================================================
// §11  Form Index
// ============================================================================

/** Get the ordinal index of an element within its enclosing form. */
function getFormIndex(element: HTMLElement): number {
  const form = element.closest('form')
  if (!form) return 0

  const inputs = form.querySelectorAll('input, select, textarea')
  for (let i = 0; i < inputs.length; i++) {
    if (inputs[i] === element) return i
  }
  return 0
}

// ============================================================================
// §12  Active Specs Filter
// ============================================================================

/** Filter FILLABLE_FIELDS to only specs whose section is enabled. */
function getActiveSpecs(toggles: AutofillSectionToggles): readonly FieldSignalSpec[] {
  return FILLABLE_FIELDS.filter(spec => {
    const section = spec.section as keyof AutofillSectionToggles
    return toggles[section] === true
  })
}

// ============================================================================
// §13  MutationObserver — Incremental DOM Watching
// ============================================================================

/**
 * Start watching for DOM mutations that add/remove/modify form fields.
 *
 * When new fields appear (SPA navigation, dynamic form), a debounced
 * rescan is triggered.  The callback receives the updated ScanResult.
 *
 * Call stopWatching() to disconnect.
 */
export function startWatching(
  toggles: AutofillSectionToggles,
  callback: (result: ScanResult) => void,
): void {
  stopWatching()
  _onFieldsChanged = callback

  _observer = new MutationObserver((mutations) => {
    // Check if any mutation involves form fields
    let relevant = false
    for (const m of mutations) {
      if (m.type === 'childList') {
        for (const node of m.addedNodes) {
          if (isFormField(node) || containsFormFields(node)) {
            relevant = true
            break
          }
        }
        if (relevant) break
        for (const node of m.removedNodes) {
          if (isFormField(node) || containsFormFields(node)) {
            relevant = true
            break
          }
        }
      } else if (m.type === 'attributes' && isFormField(m.target)) {
        const attr = m.attributeName
        if (attr === 'type' || attr === 'name' || attr === 'id' || attr === 'autocomplete' || attr === 'disabled' || attr === 'hidden') {
          relevant = true
        }
      }
      if (relevant) break
    }

    if (!relevant) return

    // Debounce the rescan, invalidate cache so next scan is fresh
    if (_mutationTimer) clearTimeout(_mutationTimer)
    _mutationTimer = setTimeout(() => {
      invalidateScanCache()
      const result = collectCandidates(toggles)
      _onFieldsChanged?.(result)
    }, MUTATION_RESCAN_DEBOUNCE_MS)
  })

  _observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['type', 'name', 'id', 'autocomplete', 'disabled', 'hidden', 'style'],
  })
}

/** Stop the MutationObserver. */
export function stopWatching(): void {
  if (_observer) {
    _observer.disconnect()
    _observer = null
  }
  if (_mutationTimer) {
    clearTimeout(_mutationTimer)
    _mutationTimer = null
  }
  _onFieldsChanged = null
}

function isFormField(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return false
  const el = node as HTMLElement
  return VALID_TARGET_TAGS.has(el.tagName)
}

function containsFormFields(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return false
  const el = node as HTMLElement
  return el.querySelector?.('input, select, textarea') !== null
}
