/**
 * Exhaustive tests for stage attestation types + verification (Phase 1.3).
 *
 * Proves:
 *   - CCH (canonical-content hash) stability across NFC-equivalent and
 *     line-ending-variant inputs.
 *   - Valid 2-stage and 3-stage attestation chains verify ok.
 *   - Every failure mode is caught: missing stage, reordered chain, broken
 *     link, differing CCH, tampered final text, detection_result: 'reject'.
 */

import { describe, test, expect } from 'vitest'
import {
  canonicalContentHash,
  createStageAttestation,
  hashAttestation,
  verifyAttestationChain,
  GENESIS_HASH,
  type StageAttestation,
} from '../stageAttestation'
import { pad, padLayers } from '../padTransform'

// ── Helpers ────────────────────────────────────────────────────────────────

function buildChain(
  originalText: string,
  stages: Array<{ location: string }>,
): { attestations: StageAttestation[]; finalPaddedText: string } {
  const cch = canonicalContentHash(originalText)
  const attestations: StageAttestation[] = []
  let text = originalText

  for (let i = 0; i < stages.length; i++) {
    text = pad(text)
    const att = createStageAttestation(
      i + 1,
      stages[i].location,
      cch,
      text,
      i === 0 ? null : attestations[i - 1],
      1000 + i,
    )
    attestations.push(att)
  }

  return { attestations, finalPaddedText: text }
}

// ── CCH stability ─────────────────────────────────────────────────────────

