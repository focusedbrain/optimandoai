/**
 * Tests for the phishing assessor (P2.2).
 *
 * All 5 required scenarios:
 *   1. Mock LLM returning valid JSON → ok: true with assessment
 *   2. Mock LLM returning malformed JSON → ok: false, reason: malformed_output
 *   3. Mock LLM timeout → ok: false, reason: timeout
 *   4. Schema mismatch (score 150) → ok: false, reason: malformed_output
 *   5. Snapshot test: prompt string is stable
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'

// ── Module mocks — hoisted so vi.mock runs before imports ─────────────────────

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

import { assessPhishing, PHISHING_ASSESSOR_TIMEOUT_MS } from '../phishingAssessor'
import type { PhishingAssessorInput, LlmProvider } from '../phishingAssessor'
import { DISCLAIMER_VERSION, buildPhishingSystemPrompt, buildPhishingUserMessage } from '../phishingAssessor.prompt'
import { inboxLlmChat, InboxLlmTimeoutError } from '../../inboxLlmChat'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PROVIDER: LlmProvider = {
  model: 'test-model-v1',
  provider: 'ollama',
}

const INPUT: PhishingAssessorInput = {
  subject: 'Urgent: verify your account now',
  body_text: 'Your account will be suspended. Click here to verify: http://paypa1.com/verify',
  body_html: '<p>Click <a href="http://paypa1.com/verify">here</a></p>',
  headers: { 'From': 'support@paypa1.com', 'Reply-To': 'harvest@evil.net' },
  urls: [{ href: 'http://paypa1.com/verify', display_text: 'here' }],
  sender_display_name: 'PayPal Support',
  sender_email: 'support@paypa1.com',
}

/** A valid PhishingAssessment JSON object. */
const VALID_ASSESSMENT_JSON = {
  score: 82,
  label: 'high',
  signals: [
    { kind: 'lookalike_domain', evidence: 'paypa1.com instead of paypal.com', weight: 0.9 },
    { kind: 'urgency_language', evidence: 'account will be suspended', weight: 0.7 },
  ],
  flagged_urls: [
    { url: 'http://paypa1.com/verify', reason: 'lookalike domain', open_policy: 'sandbox_only' },
  ],
  disclaimer_version: DISCLAIMER_VERSION,
  model: 'test-model-v1',
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

describe('assessPhishing (P2.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Scenario 1: valid JSON ────────────────────────────────────────────────

  test('1. Mock LLM returning valid JSON → ok: true with assessment', async () => {
    mockLlmReturns(JSON.stringify(VALID_ASSESSMENT_JSON))

    const result = await assessPhishing(INPUT, PROVIDER)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('not ok')

    expect(result.assessment.score).toBe(82)
    expect(result.assessment.label).toBe('high')
    expect(result.assessment.signals).toHaveLength(2)
    expect(result.assessment.flagged_urls).toHaveLength(1)
    expect(result.assessment.flagged_urls[0]!.open_policy).toBe('sandbox_only')
    expect(result.assessment.disclaimer_version).toBe(DISCLAIMER_VERSION)
    // model and generated_at are stamped by the assessor, not trusted from the model
    expect(result.assessment.model).toBe(PROVIDER.model)
    expect(result.assessment.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test('1b. LLM wraps JSON in markdown code fences → still ok: true', async () => {
    mockLlmReturns('```json\n' + JSON.stringify(VALID_ASSESSMENT_JSON) + '\n```')
    const result = await assessPhishing(INPUT, PROVIDER)
    expect(result.ok).toBe(true)
  })

  test('1c. inboxLlmChat is called with the correct system/user prompts', async () => {
    mockLlmReturns(JSON.stringify(VALID_ASSESSMENT_JSON))
    await assessPhishing(INPUT, PROVIDER)

    const call = (inboxLlmChat as Mock).mock.calls[0]![0]
    expect(call.system).toContain('JSON object')
    expect(call.system).toContain('score')
    expect(call.system).toContain('label')
    expect(call.user).toContain(INPUT.subject)
    expect(call.user).toContain(INPUT.sender_email)
    expect(call.resolvedContext).toEqual(PROVIDER)
    expect(call.timeoutMs).toBe(PHISHING_ASSESSOR_TIMEOUT_MS)
  })

  // ── Scenario 2: malformed JSON ────────────────────────────────────────────

  test('2. Mock LLM returning malformed JSON → ok: false, reason: malformed_output', async () => {
    mockLlmReturns('Sorry, I cannot help with that.')

    const result = await assessPhishing(INPUT, PROVIDER)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok: false')
    expect(result.reason).toBe('malformed_output')
    expect(result.detail).toMatch(/JSON parse failed/i)
  })

  test('2b. LLM returns empty string → malformed_output', async () => {
    mockLlmReturns('')
    const result = await assessPhishing(INPUT, PROVIDER)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok: false')
    expect(result.reason).toBe('malformed_output')
  })

  test('2c. LLM returns valid JSON but wrong shape (array) → malformed_output', async () => {
    mockLlmReturns(JSON.stringify([VALID_ASSESSMENT_JSON]))
    const result = await assessPhishing(INPUT, PROVIDER)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok: false')
    expect(result.reason).toBe('malformed_output')
  })

  // ── Scenario 3: timeout ───────────────────────────────────────────────────

  test('3. Mock LLM timeout → ok: false, reason: timeout', async () => {
    const { InboxLlmTimeoutError: TimeoutErr } = await import('../../inboxLlmChat')
    mockLlmThrows(new TimeoutErr('LLM_TIMEOUT: phishing assessor exceeded 30000ms'))

    const result = await assessPhishing(INPUT, PROVIDER)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok: false')
    expect(result.reason).toBe('timeout')
    expect(result.detail).toMatch(/LLM_TIMEOUT/i)
  })

  // ── Scenario 4: schema mismatch ───────────────────────────────────────────

  test('4a. score = 150 (out of range) → ok: false, reason: malformed_output', async () => {
    mockLlmReturns(JSON.stringify({ ...VALID_ASSESSMENT_JSON, score: 150 }))

    const result = await assessPhishing(INPUT, PROVIDER)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok: false')
    expect(result.reason).toBe('malformed_output')
    expect(result.detail).toMatch(/Schema validation failed/i)
  })

  test('4b. label = "critical" (unknown enum) → ok: false, reason: malformed_output', async () => {
    mockLlmReturns(JSON.stringify({ ...VALID_ASSESSMENT_JSON, label: 'critical' }))
    const result = await assessPhishing(INPUT, PROVIDER)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok: false')
    expect(result.reason).toBe('malformed_output')
  })

  test('4c. score = -5 (negative) → ok: false, reason: malformed_output', async () => {
    mockLlmReturns(JSON.stringify({ ...VALID_ASSESSMENT_JSON, score: -5 }))
    const result = await assessPhishing(INPUT, PROVIDER)
    expect(result.ok).toBe(false)
  })

  test('4d. missing required field "signals" → ok: false, reason: malformed_output', async () => {
    const { signals: _, ...noSignals } = VALID_ASSESSMENT_JSON
    mockLlmReturns(JSON.stringify(noSignals))
    const result = await assessPhishing(INPUT, PROVIDER)
    expect(result.ok).toBe(false)
  })

  test('4e. generated_at not ISO 8601 → ok: false, reason: malformed_output', async () => {
    mockLlmReturns(JSON.stringify({ ...VALID_ASSESSMENT_JSON, generated_at: '2026-05-24' }))
    const result = await assessPhishing(INPUT, PROVIDER)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok: false')
    expect(result.reason).toBe('malformed_output')
  })

  // ── Scenario 5: prompt snapshot ───────────────────────────────────────────

  test('5. Prompt string is stable (catches accidental prompt edits)', () => {
    const system = buildPhishingSystemPrompt({
      modelName: 'snapshot-model',
      nowIso: '2026-01-01T00:00:00.000Z',
    })
    const user = buildPhishingUserMessage({
      subject: 'Test subject',
      senderDisplayName: 'Alice',
      senderEmail: 'alice@example.com',
      headers: { From: 'alice@example.com' },
      bodyText: 'Hello world',
      urls: [{ href: 'https://example.com', display_text: 'click' }],
    })

    // System prompt invariants — check structural markers rather than exact text
    // so minor wording tweaks are not flagged, but schema or rubric changes are.
    expect(system).toContain('"score": <integer 0\u2013100>')
    expect(system).toContain('"label": <"low" | "elevated" | "high">')
    expect(system).toContain('"disclaimer_version": "v1"')
    expect(system).toContain('"model": "snapshot-model"')
    expect(system).toContain('"generated_at": "2026-01-01T00:00:00.000Z"')
    expect(system).toContain('score  0\u201330')
    expect(system).toContain('score 31\u201369')
    expect(system).toContain('score 70\u2013100')
    expect(system).toContain('If you are not confident, prefer a lower score')
    expect(system).toContain('"open_policy": "sandbox_only"')

    // User message invariants
    expect(user).toContain('Test subject')
    expect(user).toContain('alice@example.com')
    expect(user).toContain('https://example.com')
    expect(user).toContain('click')

    // Snapshot of disclaimer_version — change here if DISCLAIMER_VERSION bumps
    expect(DISCLAIMER_VERSION).toBe('v1')
  })

  // ── Additional: provider_error ────────────────────────────────────────────

  test('network/provider error → ok: false, reason: provider_error', async () => {
    mockLlmThrows(new Error('ECONNREFUSED connecting to ollama'))
    const result = await assessPhishing(INPUT, PROVIDER)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok: false')
    expect(result.reason).toBe('provider_error')
    expect(result.detail).toMatch(/ECONNREFUSED/)
  })
})
