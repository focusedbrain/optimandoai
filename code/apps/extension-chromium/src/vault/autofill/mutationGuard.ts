// ============================================================================
// WRVault Autofill — Mutation Guard
// ============================================================================
//
// Prevents DOM swapping between overlay preview and commit (C-PIPE-01).
//
// The attack:  A malicious page detects the overlay and swaps the target
// <input> for a lookalike controlled element between the time the user
// clicks "Insert" and the time commitInsert() writes the value.  Without
// this guard, the password is injected into an attacker-controlled node
// that can be read via MutationObserver, onInput, or getter override.
//
// The defense:  When the overlay opens we capture a multi-signal snapshot
// of each target element, attach a MutationObserver to its subtree and
// ancestors, and poll the bounding rect.  If ANY of these signals fire
// before or during commit, the session is invalidated atomically and
// commitInsert() aborts.
//
// Public API:
//   attachGuard(session)  → MutationGuardHandle
//   checkGuard(handle)    → GuardStatus
//   detachGuard(handle)   → void
//
// Integration points:
//   - overlayManager.showOverlay:  call attachGuard() after mount
//   - committer.commitInsert:      call checkGuard() as gate 0
//   - overlayManager.teardownInternal:  call detachGuard()
//
// ============================================================================

import { auditLog, emitTelemetryEvent } from './hardening'

// ============================================================================
// §1  Types
// ============================================================================

/** Reason the guard tripped — each maps to a specific attack vector. */
export type GuardViolation =
  | 'element_removed'         // Target detached from DOM
  | 'element_replaced'        // Parent swapped (same position, different node)
  | 'attribute_mutated'       // name/id/type/autocomplete/form changed
  | 'parent_changed'          // parentElement is now different
  | 'ancestor_subtree_swap'   // ancestor's childList mutation removed our branch
  | 'bounding_rect_shifted'   // element moved >threshold px (CSS attack)
  | 'outer_html_changed'      // structural hash mismatch (deep swap)

/** Snapshot captured at guard attach time for one target element. */
interface ElementSnapshot {
  /** Direct reference (WeakRef to allow GC if page removes it). */
  ref: WeakRef<HTMLElement>
  /** Immediate parentElement at attach time. */
  parentRef: WeakRef<HTMLElement> | null
  /** Bounding rect at attach time (rounded to 4px grid). */
  rect: { top: number; left: number; width: number; height: number }
  /** Lightweight outerHTML hash (FNV-1a 32-bit — synchronous, no crypto). */
  outerHash: number
  /** Key attributes at attach time. */
  attrs: { name: string; id: string; type: string; autocomplete: string; form: string }
  /** Parent chain signature (tag.class > tag.class > ...). */
  parentChain: string
}

export interface GuardStatus {
  /** True if all targets are still valid. */
  valid: boolean
  /** Violations detected (empty if valid). */
  violations: Array<{ targetIndex: number; reason: GuardViolation }>
}

export interface MutationGuardHandle {
  /** Check the guard right now (synchronous + fast). */
  check: () => GuardStatus
  /** Detach all observers and timers. */
  detach: () => void
  /** Whether the guard has been tripped (latching — once tripped, stays tripped). */
  readonly tripped: boolean
  /** The violations that caused the trip (empty until tripped). */
  readonly violations: ReadonlyArray<{ targetIndex: number; reason: GuardViolation }>
  /** Callback fired the instant a violation is detected. */
  onTrip: ((status: GuardStatus) => void) | null
}

// ============================================================================
// §2  Constants
// ============================================================================

/** Bounding-rect drift threshold in px (matches RECT_TOLERANCE_PX). */
const RECT_THRESHOLD = 4

/** Bounding-rect polling interval in ms. */
const RECT_POLL_MS = 200

/** Attributes we monitor for mutation on the target element. */
const WATCHED_ATTRS = new Set(['name', 'id', 'type', 'autocomplete', 'form', 'action'])

// ============================================================================
// §3  Public API
// ============================================================================

