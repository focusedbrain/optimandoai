/**
 * Tests for the validation cross-check module (P2.3).
 *
 * Required scenarios:
 *   1. Agreement case → ok: true, agrees_with_validator: true
 *   2. Disagreement case → ok: true, agrees_with_validator: false
 *   3. Malformed output → ok: false, reason: malformed_output
 *   4. Timeout → ok: false, reason: timeout
 *   5. Snapshot test: prompt string is stable
 *   +  Schema mismatch (bad confidence) → ok: false, reason: malformed_output
 *   +  provider_error
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('../../inboxLlmChat', () => ({
  inboxLlmChat: vi.fn(),
  InboxLlmTimeoutError: class InboxLlmTimeoutError extends Error {
    constructor(message = 'LLM_TIMEOUT') {
      super(message)
      this.name = 'InboxLlmTimeoutError'
    }
  },
  INBOX_LLM_TIMEOUT_MS: 45_000,
}))

import { crosscheckValidation, CROSSCHECK_TIMEOUT_MS, CROSSCHECK_VERSION } from '../validationCrosscheck'
import type { CrosscheckInput, LlmProvider } from '../validationCrosscheck'
import {
  buildCrosscheckSystemPrompt,
  buildCrosscheckUserMessage,
} from '../validationCrosscheck.prompt'
import { inboxLlmChat, InboxLlmTimeoutError } from '../../inboxLlmChat'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PROVIDER: LlmProvider = {
  model: 'test-crosscheck-model',
  provider: 'ollama',
}

const PASSING_INPUT: CrosscheckInput = {
  subject: 'Welcome to Acme Corp',
  body_text: 'Thanks for signing up. Here is your receipt.',
  headers: { 'From': 'noreply@acmecorp.com', 'DKIM-Signature': 'v=1; a=rsa-sha256;' },
  sender_display_name: 'Acme Corp',
  sender_email: 'noreply@acmecorp.com',
  validator_passed: true,
  validator_signals: [],
}

const FAILING_INPUT: CrosscheckInput = {
  subject: 'Urgent: account suspended',
  body_text: 'Your account has been suspended. Verify now: http://paypa1.com/verify',
  headers: { 'From': 'support@paypa1.com', 'Reply-To': 'harvest@evil.net' },
  sender_display_name: 'PayPal Support',
  sender_email: 'support@paypa1.com',
  validator_passed: false,
  validator_signals: [
    { reason_code: 'STRUCTURAL_INTEGRITY_FAILURE', details: 'capsule schema mismatch' },
  ],
}

const AGREEMENT_JSON = {
  agrees_with_validator: true,
  findings: [{ kind: 'corroborates_validator', evidence: 'DKIM-Signature present and sender matches display name' }],
  confidence: 'high',
  model: 'test-crosscheck-model',
  generated_at: '2026-05-24T10:00:00.000Z',
}

const DISAGREEMENT_JSON = {
  agrees_with_validator: false,
  findings: [
    { kind: 'contradicts_validator_outcome', evidence: 'lookalike domain paypa1.com visible in plain body' },
    { kind: 'urgency_pressure', evidence: 'account suspended language combined with immediate action request' },
  ],
  confidence: 'medium',
  model: 'test-crosscheck-model',
  generated_at: '2026-05-24T10:00:00.000Z',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockLlmReturns(text: string): void {
  ;(inboxLlmChat as Mock).mockResolvedValueOnce(text)
}

function mockLlmThrows(err: unknown): void {
  ;(inboxLlmChat as Mock).mockRejectedValueOnce(err)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('crosscheckValidation (P2.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Scenario 1: agreement ─────────────────────────────────────────────────

  test('1. Agreement case → ok: true, agrees_with_validator: true', async () => {
    mockLlmReturns(JSON.stringify(AGREEMENT_JSON))

    const result = await crosscheckValidation(PASSING_INPUT, PROVIDER)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('not ok')

    expect(result.crosscheck.agrees_with_validator).toBe(true)
    expect(result.crosscheck.findings).toHaveLength(1)
    expect(result.crosscheck.confidence).toBe('high')
    // Authoritative fields stamped by the module
    expect(result.crosscheck.model).toBe(PROVIDER.model)
    expect(result.crosscheck.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test('1b. Model wraps JSON in code fence → still ok: true', async () => {
    mockLlmReturns('```json\n' + JSON.stringify(AGREEMENT_JSON) + '\n```')
    const result = await crosscheckValidation(PASSING_INPUT, PROVIDER)
    expect(result.ok).toBe(true)
  })

  test('1c. inboxLlmChat is called with correct context and timeout', async () => {
    mockLlmReturns(JSON.stringify(AGREEMENT_JSON))
    await crosscheckValidation(PASSING_INPUT, PROVIDER)

    const call = (inboxLlmChat as Mock).mock.calls[0]![0]
    expect(call.resolvedContext).toEqual(PROVIDER)
    expect(call.timeoutMs).toBe(CROSSCHECK_TIMEOUT_MS)
    expect(call.system).toContain('CANONICAL AUTHORITY')
    expect(call.system).toContain('PASSED')
    expect(call.user).toContain(PASSING_INPUT.subject)
    expect(call.user).toContain(PASSING_INPUT.sender_email)
  })

  test('1d. Validator signals appear in system prompt', async () => {
    mockLlmReturns(JSON.stringify(AGREEMENT_JSON))
    await crosscheckValidation(FAILING_INPUT, PROVIDER)

    const call = (inboxLlmChat as Mock).mock.calls[0]![0]
    expect(call.system).toContain('FAILED')
    expect(call.system).toContain('STRUCTURAL_INTEGRITY_FAILURE')
    expect(call.system).toContain('capsule schema mismatch')
  })

  // ── Scenario 2: disagreement ──────────────────────────────────────────────

  test('2. Disagreement case → ok: true, agrees_with_validator: false', async () => {
    mockLlmReturns(JSON.stringify(DISAGREEMENT_JSON))

    const result = await crosscheckValidation(FAILING_INPUT, PROVIDER)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('not ok')

    expect(result.crosscheck.agrees_with_validator).toBe(false)
    expect(result.crosscheck.findings).toHaveLength(2)
    expect(result.crosscheck.findings[0]).toMatchObject({
      kind: 'contradicts_validator_outcome',
    })
    expect(result.crosscheck.confidence).toBe('medium')
  })

  // ── Scenario 3: malformed output ──────────────────────────────────────────

  test('3a. Malformed JSON → ok: false, reason: malformed_output', async () => {
    mockLlmReturns('I cannot help with security tasks.')

    const result = await crosscheckValidation(PASSING_INPUT, PROVIDER)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok: false')
    expect(result.reason).toBe('malformed_output')
    expect(result.detail).toMatch(/JSON parse failed/i)
  })

  test('3b. Empty response → malformed_output', async () => {
    mockLlmReturns('')
    const result = await crosscheckValidation(PASSING_INPUT, PROVIDER)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok: false')
    expect(result.reason).toBe('malformed_output')
  })

  test('3c. Array instead of object → malformed_output', async () => {
    mockLlmReturns(JSON.stringify([AGREEMENT_JSON]))
    const result = await crosscheckValidation(PASSING_INPUT, PROVIDER)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok: false')
    expect(result.reason).toBe('malformed_output')
  })

  test('3d. Schema mismatch: confidence = "certain" (unknown enum) → malformed_output', async () => {
    mockLlmReturns(JSON.stringify({ ...AGREEMENT_JSON, confidence: 'certain' }))
    const result = await crosscheckValidation(PASSING_INPUT, PROVIDER)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok: false')
    expect(result.reason).toBe('malformed_output')
    expect(result.detail).toMatch(/Schema validation failed/i)
  })

  test('3e. Missing agrees_with_validator → malformed_output', async () => {
    const { agrees_with_validator: _, ...noAgrees } = AGREEMENT_JSON
    mockLlmReturns(JSON.stringify(noAgrees))
    const result = await crosscheckValidation(PASSING_INPUT, PROVIDER)
    expect(result.ok).toBe(false)
  })

  test('3f. Missing findings → malformed_output', async () => {
    const { findings: _, ...noFindings } = AGREEMENT_JSON
    mockLlmReturns(JSON.stringify(noFindings))
    const result = await crosscheckValidation(PASSING_INPUT, PROVIDER)
    expect(result.ok).toBe(false)
  })

  test('3g. generated_at not ISO 8601 → malformed_output', async () => {
    mockLlmReturns(JSON.stringify({ ...AGREEMENT_JSON, generated_at: 'today' }))
    const result = await crosscheckValidation(PASSING_INPUT, PROVIDER)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok: false')
    expect(result.reason).toBe('malformed_output')
  })

  // ── Scenario 4: timeout ───────────────────────────────────────────────────

  test('4. Timeout → ok: false, reason: timeout', async () => {
    const { InboxLlmTimeoutError: TimeoutErr } = await import('../../inboxLlmChat')
    mockLlmThrows(new TimeoutErr('LLM_TIMEOUT: crosscheck exceeded 30000ms'))

    const result = await crosscheckValidation(PASSING_INPUT, PROVIDER)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok: false')
    expect(result.reason).toBe('timeout')
    expect(result.detail).toMatch(/LLM_TIMEOUT/i)
  })

  // ── Scenario 5: prompt snapshot ───────────────────────────────────────────

  test('5. Prompt string is stable (catches accidental prompt edits)', () => {
    const system = buildCrosscheckSystemPrompt({
      modelName: 'snapshot-model',
      nowIso: '2026-01-01T00:00:00.000Z',
      validatorPassed: true,
      validatorSignalSummary: '(no signals)',
    })
    const user = buildCrosscheckUserMessage({
      subject: 'Test subject',
      senderDisplayName: 'Bob',
      senderEmail: 'bob@example.com',
      headers: { From: 'bob@example.com' },
      bodyText: 'Hello world',
    })

    // Authority rule must be present verbatim
    expect(system).toContain('CANONICAL AUTHORITY')
    expect(system).toContain('Its decision is final and sealed')
    expect(system).toContain('You are a cross-check, not an override')

    // Schema markers
    expect(system).toContain('"agrees_with_validator": <boolean>')
    expect(system).toContain('"confidence": <"low" | "medium" | "high">')
    expect(system).toContain('"model": "snapshot-model"')
    expect(system).toContain('"generated_at": "2026-01-01T00:00:00.000Z"')

    // Confidence rubric
    expect(system).toContain('"high"')
    expect(system).toContain('"medium"')
    expect(system).toContain('"low"')

    // Validator outcome injection
    expect(system).toContain('PASSED')

    // User message
    expect(user).toContain('Test subject')
    expect(user).toContain('bob@example.com')

    // Version token — change assertion here if CROSSCHECK_VERSION bumps
    expect(CROSSCHECK_VERSION).toBe('v1')
  })

  // ── Additional: provider_error ────────────────────────────────────────────

  test('Network/provider error → ok: false, reason: provider_error', async () => {
    mockLlmThrows(new Error('ECONNREFUSED ollama'))
    const result = await crosscheckValidation(PASSING_INPUT, PROVIDER)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok: false')
    expect(result.reason).toBe('provider_error')
    expect(result.detail).toMatch(/ECONNREFUSED/)
  })
})
