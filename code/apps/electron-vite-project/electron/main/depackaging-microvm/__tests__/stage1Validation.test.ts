/**
 * Stage-1 validation integration tests (L2).
 *
 * Verifies the validation chain wiring: depackage worker → stage-1 detection +
 * pad + attestation → signed result with padded text + attestation.
 */

import { describe, test, expect } from 'vitest'
import { x25519 } from '@noble/curves/ed25519'
import { runDepackagingJob } from '../depackagingWorker'
import { pad, unpad } from '../padTransform'
import { canonicalContentHash, GENESIS_HASH, hashAttestation } from '../stageAttestation'
import { applyStage1Validation, Stage1DetectionError } from '../stage1Validation'
import { constructSafeText } from '../safeText'
import { verifyJobResultSignature } from '../hypervisorProvider'
import type { StageAttestation } from '../stageAttestation'

function pub(): string {
  return Buffer.from(x25519.getPublicKey(x25519.utils.randomPrivateKey())).toString('base64')
}

// ── applyStage1Validation unit tests ─────────────────────────────────────────

describe('applyStage1Validation', () => {
  test('pads body_text and subject, produces valid attestation', () => {
    const raw = constructSafeText({
      subjectRaw: 'Hello world',
      plainTextBodyRaw: 'This is a test message with enough text to trigger padding.',
      attachmentBlobIds: [],
    })
    const { paddedSafeText, attestation } = applyStage1Validation(raw, 'crosvm-guest')

    expect(paddedSafeText.body_text).toBe(pad(raw.body_text))
    expect(paddedSafeText.subject).toBe(pad(raw.subject))
    expect(paddedSafeText.schema).toBe('safe-text/v1')
    expect(paddedSafeText.attachment_refs).toEqual(raw.attachment_refs)

    expect(attestation.stage_id).toBe(1)
    expect(attestation.stage_location).toBe('crosvm-guest')
    expect(attestation.detection_result).toBe('pass')
    expect(attestation.prior_attestation_hash).toBe(GENESIS_HASH)
    expect(attestation.canonical_content_hash).toBe(canonicalContentHash(raw.body_text))
  })

  test('round-trip: unpad recovers original text', () => {
    const raw = constructSafeText({
      subjectRaw: 'Test subject',
      plainTextBodyRaw: 'Body with twenty chars or more for full padding coverage.',
      attachmentBlobIds: [],
    })
    const { paddedSafeText } = applyStage1Validation(raw)

    expect(unpad(paddedSafeText.body_text)).toBe(raw.body_text)
    expect(unpad(paddedSafeText.subject)).toBe(raw.subject)
  })

  test('CCH in attestation matches canonicalContentHash of raw body', () => {
    const raw = constructSafeText({
      subjectRaw: 'Sub',
      plainTextBodyRaw: 'Raw body content for CCH verification.',
      attachmentBlobIds: [],
    })
    const { attestation } = applyStage1Validation(raw)
    expect(attestation.canonical_content_hash).toBe(canonicalContentHash(raw.body_text))
  })

  test('fail closed: body_text with eval() → Stage1DetectionError', () => {
    const raw = constructSafeText({
      subjectRaw: 'Safe subject',
      plainTextBodyRaw: 'Innocent text with eval(code) embedded.',
      attachmentBlobIds: [],
    })
    expect(() => applyStage1Validation(raw)).toThrow(Stage1DetectionError)
    try {
      applyStage1Validation(raw)
    } catch (e) {
      const err = e as Stage1DetectionError
      expect(err.field).toBe('body_text')
      expect(err.findings.length).toBeGreaterThan(0)
      expect(err.findings[0].category).toBe('code_construct')
    }
  })

  test('fail closed: subject with <script → Stage1DetectionError', () => {
    const raw = constructSafeText({
      subjectRaw: 'Check <script src',
      plainTextBodyRaw: 'Safe body text here.',
      attachmentBlobIds: [],
    })
    expect(() => applyStage1Validation(raw)).toThrow(Stage1DetectionError)
    try {
      applyStage1Validation(raw)
    } catch (e) {
      const err = e as Stage1DetectionError
      expect(err.field).toBe('subject')
    }
  })

  test('empty body_text → passes (empty is safe)', () => {
    const raw = constructSafeText({
      subjectRaw: '',
      plainTextBodyRaw: '',
      attachmentBlobIds: [],
    })
    const { paddedSafeText, attestation } = applyStage1Validation(raw)
    expect(paddedSafeText.body_text).toBe('')
    expect(paddedSafeText.subject).toBe('')
    expect(attestation.stage_id).toBe(1)
    expect(attestation.detection_result).toBe('pass')
  })

  test('attachment_refs are preserved unchanged', () => {
    const refs = ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', '11111111-2222-3333-4444-555555555555']
    const raw = constructSafeText({
      subjectRaw: 'Test',
      plainTextBodyRaw: 'Body',
      attachmentBlobIds: refs,
    })
    const { paddedSafeText } = applyStage1Validation(raw)
    expect(paddedSafeText.attachment_refs).toEqual(refs)
  })
})