/**
 * Attach a mutation guard to all target elements in an overlay session.
 *
 * Call this immediately after the overlay is mounted and BEFORE the user
 * can click "Insert".  The guard runs until detach() is called.
 *
 * @param elements  The target HTMLElements in session order.
 * @returns         A handle for checking and detaching the guard.
 */
export function attachGuard(elements: HTMLElement[]): MutationGuardHandle {
  const snapshots: ElementSnapshot[] = elements.map(captureSnapshot)
  const violations: Array<{ targetIndex: number; reason: GuardViolation }> = []
  let tripped = false
  let onTrip: ((status: GuardStatus) => void) | null = null

  // ── Trip function (latching) ──
  function trip(targetIndex: number, reason: GuardViolation): void {
    violations.push({ targetIndex, reason })
    if (!tripped) {
      tripped = true
      auditLog('security', 'MUTATION_GUARD_TRIPPED',
        `DOM mutation detected: ${reason} on target[${targetIndex}]`)
      emitTelemetryEvent('mutation_guard_trip', { targetIndex, reason })
      const status: GuardStatus = { valid: false, violations: [...violations] }
      try { onTrip?.(status) } catch { /* callback must not break guard */ }
    }
  }

  // ── MutationObservers ──
  const observers: MutationObserver[] = []

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]
    const snap = snapshots[i]

    // Observer on the element itself: attribute changes
    const selfObs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.target === el) {
          const attr = m.attributeName ?? ''
          if (WATCHED_ATTRS.has(attr)) {
            trip(i, 'attribute_mutated')
            return
          }
        }
      }
    })
    selfObs.observe(el, {
      attributes: true,
      attributeFilter: [...WATCHED_ATTRS],
    })
    observers.push(selfObs)

    // Observer on the parent: childList mutations that remove our element
    const parent = el.parentElement
    if (parent) {
      const parentObs = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'childList') {
            // Check if our element was in the removed nodes
            for (let n = 0; n < m.removedNodes.length; n++) {
              const removed = m.removedNodes[n]
              if (removed === el || (removed instanceof HTMLElement && removed.contains(el))) {
                trip(i, 'element_removed')
                return
              }
            }
          }
        }
        // Even if element wasn't directly removed, check parent reference
        const currentRef = snap.ref.deref()
        if (currentRef && currentRef.parentElement !== snap.parentRef?.deref()) {
          trip(i, 'parent_changed')
        }
      })
      parentObs.observe(parent, { childList: true })
      observers.push(parentObs)

      // Also observe the grandparent for subtree swaps
      const grandparent = parent.parentElement
      if (grandparent) {
        const gpObs = new MutationObserver((mutations) => {
          for (const m of mutations) {
            if (m.type === 'childList') {
              for (let n = 0; n < m.removedNodes.length; n++) {
                const removed = m.removedNodes[n]
                if (removed === parent || (removed instanceof HTMLElement && removed.contains(parent))) {
                  trip(i, 'ancestor_subtree_swap')
                  return
                }
              }
            }
          }
        })
        gpObs.observe(grandparent, { childList: true })
        observers.push(gpObs)
      }
    }
  }

  // ── Bounding-rect poller (catches CSS-based repositioning attacks) ──
  let rectTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
    if (tripped) return
    for (let i = 0; i < elements.length; i++) {
      const el = snapshots[i].ref.deref()
      if (!el) { trip(i, 'element_removed'); return }
      if (!el.isConnected) { trip(i, 'element_removed'); return }

      const rect = el.getBoundingClientRect()
      const snap = snapshots[i].rect
      if (
        Math.abs(roundToGrid(rect.top) - snap.top) > RECT_THRESHOLD ||
        Math.abs(roundToGrid(rect.left) - snap.left) > RECT_THRESHOLD ||
        Math.abs(roundToGrid(rect.width) - snap.width) > RECT_THRESHOLD ||
        Math.abs(roundToGrid(rect.height) - snap.height) > RECT_THRESHOLD
      ) {
        trip(i, 'bounding_rect_shifted')
        return
      }
    }
  }, RECT_POLL_MS)

  // ── Synchronous check function ──
  function check(): GuardStatus {
    if (tripped) return { valid: false, violations: [...violations] }

    for (let i = 0; i < elements.length; i++) {
      const snap = snapshots[i]
      const el = snap.ref.deref()

      // 1. Element still alive?
      if (!el || !el.isConnected) {
        trip(i, 'element_removed')
        continue
      }

      // 2. Parent unchanged?
      const expectedParent = snap.parentRef?.deref()
      if (el.parentElement !== expectedParent) {
        trip(i, 'parent_changed')
        continue
      }

      // 3. Key attributes unchanged?
      const currentAttrs = readAttrs(el)
      if (
        currentAttrs.name !== snap.attrs.name ||
        currentAttrs.id !== snap.attrs.id ||
        currentAttrs.type !== snap.attrs.type ||
        currentAttrs.autocomplete !== snap.attrs.autocomplete
      ) {
        trip(i, 'attribute_mutated')
        continue
      }

      // 4. outerHTML hash unchanged? (catches deep swaps)
      const currentHash = fnv1a(el.outerHTML)
      if (currentHash !== snap.outerHash) {
        trip(i, 'outer_html_changed')
        continue
      }

      // 5. Parent chain signature unchanged?
      const currentChain = buildParentChainSignature(el, 3)
      if (currentChain !== snap.parentChain) {
        trip(i, 'ancestor_subtree_swap')
        continue
      }
    }

    return {
      valid: !tripped,
      violations: [...violations],
    }
  }

  // ── Detach function ──
  function detach(): void {
    for (const obs of observers) {
      try { obs.disconnect() } catch { /* ignore */ }
    }
    observers.length = 0
    if (rectTimer) { clearInterval(rectTimer); rectTimer = null }
  }

  // ── Build handle ──
  const handle: MutationGuardHandle = {
    check,
    detach,
    get tripped() { return tripped },
    get violations() { return violations },
    get onTrip() { return onTrip },
    set onTrip(cb) { onTrip = cb },
  }

  return handle
}