describe('canonicalContentHash — normalization stability', () => {
  test('same text produces same hash', () => {
    const h1 = canonicalContentHash('Hello World')
    const h2 = canonicalContentHash('Hello World')
    expect(h1).toBe(h2)
  })

  test('is a 64-char hex string (SHA-256)', () => {
    const h = canonicalContentHash('test')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  test('CRLF and LF produce same hash', () => {
    const lf = canonicalContentHash('line1\nline2\nline3')
    const crlf = canonicalContentHash('line1\r\nline2\r\nline3')
    expect(crlf).toBe(lf)
  })

  test('CR-only and LF produce same hash', () => {
    const lf = canonicalContentHash('line1\nline2')
    const cr = canonicalContentHash('line1\rline2')
    expect(cr).toBe(lf)
  })

  test('mixed line endings produce same hash', () => {
    const lf = canonicalContentHash('a\nb\nc\n')
    const mixed = canonicalContentHash('a\r\nb\rc\n')
    expect(mixed).toBe(lf)
  })

  test('NFC-equivalent strings produce same hash', () => {
    // é as NFC (U+00E9) vs NFD (U+0065 U+0301)
    const nfc = canonicalContentHash('\u00E9')
    const nfd = canonicalContentHash('\u0065\u0301')
    expect(nfd).toBe(nfc)
  })

  test('NFC + CRLF combined produce same hash', () => {
    const a = canonicalContentHash('caf\u00E9\nworld')
    const b = canonicalContentHash('cafe\u0301\r\nworld')
    expect(b).toBe(a)
  })

  test('empty string has a deterministic hash', () => {
    const h1 = canonicalContentHash('')
    const h2 = canonicalContentHash('')
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
  })

  test('different texts produce different hashes', () => {
    const h1 = canonicalContentHash('alpha')
    const h2 = canonicalContentHash('beta')
    expect(h1).not.toBe(h2)
  })

  test('CJK text hash is stable', () => {
    const text = '你好世界'
    expect(canonicalContentHash(text)).toBe(canonicalContentHash(text))
  })

  test('emoji/surrogate pair text hash is stable', () => {
    const text = '😀🇺🇸👨‍👩‍👧‍👦'
    expect(canonicalContentHash(text)).toBe(canonicalContentHash(text))
  })
})

// ── GENESIS_HASH ──────────────────────────────────────────────────────────

describe('GENESIS_HASH', () => {
  test('is a 64-char hex string', () => {
    expect(GENESIS_HASH).toMatch(/^[0-9a-f]{64}$/)
  })

  test('is SHA-256 of "genesis"', () => {
    const { createHash } = require('node:crypto')
    const expected = createHash('sha256').update('genesis', 'utf-8').digest('hex')
    expect(GENESIS_HASH).toBe(expected)
  })
})

// ── createStageAttestation ────────────────────────────────────────────────

describe('createStageAttestation', () => {
  test('stage 1 uses GENESIS_HASH as prior', () => {
    const cch = canonicalContentHash('hello')
    const padded = pad('hello')
    const att = createStageAttestation(1, 'sandbox', cch, padded, null, 1000)
    expect(att.stage_id).toBe(1)
    expect(att.stage_location).toBe('sandbox')
    expect(att.canonical_content_hash).toBe(cch)
    expect(att.detection_result).toBe('pass')
    expect(att.prior_attestation_hash).toBe(GENESIS_HASH)
    expect(att.timestamp).toBe(1000)
    expect(att.padded_form_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('stage 2 chains to stage 1', () => {
    const cch = canonicalContentHash('hello')
    const p1 = pad('hello')
    const att1 = createStageAttestation(1, 'sandbox', cch, p1, null, 1000)
    const p2 = pad(p1)
    const att2 = createStageAttestation(2, 'host_vm', cch, p2, att1, 1001)
    expect(att2.prior_attestation_hash).toBe(hashAttestation(att1))
  })

  test('padded_form_hash is SHA-256 of the padded text', () => {
    const { createHash } = require('node:crypto')
    const text = 'abcdefghijklmnopqrst'
    const padded = pad(text)
    const cch = canonicalContentHash(text)
    const att = createStageAttestation(1, 'test', cch, padded, null, 1000)
    const expected = createHash('sha256').update(Buffer.from(padded, 'utf-8')).digest('hex')
    expect(att.padded_form_hash).toBe(expected)
  })
})

// ── hashAttestation determinism ───────────────────────────────────────────

describe('hashAttestation', () => {
  test('same attestation produces same hash', () => {
    const cch = canonicalContentHash('test')
    const att = createStageAttestation(1, 'loc', cch, pad('test'), null, 1000)
    expect(hashAttestation(att)).toBe(hashAttestation(att))
  })

  test('different attestations produce different hashes', () => {
    const cch = canonicalContentHash('test')
    const att1 = createStageAttestation(1, 'loc', cch, pad('test'), null, 1000)
    const att2 = createStageAttestation(1, 'loc', cch, pad('test'), null, 2000)
    expect(hashAttestation(att1)).not.toBe(hashAttestation(att2))
  })
})

// ── Valid chain verification ──────────────────────────────────────────────

describe('verifyAttestationChain — valid chains', () => {
  test('valid 2-stage chain (single-machine)', () => {
    const original = 'A normal email body with enough content to test.'
    const { attestations } = buildChain(original, [
      { location: 'host_vm' },
      { location: 'host' },
    ])
    const finalDepadded = original
    const result = verifyAttestationChain(attestations, finalDepadded, 2)
    expect(result).toEqual({ ok: true })
  })

  test('valid 3-stage chain (dedicated)', () => {
    const original = 'Dedicated sandbox email: 你好 café Straße 😀'
    const { attestations } = buildChain(original, [
      { location: 'dedicated_sandbox' },
      { location: 'host_vm' },
      { location: 'host' },
    ])
    const finalDepadded = original
    const result = verifyAttestationChain(attestations, finalDepadded, 3)
    expect(result).toEqual({ ok: true })
  })

  test('valid chain with NFC-equivalent final text', () => {
    // Original with NFD é, which NFC-normalizes the same
    const original = 'caf\u00E9'
    const { attestations } = buildChain(original, [
      { location: 'sandbox' },
      { location: 'host' },
    ])
    // Final text presented as NFD — CCH normalization makes it match
    const finalDepadded = 'cafe\u0301'
    const result = verifyAttestationChain(attestations, finalDepadded, 2)
    expect(result).toEqual({ ok: true })
  })

  test('valid chain with CRLF-variant final text', () => {
    const original = 'line1\nline2'
    const { attestations } = buildChain(original, [
      { location: 'vm' },
      { location: 'host' },
    ])
    const finalDepadded = 'line1\r\nline2'
    const result = verifyAttestationChain(attestations, finalDepadded, 2)
    expect(result).toEqual({ ok: true })
  })

  test('valid chain with empty text', () => {
    const original = ''
    const { attestations } = buildChain(original, [
      { location: 'vm' },
      { location: 'host' },
    ])
    const result = verifyAttestationChain(attestations, original, 2)
    expect(result).toEqual({ ok: true })
  })
})

// ── Failure cases ─────────────────────────────────────────────────────────

describe('verifyAttestationChain — missing stage', () => {
  test('expected 3 but got 2 → fail', () => {
    const { attestations } = buildChain('text', [
      { location: 'sandbox' },
      { location: 'host' },
    ])
    const result = verifyAttestationChain(attestations, 'text', 3)
    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toContain('expected 3 stages, got 2')
  })

  test('expected 2 but got 3 → fail', () => {
    const { attestations } = buildChain('text', [
      { location: 'a' },
      { location: 'b' },
      { location: 'c' },
    ])
    const result = verifyAttestationChain(attestations, 'text', 2)
    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toContain('expected 2 stages, got 3')
  })

  test('empty attestation list → fail', () => {
    const result = verifyAttestationChain([], 'text', 2)
    expect(result.ok).toBe(false)
  })

  test('expected 0 stages → fail', () => {
    const result = verifyAttestationChain([], '', 0)
    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toContain('at least 1 stage')
  })
})

describe('verifyAttestationChain — broken chain link', () => {
  test('stage 1 prior is not genesis → fail', () => {
    const { attestations } = buildChain('text', [
      { location: 'sandbox' },
      { location: 'host' },
    ])
    const tampered: StageAttestation[] = [
      { ...attestations[0], prior_attestation_hash: 'not_genesis_hash' },
      attestations[1],
    ]
    const result = verifyAttestationChain(tampered, 'text', 2)
    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toContain('genesis')
  })

  test('stage 2 prior does not match hash of stage 1 → fail', () => {
    const { attestations } = buildChain('text', [
      { location: 'sandbox' },
      { location: 'host' },
    ])
    const tampered: StageAttestation[] = [
      attestations[0],
      { ...attestations[1], prior_attestation_hash: 'aaaa'.repeat(16) },
    ]
    const result = verifyAttestationChain(tampered, 'text', 2)
    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toContain('stage 2')
    expect((result as { reason: string }).reason).toContain('does not match')
  })

  test('stage 3 prior broken in 3-stage chain → fail', () => {
    const { attestations } = buildChain('text here', [
      { location: 'a' },
      { location: 'b' },
      { location: 'c' },
    ])
    const tampered: StageAttestation[] = [
      attestations[0],
      attestations[1],
      { ...attestations[2], prior_attestation_hash: 'bbbb'.repeat(16) },
    ]
    const result = verifyAttestationChain(tampered, 'text here', 3)
    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toContain('stage 3')
  })
})

describe('verifyAttestationChain — reordered stages', () => {
  test('stages swapped → chain link fails', () => {
    const { attestations } = buildChain('text', [
      { location: 'a' },
      { location: 'b' },
    ])
    const swapped = [attestations[1], attestations[0]]
    const result = verifyAttestationChain(swapped, 'text', 2)
    expect(result.ok).toBe(false)
  })

  test('wrong stage_id sequence → fail', () => {
    const { attestations } = buildChain('text', [
      { location: 'a' },
      { location: 'b' },
    ])
    const wrongId: StageAttestation[] = [
      { ...attestations[0], stage_id: 2 },
      attestations[1],
    ]
    const result = verifyAttestationChain(wrongId, 'text', 2)
    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toContain('stage_id')
  })
})

describe('verifyAttestationChain — differing CCH between stages', () => {
  test('stage 2 has different CCH → fail', () => {
    const { attestations } = buildChain('text', [
      { location: 'a' },
      { location: 'b' },
    ])
    const tampered: StageAttestation[] = [
      attestations[0],
      { ...attestations[1], canonical_content_hash: 'cccc'.repeat(16) },
    ]
    const result = verifyAttestationChain(tampered, 'text', 2)
    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toContain('canonical_content_hash')
    expect((result as { reason: string }).reason).toContain('differs')
  })

  test('stage 3 has different CCH in 3-stage → fail', () => {
    const { attestations } = buildChain('text', [
      { location: 'a' },
      { location: 'b' },
      { location: 'c' },
    ])
    const tampered: StageAttestation[] = [
      attestations[0],
      attestations[1],
      { ...attestations[2], canonical_content_hash: 'dddd'.repeat(16) },
    ]
    const result = verifyAttestationChain(tampered, 'text', 3)
    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toContain('canonical_content_hash')
  })
})

describe('verifyAttestationChain — CCH ≠ hash(de-padded text) (tampered content)', () => {
  test('final text differs from original → fail', () => {
    const { attestations } = buildChain('original text', [
      { location: 'a' },
      { location: 'b' },
    ])
    const result = verifyAttestationChain(attestations, 'tampered text', 2)
    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toContain('does not match')
    expect((result as { reason: string }).reason).toContain('de-padded')
  })

  test('final text with extra char → fail', () => {
    const original = 'Hello World'
    const { attestations } = buildChain(original, [
      { location: 'vm' },
      { location: 'host' },
    ])
    const result = verifyAttestationChain(attestations, original + '!', 2)
    expect(result.ok).toBe(false)
  })

  test('empty vs non-empty → fail', () => {
    const { attestations } = buildChain('content', [
      { location: 'a' },
      { location: 'b' },
    ])
    const result = verifyAttestationChain(attestations, '', 2)
    expect(result.ok).toBe(false)
  })
})

describe('verifyAttestationChain — detection_result: reject', () => {
  test('stage 1 detection_result = reject → fail', () => {
    const { attestations } = buildChain('text', [
      { location: 'a' },
      { location: 'b' },
    ])
    const tampered: StageAttestation[] = [
      { ...attestations[0], detection_result: 'reject' },
      attestations[1],
    ]
    const result = verifyAttestationChain(tampered, 'text', 2)
    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toContain('reject')
    expect((result as { reason: string }).reason).toContain('stage 1')
  })

  test('stage 2 detection_result = reject → fail', () => {
    const { attestations } = buildChain('text', [
      { location: 'a' },
      { location: 'b' },
    ])
    const tampered: StageAttestation[] = [
      attestations[0],
      { ...attestations[1], detection_result: 'reject' },
    ]
    const result = verifyAttestationChain(tampered, 'text', 2)
    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toContain('reject')
    expect((result as { reason: string }).reason).toContain('stage 2')
  })

  test('middle stage reject in 3-stage chain → fail', () => {
    const { attestations } = buildChain('text', [
      { location: 'a' },
      { location: 'b' },
      { location: 'c' },
    ])
    const tampered: StageAttestation[] = [
      attestations[0],
      { ...attestations[1], detection_result: 'reject' },
      attestations[2],
    ]
    const result = verifyAttestationChain(tampered, 'text', 3)
    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toContain('stage 2')
  })
})

// ── Integration: full round-trip with padTransform ────────────────────────

describe('integration: full round-trip with real padding', () => {
  test('3-stage chain with CJK + emoji text', () => {
    const original = '你好 café 😀 Straße مرحبا test1234567890'
    const cch = canonicalContentHash(original)

    let text = original

    // Stage 1: dedicated sandbox
    text = pad(text)
    const att1 = createStageAttestation(1, 'dedicated_sandbox', cch, text, null, 100)

    // Stage 2: host VM
    text = pad(text)
    const att2 = createStageAttestation(2, 'host_vm', cch, text, att1, 200)

    // Stage 3: host
    text = pad(text)
    const att3 = createStageAttestation(3, 'host', cch, text, att2, 300)

    // Verify the chain with the original text as de-padded final
    const result = verifyAttestationChain([att1, att2, att3], original, 3)
    expect(result).toEqual({ ok: true })
  })

  test('2-stage chain with line endings and NFC variants', () => {
    const original = 'caf\u00E9\nworld\nmore lines here and padding'
    const cch = canonicalContentHash(original)

    let text = original
    text = pad(text)
    const att1 = createStageAttestation(1, 'host_vm', cch, text, null, 100)
    text = pad(text)
    const att2 = createStageAttestation(2, 'host', cch, text, att1, 200)

    // Final text with CRLF (CCH normalization handles this)
    const finalDepadded = 'cafe\u0301\r\nworld\r\nmore lines here and padding'
    const result = verifyAttestationChain([att1, att2], finalDepadded, 2)
    expect(result).toEqual({ ok: true })
  })
})

// ── Determinism ───────────────────────────────────────────────────────────

describe('determinism: same inputs → same attestation hashes', () => {
  test('createStageAttestation is deterministic with fixed timestamp', () => {
    const cch = canonicalContentHash('hello world')
    const padded = pad('hello world')
    const a1 = createStageAttestation(1, 'loc', cch, padded, null, 999)
    const a2 = createStageAttestation(1, 'loc', cch, padded, null, 999)
    expect(hashAttestation(a1)).toBe(hashAttestation(a2))
    expect(a1).toEqual(a2)
  })
})
