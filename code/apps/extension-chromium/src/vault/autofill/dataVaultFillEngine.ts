// ============================================================================
// WRVault DataVault — Fill Engine (PII/Company Field Injection)
// ============================================================================
//
// Fills detected identity/company form fields with values from a DataVault
// profile.  This engine is framework-friendly and never submits forms.
//
// Key behaviours:
//   - Re-validates each element before filling (isConnected, visible, etc.)
//   - Uses native property setter to bypass React/Vue controlled inputs
//   - Dispatches input + change events for framework state sync
//   - Skips readonly/disabled fields
//   - Does NOT overwrite non-empty fields by default
//   - Handles address composition (street + house_number for single-line)
//   - Handles <select> by value or normalized text matching
//   - NEVER submits forms or clicks buttons
//
// Public API:
//   fillSingleField(element, value)                   → FillFieldResult
//   fillAllMatchedFields(candidates, fieldMap, opts)   → FillAllResult
//
// ============================================================================

import type { FieldCandidate } from '../../../../../packages/shared/src/vault/insertionPipeline'
import type { FieldKind } from '../../../../../packages/shared/src/vault/fieldTaxonomy'

// ============================================================================
// §1  Types
// ============================================================================

export interface FillFieldResult {
  success: boolean
  skipped: boolean
  reason?: string
}

export interface FillAllResult {
  filled: number
  skipped: number
  failed: number
  details: Array<{
    vaultKey: FieldKind
    result: FillFieldResult
  }>
}

export interface FillOptions {
  /** Overwrite fields that already have non-empty values. Default: false. */
  overwriteExisting?: boolean
  /** Minimum confidence to fill.  Default: 60. */
  minConfidence?: number
}

// ============================================================================
// §2  Single Field Fill
// ============================================================================

/**
 * Fill a single DOM element with a value.
 *
 * Uses the native property setter pattern to work with React/Vue/Angular
 * controlled inputs.  Dispatches `input` and `change` events.
 *
 * NEVER submits forms.
 *
 * Re-validation: Before writing, re-checks that the element is still
 * connected, visible, and structurally unchanged enough to be safe.
 */
export function fillSingleField(
  element: HTMLElement,
  value: string,
  overwriteExisting = false,
): FillFieldResult {
  // ── Stage 1: Pre-fill validation ──

  if (!element || !document.contains(element)) {
    return { success: false, skipped: false, reason: 'element_detached' }
  }

  const el = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

  if (el.disabled || el.readOnly) {
    return { success: false, skipped: true, reason: 'readonly_or_disabled' }
  }

  // Check visibility (zero-size = hidden)
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) {
    return { success: false, skipped: true, reason: 'not_visible' }
  }

  // Check if field already has value
  const currentValue = getElementValue(el)
  if (currentValue && !overwriteExisting) {
    return { success: false, skipped: true, reason: 'has_existing_value' }
  }

  // ── Stage 2: Re-validate DOM before writing ──
  // Re-check that the element is still connected and hasn't been swapped.
  // This guards against TOCTOU attacks where the DOM is mutated between
  // candidate detection and fill execution.

  const revalidation = revalidateElement(el)
  if (!revalidation.valid) {
    return { success: false, skipped: false, reason: revalidation.reason }
  }

  // Handle <select> elements
  if (el.tagName === 'SELECT') {
    focusBeforeFill(el)
    return fillSelectElement(el as HTMLSelectElement, value)
  }

  // Use native property setter for React/Vue compatibility.
  // Focus → set value → dispatch events mimics real user interaction so
  // floating labels and placeholder overlays hide properly.
  try {
    focusBeforeFill(el)
    setNativeValue(el as HTMLInputElement | HTMLTextAreaElement, value)
    dispatchFillEvents(el)
    return { success: true, skipped: false }
  } catch {
    return { success: false, skipped: false, reason: 'value_dispatch_failed' }
  }
}

// ============================================================================
// §3  Multi-Field Fill (Auto Mode)
// ============================================================================

