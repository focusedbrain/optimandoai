/**
 * Tests for the extended ai_analysis_json validator (P2.1).
 *
 * Covers the 8 required scenarios from the P2.1 prompt:
 *   1. Row without either sub-field → valid
 *   2. Row with only phishing_assessment → valid
 *   3. Row with only validation_crosscheck → valid
 *   4. Row with both sub-fields → valid
 *   5. phishing_assessment.score out of range → AI_PHISHING_ASSESSMENT_INVALID
 *   6. phishing_assessment.label unknown enum → AI_PHISHING_ASSESSMENT_INVALID
 *   7. validation_crosscheck.confidence unknown enum → AI_VALIDATION_CROSSCHECK_INVALID
 *   8. generated_at not ISO 8601 → rejected (phishing_assessment and validation_crosscheck variants)
 *
 * All tests drive through validateDecryptedBeapContent with content_type 'beap_message'
 * so they exercise the real call path (beap_message → validateAiAnalysisField).
 */

import { describe, test, expect } from 'vitest';
import { validateDecryptedBeapContent } from '../src/contentValidator.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimum valid beap_message content (no ai_analysis_json). */
function baseContent(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    content_type: 'beap_message',
    subject: 'Test',
    body: 'Hello',
    transport_plaintext: '',
    attachments_canonical: [],
    ...extra,
  };
}

/** A fully-valid PhishingAssessment object. */
const validPhishingAssessment = {
  score: 42,
  label: 'elevated',
  signals: ['suspicious_link', 'urgency_language'],
  flagged_urls: ['http://evil.example.com'],
  disclaimer_version: 'v1.0',
  model: 'wrdesk-phishing-v1',
  generated_at: '2026-05-24T10:00:00.000Z',
};

/** A fully-valid ValidationCrosscheck object. */
const validValidationCrosscheck = {
  agrees_with_validator: true,
  findings: ['capsule_structure_ok'],
  confidence: 'high',
  model: 'wrdesk-crosscheck-v1',
  generated_at: '2026-05-24T10:00:01Z',
};

// ── Test suite ────────────────────────────────────────────────────────────────

