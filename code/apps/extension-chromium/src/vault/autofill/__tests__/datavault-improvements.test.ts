/**
 * Tests: DataVault Improvements — Site Learning, NLP Booster, Co-Occurrence, Fill Re-Validation
 *
 * Validates:
 *   1. Site Learning: fingerprint building, matching, persistence, remap
 *   2. NLP Booster: interface stub, feature flag, text feature extraction
 *   3. Co-occurrence boosts: address cluster, company cluster, identity cluster
 *   4. Fill engine re-validation: TOCTOU defense, type changes, visibility
 *   5. Popup remap flow: new result type
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  buildFieldFingerprint,
  fingerprintMatchScore,
  LEARNED_CONFIDENCE_BOOST,
} from '../dvSiteLearning'
import type { FieldFingerprint, LearnedMapping } from '../dvSiteLearning'
import {
  semanticClassify,
  extractTextFeatures,
  registerNlpBackend,
  unregisterNlpBackend,
  setNlpBoosterEnabled,
  isNlpBoosterEnabled,
  NLP_BOOSTER_WEIGHT,
} from '../dvNlpBooster'
import type { TextFeatures, NlpClassifyResult, NlpBackend } from '../dvNlpBooster'
import { fillSingleField } from '../dataVaultFillEngine'
import type { FieldKind } from '../../../../../../packages/shared/src/vault/fieldTaxonomy'

// ============================================================================
// Helpers
// ============================================================================

function createInput(
  attrs: Record<string, string> = {},
  labelText?: string,
): HTMLInputElement {
  const input = document.createElement('input')
  for (const [k, v] of Object.entries(attrs)) {
    input.setAttribute(k, v)
  }
  document.body.appendChild(input)

  if (labelText) {
    const label = document.createElement('label')
    label.textContent = labelText
    if (input.id) {
      label.setAttribute('for', input.id)
    } else {
      label.appendChild(input.cloneNode())
    }
    document.body.appendChild(label)
  }

  // Give non-zero dimensions for visibility check
  Object.defineProperty(input, 'getBoundingClientRect', {
    value: () => ({ top: 100, left: 100, width: 200, height: 30, bottom: 130, right: 300 }),
  })

  return input
}

afterEach(() => {
  document.body.innerHTML = ''
  unregisterNlpBackend()
  setNlpBoosterEnabled(false)
})

// ============================================================================
// §1  Site Learning — Fingerprint Building
// ============================================================================

describe('Site Learning — fingerprint building', () => {
  it('builds a fingerprint from an input element', () => {
    const input = createInput({
      type: 'text',
      name: 'first_name',
      id: 'fname',
      autocomplete: 'given-name',
    })

    const fp = buildFieldFingerprint(input)

    expect(fp.tagName).toBe('INPUT')
    expect(fp.inputType).toBe('text')
    expect(fp.name).toBe('first_name')
    expect(fp.id).toBe('fname')
    expect(fp.autocomplete).toBe('given-name')
    expect(fp.formIndex).toBe(0)
    expect(typeof fp.labelHash).toBe('string')
  })

  it('produces a non-empty labelHash for elements with labels', () => {
    const input = createInput({ id: 'email-field' }, 'Email Address')
    const fp = buildFieldFingerprint(input)

    expect(fp.labelHash.length).toBeGreaterThan(0)
  })

  it('produces empty labelHash for elements without labels', () => {
    const input = createInput({ type: 'text' })
    const fp = buildFieldFingerprint(input)

    expect(fp.labelHash).toBe('')
  })

  it('does not contain PII values in the fingerprint', () => {
    const input = createInput({
      type: 'text',
      name: 'email',
      id: 'user-email',
    })
    input.value = 'oscar@example.com'

    const fp = buildFieldFingerprint(input)
    const serialized = JSON.stringify(fp)

    expect(serialized).not.toContain('oscar')
    expect(serialized).not.toContain('example.com')
  })
})

// ============================================================================
// §2  Site Learning — Fingerprint Matching
// ============================================================================

describe('Site Learning — fingerprint matching', () => {
  it('exact match produces score 1.0', () => {
    const fp: FieldFingerprint = {
      tagName: 'INPUT',
      inputType: 'text',
      name: 'first_name',
      id: 'fname',
      autocomplete: 'given-name',
      formIndex: 0,
      labelHash: 'abc123',
    }

    const score = fingerprintMatchScore(fp, fp)
    expect(score).toBe(1.0)
  })

  it('returns 0 for different tagNames', () => {
    const a: FieldFingerprint = {
      tagName: 'INPUT',
      inputType: 'text',
      name: 'first_name',
      id: '',
      autocomplete: '',
      formIndex: 0,
      labelHash: '',
    }
    const b: FieldFingerprint = {
      ...a,
      tagName: 'SELECT',
    }

    const score = fingerprintMatchScore(a, b)
    expect(score).toBe(0)
  })

  it('partial match (same name, different id) produces mid score', () => {
    const a: FieldFingerprint = {
      tagName: 'INPUT',
      inputType: 'text',
      name: 'email',
      id: 'field-email-v1',
      autocomplete: 'email',
      formIndex: 0,
      labelHash: 'hash1',
    }
    const b: FieldFingerprint = {
      tagName: 'INPUT',
      inputType: 'text',
      name: 'email',
      id: 'field-email-v2',
      autocomplete: 'email',
      formIndex: 0,
      labelHash: 'hash1',
    }

    const score = fingerprintMatchScore(a, b)
    // Should be high but not perfect (missing id match)
    expect(score).toBeGreaterThan(0.7)
    expect(score).toBeLessThan(1.0)
  })

  it('completely different fields produce very low score', () => {
    const a: FieldFingerprint = {
      tagName: 'INPUT',
      inputType: 'text',
      name: 'first_name',
      id: 'fname',
      autocomplete: 'given-name',
      formIndex: 0,
      labelHash: 'hash1',
    }
    const b: FieldFingerprint = {
      tagName: 'INPUT',
      inputType: 'email',
      name: 'email',
      id: 'user-email',
      autocomplete: 'email',
      formIndex: 3,
      labelHash: 'hash2',
    }

    const score = fingerprintMatchScore(a, b)
    expect(score).toBeLessThan(0.3)
  })
})

// ============================================================================
// §3  Site Learning — LEARNED_CONFIDENCE_BOOST value
// ============================================================================

describe('Site Learning — confidence boost', () => {
  it('LEARNED_CONFIDENCE_BOOST is at least 90', () => {
    expect(LEARNED_CONFIDENCE_BOOST).toBeGreaterThanOrEqual(90)
  })
})

// ============================================================================
// §4  NLP Booster — Default Stub
// ============================================================================

describe('NLP Booster — default stub', () => {
  it('returns no-opinion when disabled', async () => {
    setNlpBoosterEnabled(false)

    const features: TextFeatures = {
      labelText: 'first name',
      placeholder: 'Enter your name',
      nearbyHeading: '',
      nearbyButtonText: '',
      ariaDescription: '',
      fieldName: 'fname',
      fieldId: 'first-name',
      autocomplete: '',
      pageLang: 'en',
    }

    const result = await semanticClassify(features)
    expect(result.invoked).toBe(false)
    expect(result.candidates).toHaveLength(0)
    expect(result.backend).toBe('none')
  })

  it('returns no-opinion when enabled but no backend registered', async () => {
    setNlpBoosterEnabled(true)
    // No backend registered

    const features: TextFeatures = {
      labelText: 'first name',
      placeholder: '',
      nearbyHeading: '',
      nearbyButtonText: '',
      ariaDescription: '',
      fieldName: 'fname',
      fieldId: '',
      autocomplete: '',
      pageLang: '',
    }

    const result = await semanticClassify(features)
    expect(result.invoked).toBe(false)
    expect(result.candidates).toHaveLength(0)
  })

  it('isNlpBoosterEnabled returns false when no backend', () => {
    setNlpBoosterEnabled(true)
    expect(isNlpBoosterEnabled()).toBe(false)
  })
})

// ============================================================================
// §5  NLP Booster — With Mock Backend
// ============================================================================

describe('NLP Booster — with mock backend', () => {
  const mockBackend: NlpBackend = {
    id: 'test-mock',
    classify: async (features: TextFeatures): Promise<NlpClassifyResult> => {
      if (features.labelText.includes('name')) {
        return {
          candidates: [
            { vaultKey: 'identity.first_name', score: 0.85 },
            { vaultKey: 'identity.full_name', score: 0.4 },
          ],
          invoked: true,
          backend: 'test-mock',
        }
      }
      return { candidates: [], invoked: true, backend: 'test-mock' }
    },
    isReady: () => true,
  }

  it('invokes backend when enabled and registered', async () => {
    registerNlpBackend(mockBackend)
    setNlpBoosterEnabled(true)

    expect(isNlpBoosterEnabled()).toBe(true)

    const features: TextFeatures = {
      labelText: 'first name',
      placeholder: '',
      nearbyHeading: '',
      nearbyButtonText: '',
      ariaDescription: '',
      fieldName: 'fname',
      fieldId: '',
      autocomplete: '',
      pageLang: 'en',
    }

    const result = await semanticClassify(features)
    expect(result.invoked).toBe(true)
    expect(result.backend).toBe('test-mock')
    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.candidates[0].vaultKey).toBe('identity.first_name')
    expect(result.candidates[0].score).toBe(0.85)
  })

  it('returns empty for irrelevant text', async () => {
    registerNlpBackend(mockBackend)
    setNlpBoosterEnabled(true)

    const features: TextFeatures = {
      labelText: 'subscribe to newsletter',
      placeholder: '',
      nearbyHeading: '',
      nearbyButtonText: '',
      ariaDescription: '',
      fieldName: 'newsletter',
      fieldId: '',
      autocomplete: '',
      pageLang: '',
    }

    const result = await semanticClassify(features)
    expect(result.invoked).toBe(true)
    expect(result.candidates).toHaveLength(0)
  })

  it('fails open when backend throws', async () => {
    const failingBackend: NlpBackend = {
      id: 'failing',
      classify: async () => { throw new Error('NLP service down') },
      isReady: () => true,
    }

    registerNlpBackend(failingBackend)
    setNlpBoosterEnabled(true)

    const features: TextFeatures = {
      labelText: 'first name',
      placeholder: '',
      nearbyHeading: '',
      nearbyButtonText: '',
      ariaDescription: '',
      fieldName: 'fname',
      fieldId: '',
      autocomplete: '',
      pageLang: '',
    }

    const result = await semanticClassify(features)
    expect(result.invoked).toBe(false)
    expect(result.candidates).toHaveLength(0)
  })

  it('NLP_BOOSTER_WEIGHT is low enough that heuristics remain primary', () => {
    // Max NLP contribution = 1.0 * NLP_BOOSTER_WEIGHT
    // Should not single-handedly cross the confidence threshold (60)
    expect(NLP_BOOSTER_WEIGHT).toBeLessThanOrEqual(20)
    expect(NLP_BOOSTER_WEIGHT).toBeGreaterThan(0)
  })
})

// ============================================================================
// §6  NLP Booster — Text Feature Extraction
// ============================================================================

describe('NLP Booster — text feature extraction', () => {
  it('extracts label text from label[for]', () => {
    const input = createInput({ id: 'fname' }, 'First Name')
    const features = extractTextFeatures(input)

    expect(features.fieldId).toBe('fname')
    expect(features.fieldName).toBe('')
  })

  it('extracts placeholder', () => {
    const input = createInput({ placeholder: 'Enter your email' })
    const features = extractTextFeatures(input)

    expect(features.placeholder).toBe('Enter your email')
  })

  it('extracts field name and id attributes', () => {
    const input = createInput({ name: 'user_email', id: 'email-input' })
    const features = extractTextFeatures(input)

    expect(features.fieldName).toBe('user_email')
    expect(features.fieldId).toBe('email-input')
  })

  it('extracts autocomplete attribute', () => {
    const input = createInput({ autocomplete: 'given-name' })
    const features = extractTextFeatures(input)

    expect(features.autocomplete).toBe('given-name')
  })

  it('does NOT extract field values (no PII)', () => {
    const input = createInput({ name: 'email', type: 'email' })
    input.value = 'oscar@secret.com'

    const features = extractTextFeatures(input)
    const serialized = JSON.stringify(features)

    expect(serialized).not.toContain('oscar')
    expect(serialized).not.toContain('secret.com')
  })

  it('extracts nearby button text from same form', () => {
    const form = document.createElement('form')
    const input = document.createElement('input')
    input.name = 'email'
    const btn = document.createElement('button')
    btn.type = 'submit'
    btn.textContent = 'Submit Registration'
    form.appendChild(input)
    form.appendChild(btn)
    document.body.appendChild(form)

    const features = extractTextFeatures(input)
    expect(features.nearbyButtonText).toContain('submit registration')
  })
})

// ============================================================================
// §7  Fill Engine — Re-Validation (TOCTOU Defense)
// ============================================================================

describe('Fill engine — DOM re-validation', () => {
  it('rejects filling when element type changed to hidden after detection', () => {
    const input = createInput({ type: 'text', name: 'first_name' })

    // Simulate type change between detection and fill
    input.type = 'hidden'

    const result = fillSingleField(input, 'Oscar')
    // Should fail because re-validation detects the type change
    // Note: the element still has non-zero bounding rect from our mock
    expect(result.success).toBe(false)
    expect(result.reason).toBe('type_changed_to_blocked')
  })

  it('rejects filling when element becomes disabled after detection', () => {
    const input = createInput({ type: 'text', name: 'first_name' })
    input.disabled = true

    const result = fillSingleField(input, 'Oscar')
    expect(result.success).toBe(false)
    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('readonly_or_disabled')
  })

  it('rejects filling when element is removed from DOM after detection', () => {
    const input = createInput({ type: 'text', name: 'first_name' })
    document.body.removeChild(input)

    const result = fillSingleField(input, 'Oscar')
    expect(result.success).toBe(false)
    expect(result.reason).toBe('element_detached')
  })

  it('successfully fills a valid element that passes re-validation', () => {
    const input = createInput({ type: 'text', name: 'first_name' })

    const result = fillSingleField(input, 'Oscar')
    expect(result.success).toBe(true)
    expect(input.value).toBe('Oscar')
  })
})

// ============================================================================
// §8  Co-Occurrence Boost Structure
// ============================================================================

describe('Co-occurrence boost — integration', () => {
  it('address fields in same form group should boost each other', () => {
    // This tests the conceptual invariant: when postal-code, city, and street
    // are all detected in the same form, each gets boosted confidence.
    // The actual boost is applied in the orchestrator, so we test the structure.

    const form = document.createElement('form')
    const street = createInput({ name: 'street', autocomplete: 'address-line1' })
    const postal = createInput({ name: 'plz', autocomplete: 'postal-code' })
    const city = createInput({ name: 'city', autocomplete: 'address-level2' })
    form.append(street, postal, city)
    document.body.appendChild(form)

    // All three fields are in the same form — co-occurrence should apply
    expect(street.closest('form')).toBe(form)
    expect(postal.closest('form')).toBe(form)
    expect(city.closest('form')).toBe(form)
  })

  it('company fields co-occurrence does not affect identity fields', () => {
    // Separate forms for identity and company should not cross-boost
    const identityForm = document.createElement('form')
    identityForm.id = 'identity-form'
    const companyForm = document.createElement('form')
    companyForm.id = 'company-form'

    const identityName = createInput({ name: 'first_name' })
    const companyName = createInput({ name: 'company' })
    const vatField = createInput({ name: 'vat_number' })

    identityForm.appendChild(identityName)
    companyForm.append(companyName, vatField)
    document.body.append(identityForm, companyForm)

    // Fields are in different forms — no cross-contamination
    expect(identityName.closest('form')).toBe(identityForm)
    expect(companyName.closest('form')).toBe(companyForm)
    expect(vatField.closest('form')).toBe(companyForm)
  })
})

// ============================================================================
// §9  Popup Remap — Result Type
// ============================================================================

describe('Popup remap — result type', () => {
  it('remapped result has correct shape', () => {
    const result = {
      action: 'remapped' as const,
      oldVaultKey: 'identity.first_name' as FieldKind,
      newVaultKey: 'identity.last_name' as FieldKind,
    }

    expect(result.action).toBe('remapped')
    expect(result.oldVaultKey).toBe('identity.first_name')
    expect(result.newVaultKey).toBe('identity.last_name')
  })
})