/**
 * Fill all matched fields in a form group from a DataVault profile field map.
 *
 * Only fills fields that:
 *   - Have a matchedKind in the fieldMap
 *   - Have confidence >= minConfidence
 *   - Are connected, visible, and not disabled/readonly
 *   - Are not already filled (unless overwriteExisting = true)
 *
 * Handles address composition:
 *   - If vault has street + street_number but page has only one address field,
 *     compose "street house_number" into that field.
 *
 * NEVER submits forms.
 */
export function fillAllMatchedFields(
  candidates: FieldCandidate[],
  fieldMap: Map<FieldKind, string>,
  options: FillOptions = {},
): FillAllResult {
  const overwrite = options.overwriteExisting ?? false
  const minConf = options.minConfidence ?? 60

  const result: FillAllResult = {
    filled: 0,
    skipped: 0,
    failed: 0,
    details: [],
  }

  // Track which FieldKinds have dedicated page fields (for address composition)
  const hasField = new Set<FieldKind>()
  for (const c of candidates) {
    if (c.matchedKind && c.match.confidence >= minConf) {
      hasField.add(c.matchedKind)
    }
  }

  for (const candidate of candidates) {
    const kind = candidate.matchedKind
    if (!kind) continue
    if (candidate.match.confidence < minConf) continue
    if (candidate.crossOrigin) continue

    const el = candidate.element as HTMLElement

    // Resolve value for this field kind
    let value = fieldMap.get(kind)

    // Address composition: if the page has a street field but no separate
    // street_number field, and the vault has both, compose them.
    if (!value) {
      value = resolveComposedValue(kind, fieldMap, hasField)
    }

    if (!value) {
      result.skipped++
      result.details.push({
        vaultKey: kind,
        result: { success: false, skipped: true, reason: 'no_value_in_profile' },
      })
      continue
    }

    const fillResult = fillSingleField(el, value, overwrite)

    if (fillResult.success) {
      result.filled++
    } else if (fillResult.skipped) {
      result.skipped++
    } else {
      result.failed++
    }

    result.details.push({ vaultKey: kind, result: fillResult })
  }

  return result
}

// ============================================================================
// §3.1  DOM Re-Validation (TOCTOU Defense)
// ============================================================================

interface RevalidationResult {
  valid: boolean
  reason: string
}

/**
 * Re-validate a DOM element immediately before writing a value.
 *
 * Guards against:
 *   - Element detachment (removed from DOM between detection and fill)
 *   - Attribute swaps (e.g., type changed from text to hidden)
 *   - Visibility changes (display:none, zero-size)
 *   - Cross-origin embeddings
 *
 * This is called AFTER the initial validation and BEFORE the actual write,
 * to close the TOCTOU gap between scanning and filling.
 */
function revalidateElement(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
): RevalidationResult {
  // 1. Still connected to the document?
  if (!document.contains(element)) {
    return { valid: false, reason: 'element_detached_on_revalidation' }
  }

  // 2. Type hasn't changed to a blocked type?
  const inputType = ((element as HTMLInputElement).type ?? '').toLowerCase()
  const blockedTypes = new Set([
    'hidden', 'submit', 'button', 'reset', 'image', 'file',
    'range', 'color', 'checkbox', 'radio',
  ])
  if (blockedTypes.has(inputType)) {
    return { valid: false, reason: 'type_changed_to_blocked' }
  }

  // 3. Still visible? (check computed style for display:none and visibility)
  try {
    const style = window.getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden') {
      return { valid: false, reason: 'hidden_via_style_on_revalidation' }
    }
  } catch {
    // getComputedStyle can throw in edge cases; allow through
  }

  // 4. Still has non-zero bounding rect?
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) {
    return { valid: false, reason: 'zero_size_on_revalidation' }
  }

  // 5. Not disabled/readonly (may have changed since initial check)?
  if (element.disabled || element.readOnly) {
    return { valid: false, reason: 'became_readonly_or_disabled' }
  }

  return { valid: true, reason: '' }
}

// ============================================================================
// §4  Address Composition
// ============================================================================

/**
 * If a page field matches `identity.street` but there's no separate
 * `identity.street_number` field, compose "street house_number".
 * Same logic for company address fields.
 */
