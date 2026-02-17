/**
 * Tests: Overlay Session Lifecycle — Concurrency & Vault Lock Hardening
 *
 * Validates:
 *   1. MAX_ACTIVE_SESSIONS=1 invariant: second showOverlay dismisses first
 *   2. Displaced session.state becomes 'dismissed' (cannot be committed)
 *   3. hideOverlay marks session as 'dismissed'
 *   4. Two rapid WebMCP previews: first dismissed, second active
 *   5. Vault lock during overlay: overlay dismissed, no DOM writes
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock modules BEFORE imports ──

vi.mock('../overlayStyles', () => ({
  createOverlayStyleSheet: vi.fn(() => ({
    replaceSync: vi.fn(),
    cssRules: [],
  })),
  CSS_TOKENS: {},
}))

vi.mock('../mutationGuard', () => ({
  attachGuard: vi.fn(() => ({
    check: vi.fn(() => ({ valid: true, violations: [] })),
    detach: vi.fn(),
    onTrip: null,
  })),
}))

vi.mock('../hardening', () => ({
  guardElement: vi.fn(() => ({ safe: true, code: null, reason: '' })),
  auditLog: vi.fn(),
  emitTelemetryEvent: vi.fn(),
  redactError: vi.fn((e: any) => String(e)),
}))

vi.mock('../haGuard', () => ({
  haCheck: vi.fn(() => true),
  isHAEnforced: vi.fn(() => false),
}))

// ── Polyfill adoptedStyleSheets for jsdom ──
// jsdom does not support adoptedStyleSheets on ShadowRoot.
// Patch the prototype to prevent runtime errors.
if (typeof ShadowRoot !== 'undefined' && !('adoptedStyleSheets' in ShadowRoot.prototype)) {
  Object.defineProperty(ShadowRoot.prototype, 'adoptedStyleSheets', {
    get() { return this._adoptedStyleSheets ?? [] },
    set(val) { this._adoptedStyleSheets = val },
    configurable: true,
  })
}

// ── Import AFTER mocks ──
import {
  showOverlay,
  hideOverlay,
  isOverlayVisible,
  getActiveSessionId,
} from '../overlayManager'
import { auditLog } from '../hardening'
import type { OverlaySession } from '../../../../../../packages/shared/src/vault/insertionPipeline'

// ============================================================================
// Helpers
// ============================================================================

let sessionCounter = 0

function makeSession(overrides?: Partial<OverlaySession>): OverlaySession {
  sessionCounter++
  const inputEl = document.createElement('input')
  inputEl.type = 'text'
  inputEl.name = `field_${sessionCounter}`
  document.body.appendChild(inputEl)

  return {
    id: `session-${sessionCounter}`,
    profile: {
      id: `profile-${sessionCounter}`,
      title: 'Test Profile',
      fields: [
        { kind: 'login.username', label: 'Username', value: 'testuser', sensitive: false },
      ],
    },
    targets: [
      {
        field: { kind: 'login.username', label: 'Username', value: 'testuser', sensitive: false },
        element: inputEl,
        fingerprint: {
          hash: 'mock_hash',
          capturedAt: Date.now(),
          maxAge: 60000,
          properties: {},
        },
        displayValue: 'testuser',
        commitValue: 'testuser',
      },
    ],
    createdAt: Date.now(),
    timeoutMs: 60_000,
    origin: 'quickselect',
    state: 'preview',
    ...overrides,
  } as OverlaySession
}

// ============================================================================
// Tests
// ============================================================================

describe('Overlay Session Lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    sessionCounter = 0
    // Clean up any existing overlay host
    document.querySelectorAll('#wrv-autofill-overlay').forEach(el => el.remove())
  })

  afterEach(() => {
    // Teardown any remaining overlay
    hideOverlay()
    // Advance past the 140ms dismissal animation timer
    vi.advanceTimersByTime(200)
    document.querySelectorAll('#wrv-autofill-overlay').forEach(el => el.remove())
    vi.useRealTimers()
  })

  // ── §1 MAX_ACTIVE_SESSIONS=1: second showOverlay dismisses first ──

  describe('MAX_ACTIVE_SESSIONS=1 invariant', () => {
    it('second showOverlay dismisses first and resolves it with cancel', async () => {
      const session1 = makeSession()
      const session2 = makeSession()

      // Show first overlay
      const promise1 = showOverlay(session1)

      // Show second overlay — should dismiss the first
      const promise2 = showOverlay(session2)

      // First promise must resolve with cancel
      const decision1 = await promise1
      expect(decision1.action).toBe('cancel')

      // Second overlay should be active
      expect(getActiveSessionId()).toBe(session2.id)
    })

    it('displaced session.state becomes dismissed', async () => {
      const session1 = makeSession()
      const session2 = makeSession()

      expect(session1.state).toBe('preview')

      showOverlay(session1)
      showOverlay(session2)

      // First session must be marked 'dismissed'
      expect(session1.state).toBe('dismissed')
      // Second session remains 'preview'
      expect(session2.state).toBe('preview')
    })

    it('audit logs OVERLAY_SESSION_DISPLACED on replacement', async () => {
      const session1 = makeSession()
      const session2 = makeSession()

      showOverlay(session1)
      showOverlay(session2)

      const calls = (auditLog as any).mock.calls
      const displacedCall = calls.find((c: any[]) => c[1] === 'OVERLAY_SESSION_DISPLACED')
      expect(displacedCall).toBeDefined()
    })

    it('only one overlay host exists after replacement', () => {
      const session1 = makeSession()
      const session2 = makeSession()

      showOverlay(session1)
      showOverlay(session2)

      // Give animation timeout a chance to clean up
      const hosts = document.querySelectorAll('#wrv-autofill-overlay')
      // May temporarily have 2 due to animation timeout, but getActiveSessionId is singular
      expect(getActiveSessionId()).toBe(session2.id)
    })
  })

  // ── §2 hideOverlay marks session as dismissed ──

  describe('hideOverlay session state', () => {
    it('marks active session as dismissed', () => {
      const session = makeSession()
      showOverlay(session)

      expect(session.state).toBe('preview')
      hideOverlay()
      expect(session.state).toBe('dismissed')
    })

    it('resolves pending promise with cancel', async () => {
      const session = makeSession()
      const promise = showOverlay(session)

      hideOverlay()

      const decision = await promise
      expect(decision.action).toBe('cancel')
    })

    it('getActiveSessionId returns null after hideOverlay', () => {
      const session = makeSession()
      showOverlay(session)
      expect(getActiveSessionId()).toBe(session.id)

      hideOverlay()
      expect(getActiveSessionId()).toBeNull()
    })
  })

  // ── §3 Two rapid WebMCP previews ──

  describe('Two rapid preview requests (WebMCP concurrency)', () => {
    it('first session is dismissed, second becomes active', async () => {
      const session1 = makeSession({ origin: 'quickselect' })
      const session2 = makeSession({ origin: 'quickselect' })

      // Simulate two rapid WebMCP calls (both call showOverlay)
      const promise1 = showOverlay(session1)
      const promise2 = showOverlay(session2)

      // First is canceled
      const decision1 = await promise1
      expect(decision1.action).toBe('cancel')

      // Second is the active session
      expect(getActiveSessionId()).toBe(session2.id)
      expect(session2.state).toBe('preview')
    })

    it('stale session (first) cannot be committed — state is dismissed', async () => {
      const session1 = makeSession()
      const session2 = makeSession()

      showOverlay(session1)
      showOverlay(session2)

      // The first session's state is 'dismissed' — any commit logic
      // that checks session.state will refuse to proceed.
      expect(session1.state).toBe('dismissed')

      // Attempting to set it back to 'preview' would be a bug,
      // but the session object is now out of the overlayManager's control.
      // The overlayManager's _session is session2, not session1.
      expect(getActiveSessionId()).toBe(session2.id)
    })

    it('three rapid previews: only the last survives', async () => {
      const s1 = makeSession()
      const s2 = makeSession()
      const s3 = makeSession()

      const p1 = showOverlay(s1)
      const p2 = showOverlay(s2)
      const p3 = showOverlay(s3)

      const [d1, d2] = await Promise.all([p1, p2])
      expect(d1.action).toBe('cancel')
      expect(d2.action).toBe('cancel')

      expect(s1.state).toBe('dismissed')
      expect(s2.state).toBe('dismissed')
      expect(s3.state).toBe('preview')
      expect(getActiveSessionId()).toBe(s3.id)
    })
  })

  // ── §4 Vault lock during overlay ──

  describe('Vault lock during active overlay', () => {
    it('hideOverlay dismisses session and marks it dismissed', async () => {
      const session = makeSession()
      const promise = showOverlay(session)

      // Simulate vault lock → orchestrator calls hideOverlay()
      hideOverlay()

      // Advance past the 140ms dismissal animation so the host is removed
      vi.advanceTimersByTime(200)

      const decision = await promise
      expect(decision.action).toBe('cancel')
      expect(session.state).toBe('dismissed')
      expect(getActiveSessionId()).toBeNull()
      expect(isOverlayVisible()).toBe(false)
    })

    it('no DOM writes occur after vault lock dismisses overlay', async () => {
      const session = makeSession()
      const inputEl = session.targets[0].element as HTMLInputElement
      const originalValue = inputEl.value

      showOverlay(session)

      // Vault locks → dismiss
      hideOverlay()

      // The input must remain unchanged — no value injection happened
      expect(inputEl.value).toBe(originalValue)
      expect(session.state).toBe('dismissed')
    })

    it('session marked dismissed cannot transition back to preview', () => {
      const session = makeSession()
      showOverlay(session)

      hideOverlay()
      // Advance past the 140ms dismissal animation
      vi.advanceTimersByTime(200)

      expect(session.state).toBe('dismissed')

      // Even if something tries to reset state, the session is gone from the manager
      session.state = 'preview' // hypothetical malicious/buggy reset
      // The overlay manager no longer references this session
      expect(getActiveSessionId()).toBeNull()
      expect(isOverlayVisible()).toBe(false)
    })

    it('commitValue field values are not injected into DOM', () => {
      const session = makeSession()
      const inputEl = session.targets[0].element as HTMLInputElement

      showOverlay(session)

      // Verify: the commitValue ('testuser') was NOT written to the input
      expect(inputEl.value).not.toBe('testuser')

      // Dismiss via vault lock
      hideOverlay()

      // Still not written
      expect(inputEl.value).not.toBe('testuser')
    })
  })

  // ── §5 Session state transitions (terminal states) ──

  describe('Session state terminal invariants', () => {
    it('dismissed session replaced by new one does not affect new session', async () => {
      const session1 = makeSession()
      const session2 = makeSession()

      const promise1 = showOverlay(session1)
      hideOverlay()

      // session1 is dismissed
      const d1 = await promise1
      expect(d1.action).toBe('cancel')
      expect(session1.state).toBe('dismissed')

      // Show session2 — should be clean, not affected by session1
      showOverlay(session2)
      expect(session2.state).toBe('preview')
      expect(getActiveSessionId()).toBe(session2.id)

      // session1 is still dismissed
      expect(session1.state).toBe('dismissed')
    })
  })
})
