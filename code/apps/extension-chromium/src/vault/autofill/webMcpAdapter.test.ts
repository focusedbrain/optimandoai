/**
 * Tests: WebMCP Preview-Only Adapter
 *
 * Validates the adapter's security gates, delegation patterns, and
 * invariant preservation.  Uses Vitest + JSDOM mocks.
 *
 * Acceptance criteria:
 *   1. Rejects when autofill is inactive (vault locked / disabled)
 *   2. Rejects invalid UUID in itemId
 *   3. Rejects missing params
 *   4. Rejects when no DOM targets are found
 *   5. Rejects when guardElement fails on a target
 *   6. Attaches fingerprint to each OverlayTarget
 *   7. Calls showOverlay with session in 'preview' state
 *   8. Returns immediately (does not await showOverlay promise)
 *   9. Never calls commitInsert or setValueSafely
 *  10. Audit-logs on success and failure paths
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock modules BEFORE importing the adapter ──

// toggleSync
vi.mock('./toggleSync', () => ({
  isAutofillActive: vi.fn(() => true),
}))

// vault API
vi.mock('../api', () => ({
  getItem: vi.fn(),
  getItemForFill: vi.fn(),
}))

// overlayManager
vi.mock('./overlayManager', () => ({
  showOverlay: vi.fn(() => new Promise(() => {})), // never-resolving promise
  isOverlayVisible: vi.fn(() => false),
  getActiveSessionId: vi.fn(() => null),
}))

// hardening
vi.mock('./hardening', () => ({
  guardElement: vi.fn(() => ({ safe: true, code: null, reason: '' })),
  auditLog: vi.fn(),
  auditLogSafe: vi.fn(),
  emitTelemetryEvent: vi.fn(),
  redactError: vi.fn((e: any) => String(e)),
}))

// haGuard
vi.mock('./haGuard', () => ({
  haCheck: vi.fn(() => true),
  isHAEnforced: vi.fn(() => false),
}))

// domFingerprint
vi.mock('./domFingerprint', () => ({
  takeFingerprint: vi.fn(async () => ({
    hash: 'mock_hash_1234',
    capturedAt: Date.now(),
    maxAge: 60000,
    properties: {},
  })),
}))

// fieldScanner
vi.mock('./fieldScanner', () => ({
  collectCandidates: vi.fn(() => ({
    candidates: [],
    hints: [],
    formContext: {},
    domain: 'example.com',
    scannedAt: Date.now(),
    elementsEvaluated: 0,
    durationMs: 1,
    partial: false,
    partialReason: undefined,
  })),
}))

// originPolicy
vi.mock('../../../../../packages/shared/src/vault/originPolicy', () => ({
  matchOrigin: vi.fn(() => ({ matches: true, matchType: 'exact', confidence: 100 })),
  isPublicSuffix: vi.fn(() => false),
}))

// insertionPipeline
vi.mock('../../../../../packages/shared/src/vault/insertionPipeline', () => ({
  computeDisplayValue: vi.fn(
    (value: string, sensitive: boolean) => sensitive ? '••••••••' : value,
  ),
  DEFAULT_MASKING: { maskChar: '\u2022', maskLength: 8, maxClearLength: 24, clipboardClearMs: 30000 },
}))

// committer — should NEVER be called
vi.mock('./committer', () => ({
  commitInsert: vi.fn(() => { throw new Error('commitInsert must not be called') }),
  setValueSafely: vi.fn(() => { throw new Error('setValueSafely must not be called') }),
}))

// ── Global polyfills for JSDOM ──
if (typeof globalThis.crypto === 'undefined') {
  (globalThis as any).crypto = {}
}
if (!globalThis.crypto.randomUUID) {
  globalThis.crypto.randomUUID = () => '00000000-0000-0000-0000-000000000000'
}

// ── Import AFTER mocks ──
import {
  handleWebMcpFillPreviewRequest,
  WEBMCP_RESULT_VERSION,
  WEBMCP_ERROR_CODES,
  BG_WEBMCP_ERROR_CODES,
  ALL_WEBMCP_ERROR_CODES,
  isWebMcpResultV1,
} from './webMcpAdapter'
import type { WebMcpErrorCode, BgWebMcpErrorCode } from './webMcpAdapter'
import { isAutofillActive } from './toggleSync'
import * as vaultAPI from '../api'
import { showOverlay, isOverlayVisible, getActiveSessionId } from './overlayManager'
import { guardElement, auditLog, auditLogSafe, emitTelemetryEvent } from './hardening'
import { isHAEnforced, haCheck } from './haGuard'
import { takeFingerprint } from './domFingerprint'
import { collectCandidates } from './fieldScanner'
import { commitInsert, setValueSafely } from './committer'
import { matchOrigin, isPublicSuffix } from '../../../../../packages/shared/src/vault/originPolicy'

// ============================================================================
// Helpers
// ============================================================================

function makeInput(opts?: { name?: string; type?: string }): HTMLInputElement {
  const el = document.createElement('input')
  el.type = opts?.type ?? 'text'
  el.name = opts?.name ?? 'username'
  document.body.appendChild(el)
  return el
}

function makeVaultItem(overrides?: Record<string, any>) {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    category: 'password',
    title: 'Test Login',
    fields: [
      { key: 'username', value: 'testuser', encrypted: false, type: 'text' },
      { key: 'password', value: 'secret123', encrypted: true, type: 'password' },
    ],
    domain: 'example.com',
    favorite: false,
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  }
}

function makeScanResult(overrides?: Record<string, any>) {
  return {
    candidates: [],
    hints: [],
    formContext: {},
    domain: 'example.com',
    scannedAt: Date.now(),
    elementsEvaluated: 0,
    durationMs: 1,
    partial: false,
    partialReason: undefined,
    ...overrides,
  }
}

const VALID_PARAMS = {
  itemId: '11111111-2222-3333-4444-555555555555',
}

// ============================================================================
// Tests
// ============================================================================

describe('WebMcpAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset return values (clearAllMocks only clears call history)
    ;(isAutofillActive as any).mockReturnValue(true)
    ;(vaultAPI.getItemForFill as any).mockResolvedValue(makeVaultItem())
    ;(guardElement as any).mockReturnValue({ safe: true, code: null, reason: '' })
    ;(isOverlayVisible as any).mockReturnValue(false)
    ;(showOverlay as any).mockReturnValue(new Promise(() => {}))
    ;(isHAEnforced as any).mockReturnValue(false)
    ;(matchOrigin as any).mockReturnValue({ matches: true, matchType: 'exact', confidence: 100 })
    ;(isPublicSuffix as any).mockReturnValue(false)
    ;(takeFingerprint as any).mockResolvedValue({
      hash: 'mock_hash_1234',
      capturedAt: Date.now(),
      maxAge: 60000,
      properties: {},
    })
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  // ── §1 Inactive gate ──

  it('rejects when autofill is inactive', async () => {
    ;(isAutofillActive as any).mockReturnValue(false)

    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('AUTOFILL_DISABLED')
    expect(auditLog).toHaveBeenCalledWith('warn', 'WEBMCP_REJECTED_INACTIVE', expect.any(String))
    expect(showOverlay).not.toHaveBeenCalled()
  })

  // ── §2 Invalid UUID ──

  it('rejects invalid UUID format', async () => {
    const result = await handleWebMcpFillPreviewRequest({ itemId: 'not-a-uuid' })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INVALID_PARAMS')
  })

  it('rejects empty itemId', async () => {
    const result = await handleWebMcpFillPreviewRequest({ itemId: '' })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INVALID_PARAMS')
  })

  // ── §3 Missing params ──

  it('rejects null params', async () => {
    const result = await handleWebMcpFillPreviewRequest(null as any)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INVALID_PARAMS')
  })

  it('rejects params with missing itemId', async () => {
    const result = await handleWebMcpFillPreviewRequest({} as any)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INVALID_PARAMS')
  })

  // ── §4 No targets ──

  it('rejects when no DOM targets are found', async () => {
    // No elements in DOM + no hints → no targets
    ;(collectCandidates as any).mockReturnValue({
      candidates: [], hints: [], formContext: {}, domain: 'example.com', scannedAt: Date.now(),
    })

    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('NO_TARGETS')
    expect(showOverlay).not.toHaveBeenCalled()
  })

  // ── §5 guardElement failure ──

  it('rejects when guardElement fails on a target', async () => {
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      hints: [], formContext: {}, domain: 'example.com', scannedAt: Date.now(),
    })
    ;(guardElement as any).mockReturnValue({
      safe: false,
      code: 'ELEMENT_HIDDEN',
      reason: 'Element has display:none',
    })

    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('ELEMENT_HIDDEN')
    expect(showOverlay).not.toHaveBeenCalled()
    expect(auditLog).toHaveBeenCalledWith('warn', 'WEBMCP_TARGET_GUARD_FAILED', expect.any(String))
  })

  // ── §6 Fingerprint attached ──

  it('takes fingerprint for each target', async () => {
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      hints: [], formContext: {}, domain: 'example.com', scannedAt: Date.now(),
    })

    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    expect(result.success).toBe(true)
    // HA is off → maxAge is undefined (uses default in takeFingerprint)
    expect(takeFingerprint).toHaveBeenCalledWith(input, undefined)
  })

  // ── §7 showOverlay called with preview state ──

  it('calls showOverlay with session in preview state', async () => {
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      hints: [], formContext: {}, domain: 'example.com', scannedAt: Date.now(),
    })

    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    expect(result.success).toBe(true)
    expect(result.sessionId).toBeDefined()
    expect(result.previewFieldCount).toBe(1)
    expect(showOverlay).toHaveBeenCalledTimes(1)

    const session = (showOverlay as any).mock.calls[0][0]
    expect(session.state).toBe('preview')
    expect(session.targets.length).toBe(1)
    expect(session.targets[0].fingerprint).toBeDefined()
    expect(session.targets[0].fingerprint.hash).toBe('mock_hash_1234')
  })

  // ── §8 Returns immediately ──

  it('returns immediately without awaiting showOverlay', async () => {
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      hints: [], formContext: {}, domain: 'example.com', scannedAt: Date.now(),
    })

    // showOverlay returns a never-resolving promise (already mocked)
    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    // If the adapter awaited showOverlay, this test would hang
    expect(result.success).toBe(true)
  })

  // ── §9 Never calls commitInsert or setValueSafely ──

  it('never calls commitInsert or setValueSafely', async () => {
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      hints: [], formContext: {}, domain: 'example.com', scannedAt: Date.now(),
    })

    await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    expect(commitInsert).not.toHaveBeenCalled()
    expect(setValueSafely).not.toHaveBeenCalled()
  })

  // ── §10 Audit logging ──

  it('logs WEBMCP_PREVIEW_CREATED on success', async () => {
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      hints: [], formContext: {}, domain: 'example.com', scannedAt: Date.now(),
    })

    await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    expect(auditLogSafe).toHaveBeenCalledWith('info', 'WEBMCP_PREVIEW_CREATED', expect.any(String), expect.objectContaining({ fieldCount: expect.any(Number) }))
  })

  it('logs WEBMCP_PREVIEW_FAILED on validation failure', async () => {
    await handleWebMcpFillPreviewRequest({ itemId: 'bad' })

    expect(auditLog).toHaveBeenCalledWith('warn', 'WEBMCP_PREVIEW_FAILED', expect.any(String))
  })

  // ── §11 Vault item not found ──

  it('rejects when vault item is not found', async () => {
    ;(vaultAPI.getItemForFill as any).mockRejectedValue(new Error('Not found'))

    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('VAULT_ITEM_DELETED')
  })

  // ── §12 targetHints validation ──

  it('rejects targetHints with too many entries', async () => {
    const hints: Record<string, string> = {}
    for (let i = 0; i < 25; i++) hints[`field${i}`] = `#input-${i}`

    const result = await handleWebMcpFillPreviewRequest({
      itemId: VALID_PARAMS.itemId,
      targetHints: hints,
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INVALID_PARAMS')
  })

  it('rejects targetHints with overlong selector', async () => {
    const result = await handleWebMcpFillPreviewRequest({
      itemId: VALID_PARAMS.itemId,
      targetHints: { 'login.username': 'x'.repeat(300) },
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INVALID_PARAMS')
  })

  // ── §13 Hint-based targeting ──

  it('resolves fields from targetHints via querySelector', async () => {
    const input = makeInput({ name: 'user' })
    input.id = 'my-user-input'

    const result = await handleWebMcpFillPreviewRequest({
      itemId: VALID_PARAMS.itemId,
      targetHints: { 'login.username': '#my-user-input' },
    })

    expect(result.success).toBe(true)
    expect(result.previewFieldCount).toBe(1)
  })

  // ── §14 HA-mode severity elevation ──

  it('elevates warn-level audit to security under HA mode (reject path)', async () => {
    ;(isHAEnforced as any).mockReturnValue(true)
    ;(isAutofillActive as any).mockReturnValue(false)

    await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    // Under HA, warnLevel becomes 'security'
    expect(auditLog).toHaveBeenCalledWith('security', 'WEBMCP_REJECTED_INACTIVE', expect.any(String))
  })

  it('elevates success log to security under HA mode', async () => {
    ;(isHAEnforced as any).mockReturnValue(true)
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      hints: [], formContext: {}, domain: 'example.com', scannedAt: Date.now(),
    })

    await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    expect(auditLogSafe).toHaveBeenCalledWith('security', 'WEBMCP_PREVIEW_CREATED', expect.any(String), expect.objectContaining({ ha: true }))
  })

  // ── §15 Audit log redaction ──

  it('does not log vault item IDs in item-not-found messages', async () => {
    ;(vaultAPI.getItemForFill as any).mockRejectedValue(new Error('Not found'))

    await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    const calls = (auditLog as any).mock.calls
    const itemNotFoundCall = calls.find((c: any[]) => c[1] === 'WEBMCP_ITEM_NOT_FOUND')
    expect(itemNotFoundCall).toBeDefined()
    // Message must NOT contain the raw UUID
    expect(itemNotFoundCall[2]).not.toContain(VALID_PARAMS.itemId)
  })

  it('does not log raw domains in origin-mismatch messages', async () => {
    ;(matchOrigin as any).mockReturnValue({ matches: false, matchType: 'none', confidence: 0 })

    await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    const calls = (auditLog as any).mock.calls
    const mismatchCall = calls.find((c: any[]) => c[1] === 'WEBMCP_ORIGIN_MISMATCH')
    if (mismatchCall) {
      // Must not contain raw domain strings from the vault item
      expect(mismatchCall[2]).not.toContain('example.com')
    }
  })

  it('does not log guard.reason in guard-failure messages', async () => {
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      hints: [], formContext: {}, domain: 'example.com', scannedAt: Date.now(),
    })
    ;(guardElement as any).mockReturnValue({
      safe: false,
      code: 'ELEMENT_HIDDEN',
      reason: 'Element has display:none at selector #my-secret-form input',
    })

    await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    const calls = (auditLog as any).mock.calls
    const guardCall = calls.find((c: any[]) => c[1] === 'WEBMCP_TARGET_GUARD_FAILED')
    expect(guardCall).toBeDefined()
    // Only the code should appear, not the full reason (which might contain selectors)
    expect(guardCall[2]).toContain('ELEMENT_HIDDEN')
    expect(guardCall[2]).not.toContain('#my-secret-form')
  })

  it('telemetry does not include sessionId', async () => {
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      hints: [], formContext: {}, domain: 'example.com', scannedAt: Date.now(),
    })

    await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    const telCall = (emitTelemetryEvent as any).mock.calls[0]
    expect(telCall[0]).toBe('webmcp_preview')
    // sessionId must NOT be in telemetry (data minimization)
    expect(telCall[1]).not.toHaveProperty('sessionId')
    expect(telCall[1]).toHaveProperty('fieldCount')
    expect(telCall[1]).toHaveProperty('haMode')
  })

  // ── §16 Origin Policy: Match Tier + HA Logging ──

  it('logs origin_match_tier and ha status on successful preview', async () => {
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      hints: [], formContext: {}, domain: 'example.com', scannedAt: Date.now(),
    })
    ;(matchOrigin as any).mockReturnValue({ matches: true, matchType: 'exact', confidence: 100 })

    await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    const calls = (auditLogSafe as any).mock.calls
    const originCheck = calls.find((c: any[]) => c[1] === 'WEBMCP_ORIGIN_CHECK')
    expect(originCheck).toBeDefined()
    // Meta contains structured data (no raw domains)
    expect(originCheck[3]).toEqual(expect.objectContaining({ originTier: 'exact', ha: false, psl: false }))
    // Message must not contain raw domain
    expect(originCheck[2]).not.toContain('example.com')
  })

  it('logs matchType=none on origin mismatch', async () => {
    ;(matchOrigin as any).mockReturnValue({ matches: false, matchType: 'none', confidence: 0 })

    await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    const calls = (auditLogSafe as any).mock.calls
    const originCheck = calls.find((c: any[]) => c[1] === 'WEBMCP_ORIGIN_CHECK')
    expect(originCheck).toBeDefined()
    expect(originCheck[3]).toEqual(expect.objectContaining({ originTier: 'none' }))
  })

  it('logs origin_match_tier=no_domain when vault item has no domain', async () => {
    ;(vaultAPI.getItemForFill as any).mockResolvedValue(makeVaultItem({ domain: '' }))
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      hints: [], formContext: {}, domain: 'example.com', scannedAt: Date.now(),
    })

    await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    const calls = (auditLogSafe as any).mock.calls
    const originCheck = calls.find((c: any[]) => c[1] === 'WEBMCP_ORIGIN_CHECK')
    expect(originCheck).toBeDefined()
    expect(originCheck[3]).toEqual(expect.objectContaining({ originTier: 'no_domain' }))
  })

  // ── §17 HA + PSL => preview blocked ──

  it('blocks preview creation under HA mode on PSL domain', async () => {
    ;(isHAEnforced as any).mockReturnValue(true)
    ;(isPublicSuffix as any).mockReturnValue(true)
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      hints: [], formContext: {}, domain: 'alice.github.io', scannedAt: Date.now(),
    })

    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('PSL_BLOCKED')
    expect(showOverlay).not.toHaveBeenCalled()

    // Audit must log with 'security' severity
    const calls = (auditLog as any).mock.calls
    const pslCall = calls.find((c: any[]) => c[1] === 'WEBMCP_PSL_BLOCKED')
    expect(pslCall).toBeDefined()
    expect(pslCall[0]).toBe('security')
    // Must not contain any raw domain
    expect(pslCall[2]).not.toContain('github.io')
    expect(pslCall[2]).not.toContain('alice')
  })

  it('returns stable PSL_BLOCKED error code (not PSL_MISMATCH)', async () => {
    ;(isHAEnforced as any).mockReturnValue(true)
    ;(isPublicSuffix as any).mockReturnValue(true)

    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    expect(result.error?.code).toBe('PSL_BLOCKED')
  })

  // ── §18 non-HA + PSL => preview allowed, safe-mode flagged ──

  it('allows preview on PSL domain in non-HA mode but flags safe-mode', async () => {
    ;(isHAEnforced as any).mockReturnValue(false)
    ;(isPublicSuffix as any).mockReturnValue(true)
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      hints: [], formContext: {}, domain: 'alice.github.io', scannedAt: Date.now(),
    })

    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    expect(result.success).toBe(true)
    expect(showOverlay).toHaveBeenCalledTimes(1)

    // Audit warning must exist (not error/security)
    const calls = (auditLog as any).mock.calls
    const pslWarn = calls.find((c: any[]) => c[1] === 'WEBMCP_PSL_WARNING')
    expect(pslWarn).toBeDefined()
    expect(pslWarn[0]).toBe('warn')

    // Telemetry must include safe-mode flag
    const telCall = (emitTelemetryEvent as any).mock.calls.find(
      (c: any[]) => c[0] === 'webmcp_preview',
    )
    expect(telCall).toBeDefined()
    expect(telCall[1]).toHaveProperty('safeMode', 'psl_domain')
  })

  it('does not include safeMode in telemetry when not on PSL domain', async () => {
    ;(isPublicSuffix as any).mockReturnValue(false)
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      hints: [], formContext: {}, domain: 'example.com', scannedAt: Date.now(),
    })

    await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    const telCall = (emitTelemetryEvent as any).mock.calls.find(
      (c: any[]) => c[0] === 'webmcp_preview',
    )
    expect(telCall).toBeDefined()
    expect(telCall[1]).not.toHaveProperty('safeMode')
  })

  // ── §19 HA + origin mismatch => hard block (not just warning) ──

  it('hard-blocks preview under HA mode on origin mismatch', async () => {
    ;(isHAEnforced as any).mockReturnValue(true)
    ;(matchOrigin as any).mockReturnValue({ matches: false, matchType: 'none', confidence: 0 })

    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('ORIGIN_MISMATCH')
    expect(showOverlay).not.toHaveBeenCalled()

    const calls = (auditLog as any).mock.calls
    const mismatchCall = calls.find((c: any[]) => c[1] === 'WEBMCP_ORIGIN_MISMATCH')
    expect(mismatchCall).toBeDefined()
    expect(mismatchCall[0]).toBe('security')
    expect(mismatchCall[2]).toContain('tier=none')
    // No raw domains
    expect(mismatchCall[2]).not.toContain('example.com')
  })

  // ── §20 non-HA + origin mismatch => allowed but warned ──

  it('allows preview on origin mismatch in non-HA mode with warning', async () => {
    ;(isHAEnforced as any).mockReturnValue(false)
    ;(matchOrigin as any).mockReturnValue({ matches: false, matchType: 'none', confidence: 0 })
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      hints: [], formContext: {}, domain: 'example.com', scannedAt: Date.now(),
    })

    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    expect(result.success).toBe(true)
    expect(showOverlay).toHaveBeenCalledTimes(1)

    const calls = (auditLog as any).mock.calls
    const mismatchWarn = calls.find((c: any[]) => c[1] === 'WEBMCP_ORIGIN_MISMATCH')
    expect(mismatchWarn).toBeDefined()
    expect(mismatchWarn[0]).toBe('warn')
  })

  // ── §21 Origin check log never contains raw domains or UUIDs ──

  it('WEBMCP_ORIGIN_CHECK log never contains raw domains or item UUIDs', async () => {
    ;(matchOrigin as any).mockReturnValue({ matches: true, matchType: 'www_equivalent', confidence: 95 })
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      hints: [], formContext: {}, domain: 'example.com', scannedAt: Date.now(),
    })

    await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    const calls = (auditLogSafe as any).mock.calls
    const originCheck = calls.find((c: any[]) => c[1] === 'WEBMCP_ORIGIN_CHECK')
    expect(originCheck).toBeDefined()
    expect(originCheck[3]).toEqual(expect.objectContaining({ originTier: 'www_equivalent' }))
    // No raw domain or UUID in message
    expect(originCheck[2]).not.toContain('example.com')
    expect(originCheck[2]).not.toContain(VALID_PARAMS.itemId)
  })

  // ── §22 Least-privilege: endpoint list and data projection ──

  it('calls getItemForFill (not getItem) for preview', async () => {
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      hints: [], formContext: {}, domain: 'example.com', scannedAt: Date.now(),
    })

    await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    // Must use the projection endpoint, not the full getItem
    expect(vaultAPI.getItemForFill).toHaveBeenCalledWith(VALID_PARAMS.itemId)
    expect(vaultAPI.getItem).not.toHaveBeenCalled()
  })

  it('only calls one vault API endpoint per preview request', async () => {
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      hints: [], formContext: {}, domain: 'example.com', scannedAt: Date.now(),
    })

    await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    // Exactly one vault API call: getItemForFill
    expect(vaultAPI.getItemForFill).toHaveBeenCalledTimes(1)

    // No other vault API endpoints should be called
    // (listItems, createItem, updateItem, deleteItem, getVaultStatus, etc.)
    const allApiKeys = Object.keys(vaultAPI).filter(k => typeof (vaultAPI as any)[k] === 'function')
    for (const key of allApiKeys) {
      if (key === 'getItemForFill') continue
      const fn = (vaultAPI as any)[key]
      if (fn.mock) {
        expect(fn).not.toHaveBeenCalled()
      }
    }
  })

  it('does not expose container_id, favorite, or created_at in the session', async () => {
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      hints: [], formContext: {}, domain: 'example.com', scannedAt: Date.now(),
    })

    // Mock returns a full VaultItem shape — but getItemForFill should project it
    ;(vaultAPI.getItemForFill as any).mockResolvedValue({
      id: '11111111-2222-3333-4444-555555555555',
      category: 'password',
      title: 'Test Login',
      fields: [
        { key: 'username', value: 'testuser', encrypted: false, type: 'text' },
        { key: 'password', value: 'secret123', encrypted: true, type: 'password' },
      ],
      domain: 'example.com',
      // These should NOT exist in a FillProjection:
      // container_id, favorite, created_at, updated_at
    })

    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)
    expect(result.success).toBe(true)

    // The session passed to showOverlay should not contain raw vault metadata
    const session = (showOverlay as any).mock.calls[0][0]
    expect(session).not.toHaveProperty('container_id')
    expect(session).not.toHaveProperty('favorite')
    expect(session).not.toHaveProperty('created_at')
    // Profile should not carry container/favorite metadata
    expect(session.profile).not.toHaveProperty('container_id')
    expect(session.profile).not.toHaveProperty('favorite')
    expect(session.profile).not.toHaveProperty('created_at')
  })

  it('does not retain raw item reference after profile conversion', async () => {
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue(makeScanResult({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
    }))

    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)
    expect(result.success).toBe(true)

    // The result object must not leak the full item
    expect(result).not.toHaveProperty('item')
    expect(result).not.toHaveProperty('vaultItem')
    expect(result).not.toHaveProperty('fields')
  })

  // ── §23 Partial Scan Contract ──

  it('propagates partialScan=true and partialReason from scanner', async () => {
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue(makeScanResult({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      elementsEvaluated: 500,
      partial: true,
      partialReason: 'element_cap',
    }))

    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    expect(result.success).toBe(true)
    expect(result.partialScan).toBe(true)
    expect(result.partialReason).toBe('element_cap')
    expect(result.evaluatedCount).toBe(500)
    expect(result.candidateCount).toBe(1)
  })

  it('propagates partialScan=false when scan completes fully', async () => {
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue(makeScanResult({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      elementsEvaluated: 3,
      partial: false,
    }))

    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    expect(result.success).toBe(true)
    expect(result.partialScan).toBe(false)
    expect(result.partialReason).toBeUndefined()
    expect(result.evaluatedCount).toBe(3)
    expect(result.candidateCount).toBe(1)
  })

  it('propagates time_budget partialReason', async () => {
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue(makeScanResult({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      elementsEvaluated: 50,
      partial: true,
      partialReason: 'time_budget',
    }))

    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    expect(result.partialScan).toBe(true)
    expect(result.partialReason).toBe('time_budget')
  })

  it('propagates candidate_cap partialReason', async () => {
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue(makeScanResult({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      elementsEvaluated: 200,
      partial: true,
      partialReason: 'candidate_cap',
    }))

    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    expect(result.partialScan).toBe(true)
    expect(result.partialReason).toBe('candidate_cap')
  })

  it('emits WEBMCP_PARTIAL_SCAN audit at warn level in non-HA mode', async () => {
    ;(isHAEnforced as any).mockReturnValue(false)
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue(makeScanResult({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      elementsEvaluated: 1500,
      partial: true,
      partialReason: 'element_cap',
    }))

    await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    const calls = (auditLogSafe as any).mock.calls
    const partialCall = calls.find((c: any[]) => c[1] === 'WEBMCP_PARTIAL_SCAN')
    expect(partialCall).toBeDefined()
    expect(partialCall[0]).toBe('warn')
    // Structured meta with numeric data only
    expect(partialCall[3]).toEqual(expect.objectContaining({
      partialReason: 'element_cap',
      evaluatedCount: 1500,
    }))
    // Message must not contain dynamic data
    expect(partialCall[2]).not.toContain('http')
    expect(partialCall[2]).not.toContain('example.com')
    expect(partialCall[2]).not.toContain('#')
  })

  it('elevates WEBMCP_PARTIAL_SCAN to security under HA mode', async () => {
    ;(isHAEnforced as any).mockReturnValue(true)
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue(makeScanResult({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      elementsEvaluated: 500,
      partial: true,
      partialReason: 'element_cap',
    }))

    await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    const calls = (auditLogSafe as any).mock.calls
    const partialCall = calls.find((c: any[]) => c[1] === 'WEBMCP_PARTIAL_SCAN')
    expect(partialCall).toBeDefined()
    expect(partialCall[0]).toBe('security')
  })

  it('emits webmcp_partial_scan telemetry with correct shape', async () => {
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue(makeScanResult({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      elementsEvaluated: 1500,
      partial: true,
      partialReason: 'element_cap',
    }))

    await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    const telCall = (emitTelemetryEvent as any).mock.calls.find(
      (c: any[]) => c[0] === 'webmcp_partial_scan',
    )
    expect(telCall).toBeDefined()
    expect(telCall[1]).toEqual({
      reason: 'element_cap',
      ha: false,
      evaluatedCount: 1500,
      candidateCount: 1,
    })
    // No PII in telemetry
    expect(telCall[1]).not.toHaveProperty('domain')
    expect(telCall[1]).not.toHaveProperty('selector')
    expect(telCall[1]).not.toHaveProperty('sessionId')
  })

  it('does not emit webmcp_partial_scan telemetry when scan is complete', async () => {
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue(makeScanResult({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      elementsEvaluated: 3,
      partial: false,
    }))

    await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    const telCall = (emitTelemetryEvent as any).mock.calls.find(
      (c: any[]) => c[0] === 'webmcp_partial_scan',
    )
    expect(telCall).toBeUndefined()
  })

  it('partial scan result contains only numbers and enums — no PII', async () => {
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue(makeScanResult({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      elementsEvaluated: 500,
      partial: true,
      partialReason: 'element_cap',
    }))

    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    // Only safe types in the result
    expect(typeof result.partialScan).toBe('boolean')
    expect(typeof result.partialReason).toBe('string')
    expect(typeof result.evaluatedCount).toBe('number')
    expect(typeof result.candidateCount).toBe('number')

    // No UUIDs, domains, selectors, or secrets anywhere in result
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(VALID_PARAMS.itemId)
    expect(serialized).not.toContain('example.com')
    expect(serialized).not.toContain('#')
    expect(serialized).not.toContain('input[')
    expect(serialized).not.toContain('password')
    expect(serialized).not.toContain('secret')
  })

  it('hint-based resolution does not include scan metadata', async () => {
    const input = makeInput({ name: 'user' })
    input.id = 'my-user-input-2'

    const result = await handleWebMcpFillPreviewRequest({
      itemId: VALID_PARAMS.itemId,
      targetHints: { 'login.username': '#my-user-input-2' },
    })

    expect(result.success).toBe(true)
    // No scan metadata when using hints (no collectCandidates called)
    expect(result.partialScan).toBeUndefined()
    expect(result.partialReason).toBeUndefined()
    expect(result.evaluatedCount).toBeUndefined()
    expect(result.candidateCount).toBeUndefined()
  })

  it('still never calls commitInsert/setValueSafely on partial scan', async () => {
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue(makeScanResult({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      elementsEvaluated: 500,
      partial: true,
      partialReason: 'element_cap',
    }))

    await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    expect(commitInsert).not.toHaveBeenCalled()
    expect(setValueSafely).not.toHaveBeenCalled()
  })

  // ── §24 Result Versioning ──

  it('successful result includes resultVersion', async () => {
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue(makeScanResult({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
    }))

    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    expect(result.success).toBe(true)
    expect(result.resultVersion).toBe('webmcp-preview-v1')
  })

  it('resultVersion always present even on error (INVALID_PARAMS)', async () => {
    const result = await handleWebMcpFillPreviewRequest({ itemId: 'bad' })
    expect(result.success).toBe(false)
    expect(result.resultVersion).toBe('webmcp-preview-v1')
  })

  it('resultVersion present on AUTOFILL_DISABLED error', async () => {
    ;(isAutofillActive as any).mockReturnValue(false)
    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)
    expect(result.success).toBe(false)
    expect(result.resultVersion).toBe('webmcp-preview-v1')
  })

  it('resultVersion present on VAULT_ITEM_DELETED error', async () => {
    ;(vaultAPI.getItemForFill as any).mockRejectedValue(new Error('Not found'))
    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)
    expect(result.success).toBe(false)
    expect(result.resultVersion).toBe('webmcp-preview-v1')
  })

  it('resultVersion present on NO_TARGETS error', async () => {
    ;(collectCandidates as any).mockReturnValue(makeScanResult({ candidates: [] }))
    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)
    expect(result.success).toBe(false)
    expect(result.resultVersion).toBe('webmcp-preview-v1')
  })

  it('resultVersion present on ORIGIN_MISMATCH error (HA)', async () => {
    ;(isHAEnforced as any).mockReturnValue(true)
    ;(matchOrigin as any).mockReturnValue({ matches: false, matchType: 'none', confidence: 0 })
    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)
    expect(result.success).toBe(false)
    expect(result.resultVersion).toBe('webmcp-preview-v1')
  })

  it('resultVersion present on PSL_BLOCKED error (HA)', async () => {
    ;(isHAEnforced as any).mockReturnValue(true)
    ;(isPublicSuffix as any).mockReturnValue(true)
    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('PSL_BLOCKED')
    expect(result.resultVersion).toBe('webmcp-preview-v1')
  })

  it('resultVersion present on ELEMENT_HIDDEN error', async () => {
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue(makeScanResult({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
    }))
    ;(guardElement as any).mockReturnValue({ safe: false, code: 'ELEMENT_HIDDEN', reason: 'hidden' })
    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)
    expect(result.success).toBe(false)
    expect(result.resultVersion).toBe('webmcp-preview-v1')
  })

  it('resultVersion equals exported WEBMCP_RESULT_VERSION constant', async () => {
    expect(WEBMCP_RESULT_VERSION).toBe('webmcp-preview-v1')

    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue(makeScanResult({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
    }))
    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)
    expect(result.resultVersion).toBe(WEBMCP_RESULT_VERSION)
  })

  it('WEBMCP_RESULT_VERSION source constant is immutable at webmcp-preview-v1', async () => {
    const fs = await import('fs')
    const path = await import('path')
    // Test file is at vault/autofill/webMcpAdapter.test.ts (same directory)
    const adapterPath = path.resolve(__dirname, 'webMcpAdapter.ts')
    const source = fs.readFileSync(adapterPath, 'utf-8')

    // The constant must exist exactly once and with the expected value
    const matches = source.match(/export const WEBMCP_RESULT_VERSION\s*=\s*['"]([^'"]+)['"]/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBe(1)
    expect(matches![0]).toContain("'webmcp-preview-v1'")
  })

  // ── §25 Error Code Enum Validation ──

  it('WEBMCP_ERROR_CODES set contains exactly the expected stable codes', () => {
    const expected: WebMcpErrorCode[] = [
      'INVALID_PARAMS',
      'AUTOFILL_DISABLED',
      'VAULT_ITEM_DELETED',
      'ORIGIN_MISMATCH',
      'PSL_BLOCKED',
      'NO_TARGETS',
      'ELEMENT_HIDDEN',
      'INTERNAL_ERROR',
    ]
    expect(WEBMCP_ERROR_CODES.size).toBe(expected.length)
    for (const code of expected) {
      expect(WEBMCP_ERROR_CODES.has(code)).toBe(true)
    }
  })

  it('error.code on INVALID_PARAMS is a known WebMcpErrorCode', async () => {
    const result = await handleWebMcpFillPreviewRequest({ itemId: 'bad' })
    expect(result.success).toBe(false)
    expect(WEBMCP_ERROR_CODES.has(result.error!.code)).toBe(true)
  })

  it('error.code on AUTOFILL_DISABLED is a known WebMcpErrorCode', async () => {
    ;(isAutofillActive as any).mockReturnValue(false)
    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)
    expect(WEBMCP_ERROR_CODES.has(result.error!.code)).toBe(true)
  })

  it('error.code on NO_TARGETS is a known WebMcpErrorCode', async () => {
    ;(collectCandidates as any).mockReturnValue(makeScanResult({ candidates: [] }))
    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)
    expect(WEBMCP_ERROR_CODES.has(result.error!.code)).toBe(true)
  })

  it('error.code on guard failure is clamped to ELEMENT_HIDDEN (stable enum)', async () => {
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue(makeScanResult({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
    }))
    // guardElement returns an INTERNAL code that is NOT in WebMcpErrorCode
    ;(guardElement as any).mockReturnValue({ safe: false, code: 'SOMETHING_INTERNAL', reason: 'test' })

    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)

    expect(result.error!.code).toBe('ELEMENT_HIDDEN')
    expect(WEBMCP_ERROR_CODES.has(result.error!.code)).toBe(true)
  })

  it('no error.code value contains PII patterns', () => {
    for (const code of WEBMCP_ERROR_CODES) {
      // Must not look like UUID, email, domain, selector, or secret
      expect(code).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i)
      expect(code).not.toMatch(/@/)
      expect(code).not.toMatch(/\.com|\.org|\.net|\.io/i)
      expect(code).not.toMatch(/#|input\[/)
      expect(code).not.toMatch(/password|secret|token|key/i)
    }
  })

  // ── §26 Serialization Safety (success + failure) ──

  it('successful result JSON contains no UUID/domain/selector/url patterns', async () => {
    const input = makeInput()
    ;(collectCandidates as any).mockReturnValue(makeScanResult({
      candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
    }))

    const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)
    expect(result.success).toBe(true)

    const serialized = JSON.stringify(result)
    // Must not contain the itemId UUID
    expect(serialized).not.toContain(VALID_PARAMS.itemId)
    // Must not contain domains
    expect(serialized).not.toContain('example.com')
    // Must not contain CSS selectors
    expect(serialized).not.toContain('input[')
    expect(serialized).not.toContain('querySelector')
    // Must not contain secrets
    expect(serialized).not.toContain('password')
    expect(serialized).not.toContain('secret')
    // Must contain resultVersion
    expect(serialized).toContain('webmcp-preview-v1')
  })

  it('failure result JSON contains no UUID/domain/selector/url patterns', async () => {
    const result = await handleWebMcpFillPreviewRequest({ itemId: 'not-a-uuid' })
    expect(result.success).toBe(false)

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('example.com')
    expect(serialized).not.toContain('input[')
    expect(serialized).not.toContain('password')
    expect(serialized).not.toContain('secret')
    // resultVersion still present
    expect(serialized).toContain('webmcp-preview-v1')
  })

  // ── §27 Hint-Based Path ──

  it('hint-based path keeps scan meta undefined but includes resultVersion', async () => {
    const input = makeInput({ name: 'user' })
    input.id = 'hint-version-test'

    const result = await handleWebMcpFillPreviewRequest({
      itemId: VALID_PARAMS.itemId,
      targetHints: { 'login.username': '#hint-version-test' },
    })

    expect(result.success).toBe(true)
    expect(result.resultVersion).toBe(WEBMCP_RESULT_VERSION)
    // Scan meta must be undefined (no collectCandidates called)
    expect(result.partialScan).toBeUndefined()
    expect(result.partialReason).toBeUndefined()
    expect(result.evaluatedCount).toBeUndefined()
    expect(result.candidateCount).toBeUndefined()
    expect(result.elementsVisited).toBeUndefined()
  })

  // ── §28 Source-Level Schema Contract ──

  it('WebMcpAdapterResult.error.code is typed as WebMcpErrorCode (not string)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const adapterPath = path.resolve(__dirname, 'webMcpAdapter.ts')
    const source = fs.readFileSync(adapterPath, 'utf-8')

    // The error field must use the union type, not bare string
    expect(source).toContain('error?: { code: WebMcpErrorCode;')
    // The type must be exported
    expect(source).toContain('export type WebMcpErrorCode')
    // The set must be exported
    expect(source).toContain('export const WEBMCP_ERROR_CODES')
  })

  it('every return path in handleWebMcpFillPreviewRequest uses WEBMCP_RESULT_VERSION', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const adapterPath = path.resolve(__dirname, 'webMcpAdapter.ts')
    const source = fs.readFileSync(adapterPath, 'utf-8')

    // Extract the function body
    const fnStart = source.indexOf('export async function handleWebMcpFillPreviewRequest')
    expect(fnStart).toBeGreaterThan(0)
    const fnBody = source.slice(fnStart)

    // Count all return statements that include resultVersion
    const returnStatements = fnBody.match(/return\s*\{[^}]*resultVersion/g) ?? []
    // Count all return statements with success (should be same count)
    const allReturns = fnBody.match(/return\s*\{[^}]*success:/g) ?? []

    expect(returnStatements.length).toBeGreaterThanOrEqual(8)
    expect(returnStatements.length).toBe(allReturns.length)
  })

  // ══════════════════════════════════════════════════════════════════════════
  // §29 — isWebMcpResultV1 Runtime Validator
  // ══════════════════════════════════════════════════════════════════════════

  describe('isWebMcpResultV1', () => {
    it('accepts a valid success result', () => {
      const result = {
        resultVersion: WEBMCP_RESULT_VERSION,
        success: true,
        previewFieldCount: 2,
        sessionId: '00000000-0000-0000-0000-000000000000',
      }
      expect(isWebMcpResultV1(result)).toBe(true)
    })

    it('accepts a valid error result with adapter error code', () => {
      const result = {
        resultVersion: WEBMCP_RESULT_VERSION,
        success: false,
        error: { code: 'INVALID_PARAMS', message: 'Missing required fields' },
      }
      expect(isWebMcpResultV1(result)).toBe(true)
    })

    it('accepts a valid error result with background error code', () => {
      const result = {
        resultVersion: WEBMCP_RESULT_VERSION,
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Rate limited' },
        retryAfterMs: 1500,
      }
      expect(isWebMcpResultV1(result)).toBe(true)
    })

    it('accepts TEMP_BLOCKED with retryAfterMs', () => {
      const result = {
        resultVersion: WEBMCP_RESULT_VERSION,
        success: false,
        error: { code: 'TEMP_BLOCKED', message: 'Temporarily blocked' },
        retryAfterMs: 5000,
      }
      expect(isWebMcpResultV1(result)).toBe(true)
    })

    it('rejects null', () => {
      expect(isWebMcpResultV1(null)).toBe(false)
    })

    it('rejects undefined', () => {
      expect(isWebMcpResultV1(undefined)).toBe(false)
    })

    it('rejects non-object', () => {
      expect(isWebMcpResultV1('hello')).toBe(false)
    })

    it('rejects wrong resultVersion', () => {
      expect(isWebMcpResultV1({
        resultVersion: 'webmcp-preview-v2',
        success: true,
      })).toBe(false)
    })

    it('rejects missing resultVersion', () => {
      expect(isWebMcpResultV1({
        success: true,
        previewFieldCount: 1,
      })).toBe(false)
    })

    it('rejects non-boolean success', () => {
      expect(isWebMcpResultV1({
        resultVersion: WEBMCP_RESULT_VERSION,
        success: 'yes',
      })).toBe(false)
    })

    it('rejects error result with missing error object', () => {
      expect(isWebMcpResultV1({
        resultVersion: WEBMCP_RESULT_VERSION,
        success: false,
      })).toBe(false)
    })

    it('rejects error result with unknown error.code', () => {
      expect(isWebMcpResultV1({
        resultVersion: WEBMCP_RESULT_VERSION,
        success: false,
        error: { code: 'UNKNOWN_CODE_XYZ', message: 'Something' },
      })).toBe(false)
    })

    it('rejects error result with non-string error.code', () => {
      expect(isWebMcpResultV1({
        resultVersion: WEBMCP_RESULT_VERSION,
        success: false,
        error: { code: 42, message: 'Something' },
      })).toBe(false)
    })

    it('rejects error result with non-string error.message', () => {
      expect(isWebMcpResultV1({
        resultVersion: WEBMCP_RESULT_VERSION,
        success: false,
        error: { code: 'FORBIDDEN', message: 123 },
      })).toBe(false)
    })

    it('rejects negative previewFieldCount on success', () => {
      expect(isWebMcpResultV1({
        resultVersion: WEBMCP_RESULT_VERSION,
        success: true,
        previewFieldCount: -1,
      })).toBe(false)
    })

    it('rejects non-number previewFieldCount on success', () => {
      expect(isWebMcpResultV1({
        resultVersion: WEBMCP_RESULT_VERSION,
        success: true,
        previewFieldCount: 'two',
      })).toBe(false)
    })

    it('rejects non-finite retryAfterMs', () => {
      expect(isWebMcpResultV1({
        resultVersion: WEBMCP_RESULT_VERSION,
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Rate limited' },
        retryAfterMs: Infinity,
      })).toBe(false)
    })

    it('rejects zero retryAfterMs', () => {
      expect(isWebMcpResultV1({
        resultVersion: WEBMCP_RESULT_VERSION,
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Rate limited' },
        retryAfterMs: 0,
      })).toBe(false)
    })

    it('rejects negative retryAfterMs', () => {
      expect(isWebMcpResultV1({
        resultVersion: WEBMCP_RESULT_VERSION,
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Rate limited' },
        retryAfterMs: -100,
      })).toBe(false)
    })

    it('accepts success result with optional partial scan fields', () => {
      const result = {
        resultVersion: WEBMCP_RESULT_VERSION,
        success: true,
        previewFieldCount: 1,
        partialScan: true,
        partialReason: 'element_cap',
        evaluatedCount: 100,
        elementsVisited: 1500,
        candidateCount: 80,
      }
      expect(isWebMcpResultV1(result)).toBe(true)
    })

    it('validates live adapter success result', async () => {
      const input = makeInput()
      ;(collectCandidates as any).mockReturnValue(makeScanResult({
        candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      }))
      const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)
      expect(isWebMcpResultV1(result)).toBe(true)
    })

    it('validates live adapter failure result', async () => {
      const result = await handleWebMcpFillPreviewRequest({ itemId: 'not-a-uuid' })
      expect(isWebMcpResultV1(result)).toBe(true)
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // §30 — BgWebMcpErrorCode + ALL_WEBMCP_ERROR_CODES
  // ══════════════════════════════════════════════════════════════════════════

  describe('BgWebMcpErrorCode and ALL_WEBMCP_ERROR_CODES', () => {
    it('BG_WEBMCP_ERROR_CODES contains all expected background codes', () => {
      const expected: BgWebMcpErrorCode[] = [
        'FORBIDDEN', 'RATE_LIMITED', 'TEMP_BLOCKED', 'INVALID_PARAMS',
        'INVALID_TAB', 'RESTRICTED_PAGE', 'TAB_UNREACHABLE', 'INTERNAL_ERROR',
      ]
      for (const code of expected) {
        expect(BG_WEBMCP_ERROR_CODES.has(code)).toBe(true)
      }
      expect(BG_WEBMCP_ERROR_CODES.size).toBe(expected.length)
    })

    it('ALL_WEBMCP_ERROR_CODES is the union of adapter + background codes', () => {
      for (const code of WEBMCP_ERROR_CODES) {
        expect(ALL_WEBMCP_ERROR_CODES.has(code)).toBe(true)
      }
      for (const code of BG_WEBMCP_ERROR_CODES) {
        expect(ALL_WEBMCP_ERROR_CODES.has(code)).toBe(true)
      }
      // No extra codes beyond the union
      for (const code of ALL_WEBMCP_ERROR_CODES) {
        expect(WEBMCP_ERROR_CODES.has(code) || BG_WEBMCP_ERROR_CODES.has(code)).toBe(true)
      }
    })

    it('every adapter error code is a string', () => {
      for (const code of WEBMCP_ERROR_CODES) {
        expect(typeof code).toBe('string')
        expect(code.length).toBeGreaterThan(0)
      }
    })

    it('no error code contains PII-like patterns', () => {
      const piiPatterns = [
        /[0-9a-f]{8}-[0-9a-f]{4}/i, // UUID fragment
        /@/,                          // email
        /\./,                          // domain
        /\//,                          // URL path
        / /,                           // spaces (human messages)
      ]
      for (const code of ALL_WEBMCP_ERROR_CODES) {
        for (const pattern of piiPatterns) {
          expect(code).not.toMatch(pattern)
        }
      }
    })

    it('error code sets are typed as ReadonlySet (compile-time enforcement)', () => {
      // ReadonlySet is a TypeScript-only concept; at runtime the underlying Set
      // still has .add/.delete.  What matters is that the exported type prevents
      // callers from mutating the set at compile time.  We verify the sets are
      // genuine Set instances (not plain objects) and that they are non-empty.
      expect(WEBMCP_ERROR_CODES).toBeInstanceOf(Set)
      expect(BG_WEBMCP_ERROR_CODES).toBeInstanceOf(Set)
      expect(ALL_WEBMCP_ERROR_CODES).toBeInstanceOf(Set)
      expect(WEBMCP_ERROR_CODES.size).toBeGreaterThan(0)
      expect(BG_WEBMCP_ERROR_CODES.size).toBeGreaterThan(0)
      expect(ALL_WEBMCP_ERROR_CODES.size).toBeGreaterThan(0)
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // §31 — Static Messages: no interpolation or PII in error.message
  // ══════════════════════════════════════════════════════════════════════════

  describe('error.message static safety', () => {
    const piiPatterns = [
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i,  // UUID
      /\S+@\S+\.\S+/,                            // email
      /https?:\/\//,                              // URL
      /chrome-extension:\/\//,                    // extension URL
      /input\[|select\[|textarea\[/i,            // selector
    ]

    it('invalid params error message is static', async () => {
      const result = await handleWebMcpFillPreviewRequest({ itemId: 'not-a-uuid' })
      expect(result.success).toBe(false)
      for (const p of piiPatterns) {
        expect(result.error!.message).not.toMatch(p)
      }
    })

    it('autofill disabled error message is static', async () => {
      ;(isAutofillActive as any).mockReturnValue(false)
      const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)
      expect(result.success).toBe(false)
      for (const p of piiPatterns) {
        expect(result.error!.message).not.toMatch(p)
      }
    })

    it('vault item deleted error message is static', async () => {
      ;(vaultAPI.getItemForFill as any).mockResolvedValue(null)
      const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)
      expect(result.success).toBe(false)
      for (const p of piiPatterns) {
        expect(result.error!.message).not.toMatch(p)
      }
    })

    it('no targets error message is static', async () => {
      ;(collectCandidates as any).mockReturnValue(makeScanResult({ candidates: [] }))
      const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)
      expect(result.success).toBe(false)
      for (const p of piiPatterns) {
        expect(result.error!.message).not.toMatch(p)
      }
    })

    it('guard failure error message is static', async () => {
      const input = makeInput()
      ;(collectCandidates as any).mockReturnValue(makeScanResult({
        candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      }))
      ;(guardElement as any).mockReturnValue({ safe: false, code: 'ELEMENT_HIDDEN', reason: 'off-screen' })
      const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)
      expect(result.success).toBe(false)
      for (const p of piiPatterns) {
        expect(result.error!.message).not.toMatch(p)
      }
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // §32 — retryAfterMs presence / absence
  // ══════════════════════════════════════════════════════════════════════════

  describe('retryAfterMs field contract', () => {
    it('success result does not include retryAfterMs', async () => {
      const input = makeInput()
      ;(collectCandidates as any).mockReturnValue(makeScanResult({
        candidates: [{ element: input, matchedKind: 'login.username', confidence: 90 }],
      }))
      const result = await handleWebMcpFillPreviewRequest(VALID_PARAMS)
      expect(result.success).toBe(true)
      expect('retryAfterMs' in result).toBe(false)
    })

    it('adapter error results do not include retryAfterMs', async () => {
      const result = await handleWebMcpFillPreviewRequest({ itemId: 'not-a-uuid' })
      expect(result.success).toBe(false)
      expect('retryAfterMs' in result).toBe(false)
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // §33 — Source-level: BgWebMcpErrorCode and isWebMcpResultV1 exports
  // ══════════════════════════════════════════════════════════════════════════

  it('source exports BgWebMcpErrorCode type and BG_WEBMCP_ERROR_CODES set', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const adapterPath = path.resolve(__dirname, 'webMcpAdapter.ts')
    const source = fs.readFileSync(adapterPath, 'utf-8')

    expect(source).toContain('export type BgWebMcpErrorCode')
    expect(source).toContain('export const BG_WEBMCP_ERROR_CODES')
    expect(source).toContain('export const ALL_WEBMCP_ERROR_CODES')
    expect(source).toContain('export function isWebMcpResultV1')
  })

  it('isWebMcpResultV1 uses ALL_WEBMCP_ERROR_CODES for validation', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const adapterPath = path.resolve(__dirname, 'webMcpAdapter.ts')
    const source = fs.readFileSync(adapterPath, 'utf-8')

    const fnStart = source.indexOf('export function isWebMcpResultV1')
    expect(fnStart).toBeGreaterThan(0)
    const fnBody = source.slice(fnStart, source.indexOf('\n\nconst UUID_RE'))
    expect(fnBody).toContain('ALL_WEBMCP_ERROR_CODES')
  })
})