function resolveComposedValue(
  kind: FieldKind,
  fieldMap: Map<FieldKind, string>,
  hasPageField: Set<FieldKind>,
): string | undefined {
  // Street + number composition for identity
  if (kind === 'identity.street' && !hasPageField.has('identity.street_number')) {
    const street = fieldMap.get('identity.street')
    const number = fieldMap.get('identity.street_number')
    if (street && number) return `${street} ${number}`
    if (street) return street
  }

  // Street + number composition for company
  if (kind === 'company.street' && !hasPageField.has('company.street_number')) {
    const street = fieldMap.get('company.street')
    const number = fieldMap.get('company.street_number')
    if (street && number) return `${street} ${number}`
    if (street) return street
  }

  // Full name composition
  if (kind === 'identity.full_name') {
    const first = fieldMap.get('identity.first_name')
    const last = fieldMap.get('identity.last_name')
    if (first && last) return `${first} ${last}`
    if (first) return first
    if (last) return last
  }

  return undefined
}

// ============================================================================
// §5  Native Value Setter (React/Vue/Angular compatible)
// ============================================================================

/**
 * Set a value using the native HTMLInputElement.prototype.value setter.
 * This bypasses React's synthetic event system which intercepts the
 * standard `.value = x` assignment.
 */
function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype

  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set

  if (nativeSetter) {
    nativeSetter.call(element, value)
  } else {
    element.value = value
  }
}

/**
 * Dispatch synthetic events to ensure frameworks pick up the value change
 * and the site's floating-label / placeholder-hiding logic activates.
 *
 * Sequence mirrors real user interaction:
 *   focusin → focus → (value set) → input → change → blur → focusout
 *
 * Many sites use CSS rules like `input:not(:placeholder-shown) + label`
 * or JS focus listeners to toggle inline label visibility. Without the
 * focus/blur cycle, the old label text stays visible on top of the
 * inserted value, making the field unreadable.
 */
function dispatchFillEvents(element: HTMLElement): void {
  element.dispatchEvent(new Event('input', { bubbles: true, cancelable: false }))
  element.dispatchEvent(new Event('change', { bubbles: true, cancelable: false }))
  element.dispatchEvent(new Event('blur', { bubbles: true, cancelable: false }))
  element.dispatchEvent(new FocusEvent('focusout', { bubbles: true, cancelable: false }))
}

/**
 * Focus the element before setting its value. This ensures CSS pseudo-class
 * rules (:focus, :not(:placeholder-shown)) and JS focus handlers fire
 * before the value is written.
 */
function focusBeforeFill(element: HTMLElement): void {
  try {
    element.dispatchEvent(new FocusEvent('focusin', { bubbles: true, cancelable: false }))
    element.dispatchEvent(new FocusEvent('focus', { bubbles: false, cancelable: false }))
    ;(element as HTMLInputElement).focus?.()
  } catch {
    // Non-fatal — some elements may not support focus
  }
}

// ============================================================================
// §6  Select Element Handling
// ============================================================================

/**
 * Fill a <select> element by matching option value or visible text.
 */
function fillSelectElement(select: HTMLSelectElement, value: string): FillFieldResult {
  const normalizedValue = value.toLowerCase().trim()

  // First try exact value match
  for (const option of select.options) {
    if (option.value.toLowerCase().trim() === normalizedValue) {
      select.value = option.value
      dispatchFillEvents(select)
      return { success: true, skipped: false }
    }
  }

  // Then try normalized text match
  for (const option of select.options) {
    const text = (option.textContent ?? '').toLowerCase().trim()
    if (text === normalizedValue) {
      select.value = option.value
      dispatchFillEvents(select)
      return { success: true, skipped: false }
    }
  }

  // Try partial text match (e.g. "Germany" matches "Germany (DE)")
  for (const option of select.options) {
    const text = (option.textContent ?? '').toLowerCase().trim()
    if (text.includes(normalizedValue) || normalizedValue.includes(text)) {
      if (text.length > 0) {
        select.value = option.value
        dispatchFillEvents(select)
        return { success: true, skipped: false }
      }
    }
  }

  return { success: false, skipped: false, reason: 'no_matching_option' }
}

// ============================================================================
// §7  Helpers
// ============================================================================

function getElementValue(element: HTMLElement): string {
  const el = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  return (el.value ?? '').trim()
}