describe('ai_analysis_json schema validation (P2.1)', () => {
  // ── Scenario 1: No sub-fields ─────────────────────────────────────────────

  test('1. beap_message without ai_analysis_json → valid', () => {
    const r = validateDecryptedBeapContent(baseContent());
    expect(r.validation_reason).toBeNull();
  });

  test('1b. beap_message with ai_analysis_json: null → valid (null = cleared)', () => {
    const r = validateDecryptedBeapContent(baseContent({ ai_analysis_json: null }));
    expect(r.validation_reason).toBeNull();
  });

  test('1c. beap_message with empty ai_analysis_json object → valid', () => {
    const r = validateDecryptedBeapContent(baseContent({ ai_analysis_json: {} }));
    expect(r.validation_reason).toBeNull();
  });

  // ── Scenario 2: Only phishing_assessment ─────────────────────────────────

  test('2. ai_analysis_json with only phishing_assessment → valid', () => {
    const r = validateDecryptedBeapContent(
      baseContent({ ai_analysis_json: { phishing_assessment: validPhishingAssessment } }),
    );
    expect(r.validation_reason).toBeNull();
  });

  // ── Scenario 3: Only validation_crosscheck ───────────────────────────────

  test('3. ai_analysis_json with only validation_crosscheck → valid', () => {
    const r = validateDecryptedBeapContent(
      baseContent({ ai_analysis_json: { validation_crosscheck: validValidationCrosscheck } }),
    );
    expect(r.validation_reason).toBeNull();
  });

  // ── Scenario 4: Both sub-fields present ─────────────────────────────────

  test('4. ai_analysis_json with both phishing_assessment and validation_crosscheck → valid', () => {
    const r = validateDecryptedBeapContent(
      baseContent({
        ai_analysis_json: {
          phishing_assessment: validPhishingAssessment,
          validation_crosscheck: validValidationCrosscheck,
        },
      }),
    );
    expect(r.validation_reason).toBeNull();
  });

  // ── Scenario 5: phishing_assessment.score out of range ───────────────────

  test('5a. phishing_assessment.score = 101 → AI_PHISHING_ASSESSMENT_INVALID', () => {
    const r = validateDecryptedBeapContent(
      baseContent({
        ai_analysis_json: {
          phishing_assessment: { ...validPhishingAssessment, score: 101 },
        },
      }),
    );
    expect(r.validation_reason).toBe('AI_PHISHING_ASSESSMENT_INVALID');
    expect(r.validation_details).toMatch(/score/);
  });

  test('5b. phishing_assessment.score = -1 → AI_PHISHING_ASSESSMENT_INVALID', () => {
    const r = validateDecryptedBeapContent(
      baseContent({
        ai_analysis_json: {
          phishing_assessment: { ...validPhishingAssessment, score: -1 },
        },
      }),
    );
    expect(r.validation_reason).toBe('AI_PHISHING_ASSESSMENT_INVALID');
  });

  test('5c. phishing_assessment.score = 50.5 (non-integer) → AI_PHISHING_ASSESSMENT_INVALID', () => {
    const r = validateDecryptedBeapContent(
      baseContent({
        ai_analysis_json: {
          phishing_assessment: { ...validPhishingAssessment, score: 50.5 },
        },
      }),
    );
    expect(r.validation_reason).toBe('AI_PHISHING_ASSESSMENT_INVALID');
  });

  test('5d. phishing_assessment.score = 0 (boundary) → valid', () => {
    const r = validateDecryptedBeapContent(
      baseContent({
        ai_analysis_json: {
          phishing_assessment: { ...validPhishingAssessment, score: 0 },
        },
      }),
    );
    expect(r.validation_reason).toBeNull();
  });

  test('5e. phishing_assessment.score = 100 (boundary) → valid', () => {
    const r = validateDecryptedBeapContent(
      baseContent({
        ai_analysis_json: {
          phishing_assessment: { ...validPhishingAssessment, score: 100 },
        },
      }),
    );
    expect(r.validation_reason).toBeNull();
  });

  // ── Scenario 6: phishing_assessment.label unknown enum ───────────────────

  test('6a. phishing_assessment.label = "critical" → AI_PHISHING_ASSESSMENT_INVALID', () => {
    const r = validateDecryptedBeapContent(
      baseContent({
        ai_analysis_json: {
          phishing_assessment: { ...validPhishingAssessment, label: 'critical' },
        },
      }),
    );
    expect(r.validation_reason).toBe('AI_PHISHING_ASSESSMENT_INVALID');
    expect(r.validation_details).toMatch(/label/);
  });

  test('6b. phishing_assessment.label valid values → valid ("low", "elevated", "high")', () => {
    for (const label of ['low', 'elevated', 'high']) {
      const r = validateDecryptedBeapContent(
        baseContent({
          ai_analysis_json: {
            phishing_assessment: { ...validPhishingAssessment, label },
          },
        }),
      );
      expect(r.validation_reason).toBeNull();
    }
  });

  // ── Scenario 7: validation_crosscheck.confidence unknown enum ────────────

  test('7a. validation_crosscheck.confidence = "very_high" → AI_VALIDATION_CROSSCHECK_INVALID', () => {
    const r = validateDecryptedBeapContent(
      baseContent({
        ai_analysis_json: {
          validation_crosscheck: { ...validValidationCrosscheck, confidence: 'very_high' },
        },
      }),
    );
    expect(r.validation_reason).toBe('AI_VALIDATION_CROSSCHECK_INVALID');
    expect(r.validation_details).toMatch(/confidence/);
  });

  test('7b. validation_crosscheck.confidence valid values → valid ("low", "medium", "high")', () => {
    for (const confidence of ['low', 'medium', 'high']) {
      const r = validateDecryptedBeapContent(
        baseContent({
          ai_analysis_json: {
            validation_crosscheck: { ...validValidationCrosscheck, confidence },
          },
        }),
      );
      expect(r.validation_reason).toBeNull();
    }
  });

  test('7c. validation_crosscheck.agrees_with_validator not boolean → AI_VALIDATION_CROSSCHECK_INVALID', () => {
    const r = validateDecryptedBeapContent(
      baseContent({
        ai_analysis_json: {
          validation_crosscheck: { ...validValidationCrosscheck, agrees_with_validator: 'yes' },
        },
      }),
    );
    expect(r.validation_reason).toBe('AI_VALIDATION_CROSSCHECK_INVALID');
  });

  // ── Scenario 8: generated_at not ISO 8601 ────────────────────────────────

  test('8a. phishing_assessment.generated_at not ISO 8601 → AI_PHISHING_ASSESSMENT_INVALID', () => {
    const r = validateDecryptedBeapContent(
      baseContent({
        ai_analysis_json: {
          phishing_assessment: { ...validPhishingAssessment, generated_at: '2026-05-24' },
        },
      }),
    );
    expect(r.validation_reason).toBe('AI_PHISHING_ASSESSMENT_INVALID');
    expect(r.validation_details).toMatch(/generated_at/);
  });

  test('8b. validation_crosscheck.generated_at not ISO 8601 → AI_VALIDATION_CROSSCHECK_INVALID', () => {
    const r = validateDecryptedBeapContent(
      baseContent({
        ai_analysis_json: {
          validation_crosscheck: {
            ...validValidationCrosscheck,
            generated_at: 'not-a-date',
          },
        },
      }),
    );
    expect(r.validation_reason).toBe('AI_VALIDATION_CROSSCHECK_INVALID');
    expect(r.validation_details).toMatch(/generated_at/);
  });

  test('8c. generated_at with UTC timezone → valid', () => {
    const r = validateDecryptedBeapContent(
      baseContent({
        ai_analysis_json: {
          phishing_assessment: {
            ...validPhishingAssessment,
            generated_at: '2026-05-24T10:00:00Z',
          },
        },
      }),
    );
    expect(r.validation_reason).toBeNull();
  });

  test('8d. generated_at with positive offset → valid', () => {
    const r = validateDecryptedBeapContent(
      baseContent({
        ai_analysis_json: {
          phishing_assessment: {
            ...validPhishingAssessment,
            generated_at: '2026-05-24T12:00:00+02:00',
          },
        },
      }),
    );
    expect(r.validation_reason).toBeNull();
  });

  // ── Additional edge cases ─────────────────────────────────────────────────

  test('phishing_assessment not an object → AI_PHISHING_ASSESSMENT_INVALID', () => {
    const r = validateDecryptedBeapContent(
      baseContent({ ai_analysis_json: { phishing_assessment: 'low' } }),
    );
    expect(r.validation_reason).toBe('AI_PHISHING_ASSESSMENT_INVALID');
  });

  test('validation_crosscheck not an object → AI_VALIDATION_CROSSCHECK_INVALID', () => {
    const r = validateDecryptedBeapContent(
      baseContent({ ai_analysis_json: { validation_crosscheck: [] } }),
    );
    expect(r.validation_reason).toBe('AI_VALIDATION_CROSSCHECK_INVALID');
  });

  test('phishing_assessment.signals not array → AI_PHISHING_ASSESSMENT_INVALID', () => {
    const r = validateDecryptedBeapContent(
      baseContent({
        ai_analysis_json: {
          phishing_assessment: { ...validPhishingAssessment, signals: 'suspicious' },
        },
      }),
    );
    expect(r.validation_reason).toBe('AI_PHISHING_ASSESSMENT_INVALID');
  });

  test('validation_crosscheck.findings not array → AI_VALIDATION_CROSSCHECK_INVALID', () => {
    const r = validateDecryptedBeapContent(
      baseContent({
        ai_analysis_json: {
          validation_crosscheck: { ...validValidationCrosscheck, findings: null },
        },
      }),
    );
    expect(r.validation_reason).toBe('AI_VALIDATION_CROSSCHECK_INVALID');
  });

  test('ai_analysis_json is an array → MISSING_REQUIRED_FIELD (top-level guard)', () => {
    const r = validateDecryptedBeapContent(
      baseContent({ ai_analysis_json: [validPhishingAssessment] }),
    );
    expect(r.validation_reason).toBe('MISSING_REQUIRED_FIELD');
  });

  test('phishing_assessment: null → treated as absent (conformant)', () => {
    const r = validateDecryptedBeapContent(
      baseContent({ ai_analysis_json: { phishing_assessment: null } }),
    );
    expect(r.validation_reason).toBeNull();
  });

  test('validation_crosscheck: null → treated as absent (conformant)', () => {
    const r = validateDecryptedBeapContent(
      baseContent({ ai_analysis_json: { validation_crosscheck: null } }),
    );
    expect(r.validation_reason).toBeNull();
  });
});
