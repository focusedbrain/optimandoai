// ============================================================================
// WRVault Autofill — DOM Fingerprint: Capture + Validate
// ============================================================================
//
// Implements the tamper-detection strategy defined in insertionPipeline.ts §2.3.
// A fingerprint is a lightweight structural snapshot of a DOM element, hashed
// for fast comparison.  If the fingerprint changes between overlay preview and
// commit, the fill is blocked.
//
// Properties captured:
//   tagName, inputType, name, id, autocomplete,
//   boundingRect (4px grid), computedVisibility, parentChain (3 ancestors),
//   frameOrigin, tabIndex, formAction
//
// Hash: SHA-256 truncated to 16 hex chars via SubtleCrypto.
// ============================================================================

import type {
  DOMFingerprint,
  DOMFingerprintProperties,
  FingerprintValidation,
  FingerprintInvalidReason,
} from '../../../../../packages/shared/src/vault/insertionPipeline'
import {
  FINGERPRINT_MAX_AGE_MS,
  RECT_TOLERANCE_PX,
} from '../../../../../packages/shared/src/vault/insertionPipeline'

// ============================================================================
// §1  Capture
// ============================================================================

/**
 * Take a structural fingerprint of a DOM element.
 *
 * Call this at overlay-creation time.  The returned DOMFingerprint is
 * stored on the OverlayTarget and re-checked at commit time.
 */
export async function takeFingerprint(
  element: HTMLElement,
  maxAge: number = FINGERPRINT_MAX_AGE_MS,
): Promise<DOMFingerprint> {
  const properties = captureProperties(element)
  const hash = await hashProperties(properties)
  return {
    hash,
    capturedAt: Date.now(),
    maxAge,
    properties,
  }
}

/**
 * Capture the raw fingerprint properties from a DOM element.
 * Pure DOM reads — no side effects.
 */
export function captureProperties(element: HTMLElement): DOMFingerprintProperties {
  const rect = element.getBoundingClientRect()
  const computed = getComputedStyle(element)
  const input = element as HTMLInputElement

  return {
    tagName: element.tagName,
    inputType: input.type ?? '',
    name: input.name ?? element.getAttribute('name') ?? '',
    id: element.id ?? '',
    autocomplete: element.getAttribute('autocomplete') ?? '',
    rect: {
      top:    roundToGrid(rect.top),
      left:   roundToGrid(rect.left),
      width:  roundToGrid(rect.width),
      height: roundToGrid(rect.height),
    },
    visibility: {
      display:    computed.display,
      visibility: computed.visibility,
      opacity:    computed.opacity,
    },
    parentChain: buildParentChain(element, 3),
    frameOrigin: getFrameOrigin(),
    tabIndex:    element.tabIndex,
    formAction:  getFormAction(element),
  }
}

// ============================================================================
// §2  Validate
// ============================================================================

/**
 * Validate a previously captured fingerprint against the current state
 * of the element.
 *
 * Returns { valid: true } if all checks pass, or { valid: false, reasons }
 * enumerating every failure.
 *
 * This is the core tamper-detection gate — called immediately before commit.
 */
export async function validateFingerprint(
  fingerprint: DOMFingerprint,
  element: HTMLElement,
): Promise<FingerprintValidation> {
  const reasons: FingerprintInvalidReason[] = []

  // 1. Expiry check (no DOM access needed)
  if (Date.now() - fingerprint.capturedAt > fingerprint.maxAge) {
    reasons.push('expired')
  }

  // 2. Element still in DOM?
  if (!element || !element.isConnected) {
    reasons.push('element_detached')
    return { valid: false, reasons }
  }

  // 3. Visibility check
  const computed = getComputedStyle(element)
  if (
    computed.display === 'none' ||
    computed.visibility === 'hidden' ||
    parseFloat(computed.opacity) < 0.01
  ) {
    reasons.push('element_hidden')
  }

  // 4. Bounding rect stability (tolerance-aware)
  const rect = element.getBoundingClientRect()
  const fp = fingerprint.properties.rect
  if (
    Math.abs(roundToGrid(rect.top) - fp.top) > RECT_TOLERANCE_PX ||
    Math.abs(roundToGrid(rect.left) - fp.left) > RECT_TOLERANCE_PX ||
    Math.abs(roundToGrid(rect.width) - fp.width) > RECT_TOLERANCE_PX ||
    Math.abs(roundToGrid(rect.height) - fp.height) > RECT_TOLERANCE_PX
  ) {
    reasons.push('element_moved')
  }

  // 5. Frame origin
  if (getFrameOrigin() !== fingerprint.properties.frameOrigin) {
    reasons.push('frame_origin_changed')
  }

  // 6. Full hash comparison (catches everything else: name, id, type, parent changes)
  const currentProps = captureProperties(element)
  const currentHash = await hashProperties(currentProps)
  if (currentHash !== fingerprint.hash) {
    // Only add hash_mismatch if we haven't already identified the specific cause
    if (!reasons.includes('element_moved') && !reasons.includes('element_hidden')) {
      reasons.push('hash_mismatch')
    }
  }

  return {
    valid: reasons.length === 0,
    reasons,
  }
}

// ============================================================================
// §3  Helpers
// ============================================================================

/** Round a pixel value to a grid for jitter tolerance. */
function roundToGrid(value: number): number {
  return Math.round(value / RECT_TOLERANCE_PX) * RECT_TOLERANCE_PX
}

/** Build a parent chain string: "DIV.form-group > FORM.login > BODY" */
function buildParentChain(element: HTMLElement, depth: number): string {
  const parts: string[] = []
  let current: HTMLElement | null = element.parentElement
  for (let i = 0; i < depth && current; i++) {
    const tag = current.tagName
    const cls = current.className
      ? '.' + current.className.toString().trim().split(/\s+/).slice(0, 2).join('.')
      : ''
    parts.push(tag + cls)
    current = current.parentElement
  }
  return parts.join(' > ')
}

/** Get the origin of the frame containing this element. */
function getFrameOrigin(): string {
  try {
    return window.location.origin
  } catch {
    return 'cross-origin'
  }
}

/** Get the action URL of the enclosing <form>, if any. */
function getFormAction(element: HTMLElement): string {
  const form = element.closest('form')
  return form?.action ?? ''
}

/**
 * SHA-256 hash of the properties, truncated to 16 hex chars.
 * Uses SubtleCrypto for speed (native implementation).
 */
async function hashProperties(props: DOMFingerprintProperties): Promise<string> {
  const json = JSON.stringify(props)
  const data = new TextEncoder().encode(json)
  const buffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(buffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}