// ── Integration with runDepackagingJob ────────────────────────────────────────

describe('runDepackagingJob — stage-1 attestation', () => {
  test('clean mail → result has padded text + valid stage-1 attestation', () => {
    const result = runDepackagingJob({
      jobId: 's1-clean',
      kind: 'depackage',
      inputBytes: Buffer.from('Subject: hello\r\n\r\nThis is a clean email body for testing.'),
      sandboxPeerX25519PubB64: pub(),
    })

    expect(result.ok).toBe(true)
    expect(result.safeText).toBeDefined()
    expect(result.stage_attestation).toBeDefined()

    const att = result.stage_attestation!
    expect(att.stage_id).toBe(1)
    expect(att.prior_attestation_hash).toBe(GENESIS_HASH)
    expect(att.detection_result).toBe('pass')

    const rawBody = unpad(result.safeText!.body_text)
    expect(rawBody).toContain('clean email body')
    expect(att.canonical_content_hash).toBe(canonicalContentHash(rawBody))
  })

  test('signature covers padded text + attestation', () => {
    const result = runDepackagingJob({
      jobId: 's1-sig',
      kind: 'depackage',
      inputBytes: Buffer.from('Subject: sig test\r\n\r\nSigned content with padding.'),
      sandboxPeerX25519PubB64: pub(),
    })

    expect(result.ok).toBe(true)
    expect(verifyJobResultSignature(result)).toBe(true)
  })

  test('tampered attestation breaks signature', () => {
    const result = runDepackagingJob({
      jobId: 's1-tamper',
      kind: 'depackage',
      inputBytes: Buffer.from('Subject: tamper test\r\n\r\nOriginal content.'),
      sandboxPeerX25519PubB64: pub(),
    })

    expect(result.ok).toBe(true)
    const tampered = {
      ...result,
      stage_attestation: { ...result.stage_attestation!, stage_location: 'attacker' } as StageAttestation,
    }
    expect(verifyJobResultSignature(tampered)).toBe(false)
  })

  test('mail with embedded eval → fail closed, signed rejection, no attestation', () => {
    const result = runDepackagingJob({
      jobId: 's1-eval',
      kind: 'depackage',
      inputBytes: Buffer.from('Subject: danger\r\n\r\nPlease run eval(payload) to continue.'),
      sandboxPeerX25519PubB64: pub(),
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('stage-1 detection')
    expect(result.stage_attestation).toBeUndefined()
  })

  test('padded text round-trips: unpad → original', () => {
    const original = 'A longer body that exceeds ten code points for padding.'
    const result = runDepackagingJob({
      jobId: 's1-rt',
      kind: 'depackage',
      inputBytes: Buffer.from(`Subject: roundtrip\r\n\r\n${original}`),
      sandboxPeerX25519PubB64: pub(),
    })

    expect(result.ok).toBe(true)
    const rawBody = unpad(result.safeText!.body_text)
    expect(rawBody).toBe(original)
  })

  test('CCH in attestation == canonicalContentHash(original body)', () => {
    const original = 'Content for CCH integrity check across stages.'
    const result = runDepackagingJob({
      jobId: 's1-cch',
      kind: 'depackage',
      inputBytes: Buffer.from(`Subject: cch\r\n\r\n${original}`),
      sandboxPeerX25519PubB64: pub(),
    })

    expect(result.ok).toBe(true)
    const rawBody = unpad(result.safeText!.body_text)
    expect(result.stage_attestation!.canonical_content_hash).toBe(canonicalContentHash(rawBody))
  })
})