// ============================================================================
// §4  Snapshot Capture
// ============================================================================

function captureSnapshot(el: HTMLElement): ElementSnapshot {
  const rect = el.getBoundingClientRect()
  return {
    ref: new WeakRef(el),
    parentRef: el.parentElement ? new WeakRef(el.parentElement) : null,
    rect: {
      top:    roundToGrid(rect.top),
      left:   roundToGrid(rect.left),
      width:  roundToGrid(rect.width),
      height: roundToGrid(rect.height),
    },
    outerHash: fnv1a(el.outerHTML),
    attrs: readAttrs(el),
    parentChain: buildParentChainSignature(el, 3),
  }
}

function readAttrs(el: HTMLElement): ElementSnapshot['attrs'] {
  const input = el as HTMLInputElement
  return {
    name: input.name ?? el.getAttribute('name') ?? '',
    id: el.id ?? '',
    type: input.type ?? '',
    autocomplete: el.getAttribute('autocomplete') ?? '',
    form: el.closest('form')?.id ?? '',
  }
}

// ============================================================================
// §5  Helpers
// ============================================================================

/** Round a pixel value to a tolerance grid. */
function roundToGrid(v: number): number {
  return Math.round(v / RECT_THRESHOLD) * RECT_THRESHOLD
}

/**
 * FNV-1a 32-bit hash — synchronous, no crypto dependency.
 * Good enough for tamper detection (not cryptographic).
 */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5 // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = (hash * 0x01000193) | 0 // FNV prime, force 32-bit
  }
  return hash >>> 0 // unsigned
}

/**
 * Build a parent chain signature: "DIV.form-group > FORM.login > BODY"
 * Matches the format used by domFingerprint.ts.
 */
function buildParentChainSignature(element: HTMLElement, depth: number): string {
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
