/**
 * Tests for the sub-analysis orchestrator (P2.4).
 *
 * Scenarios:
 *   1. Both sub-analyses succeed → outcome has both fields, no failures
 *   2. Phishing fails, crosscheck succeeds → only crosscheck field, log emitted
 *   3. Both fail → no fields set, two failures logged
 *   4. applySubAnalysesToRow: both succeed → resealWithAiAnalysis called with merged data
 *   5. applySubAnalysesToRow: no successes → reseal NOT called
 *   6. applySubAnalysesToRow: reseal failure → ok: false returned (not thrown)
 *   7. extractUrls and buildPhishingInput / buildCrosscheckInput helpers
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('../phishingAssessor', () => ({
  assessPhishing: vi.fn(),
}))
vi.mock('../validationCrosscheck', () => ({
  crosscheckValidation: vi.fn(),
}))
vi.mock('../../sealedContentUpdate', () => ({
  resealWithAiAnalysis: vi.fn(),
}))

import { runSubAnalyses, applySubAnalysesToRow, buildPhishingInput, buildCrosscheckInput } from '../subAnalysisOrchestrator'
import type { SubAnalysisRowData } from '../subAnalysisOrchestrator'
import { assessPhishing } from '../phishingAssessor'
import { crosscheckValidation } from '../validationCrosscheck'
import { resealWithAiAnalysis } from '../../sealedContentUpdate'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PROVIDER = { model: 'test-model', provider: 'ollama' }

const ROW: SubAnalysisRowData = {
  subject: 'Test message',
  body_text: 'Click here: http://example.com/path?q=1',
  from_address: 'sender@example.com',
  from_name: 'Test Sender',
  validation_reason: null,
}

const ROW_FAILED: SubAnalysisRowData = {
  ...ROW,
  validation_reason: 'STRUCTURAL_INTEGRITY_FAILURE',
}

const PHISHING_ASSESSMENT = {
  score: 10,
  label: 'low' as const,
  signals: [],
  flagged_urls: [],
  disclaimer_version: 'v1',
  model: 'test-model',
  generated_at: '2026-05-24T10:00:00.000Z',
}

const CROSSCHECK = {
  agrees_with_validator: true,
  findings: [],
  confidence: 'high' as const,
  model: 'test-model',
  generated_at: '2026-05-24T10:00:00.000Z',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockPhishingOk() {
  ;(assessPhishing as Mock).mockResolvedValueOnce({ ok: true, assessment: PHISHING_ASSESSMENT })
}
function mockPhishingFail(reason = 'timeout', detail = 'timed out') {
  ;(assessPhishing as Mock).mockResolvedValueOnce({ ok: false, reason, detail })
}
function mockCrosscheckOk() {
  ;(crosscheckValidation as Mock).mockResolvedValueOnce({ ok: true, crosscheck: CROSSCHECK })
}
function mockCrosscheckFail(reason = 'malformed_output', detail = 'bad json') {
  ;(crosscheckValidation as Mock).mockResolvedValueOnce({ ok: false, reason, detail })
}

function makeMockDb(aiAnalysisJson: string | null = null) {
  return {
    prepare: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(aiAnalysisJson !== null ? { ai_analysis_json: aiAnalysisJson } : undefined),
    }),
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runSubAnalyses (P2.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Scenario 1: both succeed ──────────────────────────────────────────────

  test('1. Both succeed → outcome has both fields, no failures', async () => {
    mockPhishingOk()
    mockCrosscheckOk()

    const outcome = await runSubAnalyses(ROW, PROVIDER)

    expect(outcome.phishing_assessment).toEqual(PHISHING_ASSESSMENT)
    expect(outcome.validation_crosscheck).toEqual(CROSSCHECK)
    expect(outcome.failures).toHaveLength(0)
  })

  // ── Scenario 2: phishing fails ────────────────────────────────────────────

  test('2. Phishing fails, crosscheck succeeds → only crosscheck field, failure logged', async () => {
    mockPhishingFail('timeout', 'LLM_TIMEOUT: took too long')
    mockCrosscheckOk()

    const outcome = await runSubAnalyses(ROW, PROVIDER)

    expect(outcome.phishing_assessment).toBeUndefined()
    expect(outcome.validation_crosscheck).toEqual(CROSSCHECK)
    expect(outcome.failures).toHaveLength(1)
    expect(outcome.failures[0]).toMatchObject({ kind: 'phishing', reason: 'timeout' })
  })

  test('2b. Crosscheck fails, phishing succeeds → only phishing field', async () => {
    mockPhishingOk()
    mockCrosscheckFail()

    const outcome = await runSubAnalyses(ROW, PROVIDER)

    expect(outcome.phishing_assessment).toEqual(PHISHING_ASSESSMENT)
    expect(outcome.validation_crosscheck).toBeUndefined()
    expect(outcome.failures).toHaveLength(1)
    expect(outcome.failures[0]).toMatchObject({ kind: 'crosscheck', reason: 'malformed_output' })
  })

  // ── Scenario 3: both fail ─────────────────────────────────────────────────

  test('3. Both fail → no fields set, two failures in array', async () => {
    mockPhishingFail('provider_error', 'ECONNREFUSED')
    mockCrosscheckFail('model_unavailable', 'No AI model selected')

    const outcome = await runSubAnalyses(ROW, PROVIDER)

    expect(outcome.phishing_assessment).toBeUndefined()
    expect(outcome.validation_crosscheck).toBeUndefined()
    expect(outcome.failures).toHaveLength(2)
    expect(outcome.failures[0]).toMatchObject({ kind: 'phishing', reason: 'provider_error' })
    expect(outcome.failures[1]).toMatchObject({ kind: 'crosscheck', reason: 'model_unavailable' })
  })

  test('3b. Promise rejection is treated as failure (not thrown)', async () => {
    ;(assessPhishing as Mock).mockRejectedValueOnce(new Error('unexpected throw'))
    mockCrosscheckOk()

    const outcome = await runSubAnalyses(ROW, PROVIDER)
    expect(outcome.phishing_assessment).toBeUndefined()
    expect(outcome.validation_crosscheck).toEqual(CROSSCHECK)
    expect(outcome.failures[0]).toMatchObject({ kind: 'phishing', reason: 'provider_error' })
  })
})

describe('applySubAnalysesToRow (P2.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(resealWithAiAnalysis as Mock).mockResolvedValue({ ok: true })
  })

  // ── Scenario 4: both succeed → reseal called with merged data ─────────────

  test('4. Both succeed → resealWithAiAnalysis called with both fields', async () => {
    const outcome = {
      phishing_assessment: PHISHING_ASSESSMENT,
      validation_crosscheck: CROSSCHECK,
      failures: [],
    }
    const db = makeMockDb()

    const result = await applySubAnalysesToRow(db, 'msg-1', outcome)

    expect(result.ok).toBe(true)
    expect(resealWithAiAnalysis).toHaveBeenCalledOnce()
    const [, , merged] = (resealWithAiAnalysis as Mock).mock.calls[0]!
    expect(merged).toMatchObject({
      phishing_assessment: PHISHING_ASSESSMENT,
      validation_crosscheck: CROSSCHECK,
    })
  })

  test('4b. Existing ai_analysis_json is preserved (merged, not overwritten)', async () => {
    const existing = { summary: 'old summary', status: 'analyzed' }
    const outcome = {
      phishing_assessment: PHISHING_ASSESSMENT,
      validation_crosscheck: undefined,
      failures: [{ kind: 'crosscheck' as const, reason: 'timeout', detail: '' }],
    }
    const db = makeMockDb(JSON.stringify(existing))

    await applySubAnalysesToRow(db, 'msg-1', outcome)

    const [, , merged] = (resealWithAiAnalysis as Mock).mock.calls[0]!
    expect(merged).toMatchObject({
      summary: 'old summary',
      status: 'analyzed',
      phishing_assessment: PHISHING_ASSESSMENT,
    })
    expect(merged['validation_crosscheck']).toBeUndefined()
  })

  // ── Scenario 5: no successes → reseal NOT called ──────────────────────────

  test('5. Both fail → resealWithAiAnalysis is NOT called', async () => {
    const outcome = {
      failures: [
        { kind: 'phishing' as const, reason: 'timeout', detail: '' },
        { kind: 'crosscheck' as const, reason: 'timeout', detail: '' },
      ],
    }
    const db = makeMockDb()

    const result = await applySubAnalysesToRow(db, 'msg-1', outcome)

    expect(result.ok).toBe(false)
    expect(resealWithAiAnalysis).not.toHaveBeenCalled()
  })

  // ── Scenario 6: reseal failure → ok: false, not thrown ───────────────────

  test('6. Reseal failure → ok: false returned, not thrown', async () => {
    ;(resealWithAiAnalysis as Mock).mockResolvedValueOnce({ ok: false, error: 'validator rejected' })

    const outcome = {
      phishing_assessment: PHISHING_ASSESSMENT,
      validation_crosscheck: CROSSCHECK,
      failures: [],
    }
    const db = makeMockDb()

    const result = await applySubAnalysesToRow(db, 'msg-1', outcome)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok: false')
    expect(result.reason).toContain('validator')
  })
})

describe('buildPhishingInput / buildCrosscheckInput helpers (P2.4)', () => {
  test('buildPhishingInput extracts URLs from body_text', () => {
    const input = buildPhishingInput(ROW)
    expect(input.urls).toHaveLength(1)
    expect(input.urls[0]!.href).toBe('http://example.com/path?q=1')
    expect(input.subject).toBe('Test message')
    expect(input.sender_email).toBe('sender@example.com')
  })

  test('buildCrosscheckInput: validation_reason null → validator_passed: true', () => {
    const input = buildCrosscheckInput(ROW)
    expect(input.validator_passed).toBe(true)
    expect(input.validator_signals).toHaveLength(0)
  })

  test('buildCrosscheckInput: validation_reason set → validator_passed: false, signal present', () => {
    const input = buildCrosscheckInput(ROW_FAILED)
    expect(input.validator_passed).toBe(false)
    expect(input.validator_signals).toHaveLength(1)
    expect(input.validator_signals[0]!.reason_code).toBe('STRUCTURAL_INTEGRITY_FAILURE')
  })
})
