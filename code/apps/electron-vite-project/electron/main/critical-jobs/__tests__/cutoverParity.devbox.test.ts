/**
 * B.5.2 dev-box parity — validate-decrypted-beap with the REAL validator
 * subprocess (no mock). Boots the SAME singleton `validatorOrchestrator` the seam
 * uses, then for a corpus of decrypted-BEAP requests asserts the seam's
 * ValidateResponse is byte-identical to the inline call on the substantive field
 * (the validated `canonical_json` / rejection reason and the accept/reject
 * outcome). Per B.4.2 / lifecycle L5, the per-call seal nonce, request_id, and
 * timestamps are allowed to differ and are not compared.
 *
 * Requires a forkable tsx subprocess (the dev box). It is NOT mocked; if the
 * subprocess cannot start the test fails loudly rather than faking a seal.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'module'
import { resolve, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import type { ValidateRequest, ValidateResponse } from '@repo/ingestion-core'
import { validatorOrchestrator, setValidatorWorkerPath } from '../../validator-process/orchestrator'
import { deriveTestSealKey } from '../../validator-process/test-session'
import { dispatchValidateDecryptedBeap } from '../liveValidationCutover'

const _require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const WORKER_TS = resolve(__dirname, '../../validator-process/index.ts')

class TestVault {
  private readonly key = deriveTestSealKey()
  deriveApplicationKey(_info: string): Buffer {
    return Buffer.from(this.key)
  }
}

function provenance(): Omit<ValidateRequest, 'request_id'>['provenance'] {
  return {
    source_type: 'email',
    origin_classification: 'external',
    ingested_at: new Date().toISOString(),
    transport_metadata: {},
    input_classification: 'beap_capsule_present',
    raw_input_hash: 'a'.repeat(64),
    ingestor_version: '1.0.0',
  }
}

function req(content: string, targetRowId: string): Omit<ValidateRequest, 'request_id'> {
  return {
    envelope: {},
    plaintext_or_encrypted: { kind: 'plaintext', content },
    provenance: provenance(),
    target_row_id: targetRowId,
  }
}

const internalDraft = JSON.stringify({
  schema_version: 1,
  capsule_type: 'internal_draft',
  timestamp: '2026-01-01T00:00:00.000Z',
  content: 'parity body',
})
const initiate = JSON.stringify({
  schema_version: 1,
  capsule_type: 'initiate',
  handshake_id: 'hs-parity',
  sender_id: 'user-1',
  capsule_hash: 'a'.repeat(64),
  timestamp: '2026-01-01T00:00:00.000Z',
  wrdesk_policy_hash: 'b'.repeat(64),
  seq: 1,
  sender_public_key: 'c'.repeat(64),
  sender_signature: 'd'.repeat(128),
})

// Decrypted-BEAP corpus: accept cases + reject cases.
const CORPUS: ReadonlyArray<{ name: string; content: string }> = [
  { name: 'valid internal_draft', content: internalDraft },
  { name: 'valid initiate', content: initiate },
  { name: 'missing schema_version (reject)', content: JSON.stringify({ capsule_type: 'internal_draft', timestamp: '2026-01-01T00:00:00.000Z' }) },
  { name: 'non-JSON garbage (reject)', content: 'not-json-at-all' },
]

describe('B.5.2 dev-box parity — validate-decrypted-beap (real validator subprocess)', () => {
  beforeAll(async () => {
    process.env.WRDESK_ROLE = 'sandbox' // deterministic in-process resolution
    setValidatorWorkerPath(WORKER_TS)
    const tsx = pathToFileURL(_require.resolve('tsx/esm')).href
    await validatorOrchestrator.start(
      new TestVault() as unknown as import('../../vault/service').VaultService,
      ['--import', tsx],
    )
  }, 30_000)

  afterAll(async () => {
    await validatorOrchestrator.stop()
    delete process.env.WRDESK_ROLE
  })

  test('the subprocess is actually running (no mock, no fake seal)', () => {
    expect(validatorOrchestrator.getLiveness()).toBe('running')
  })

  for (let i = 0; i < CORPUS.length; i++) {
    const { name, content } = CORPUS[i]
    test(`parity: ${name}`, async () => {
      const rowId = `parity-row-${i}`
      const inline: ValidateResponse = await validatorOrchestrator.validate(req(content, rowId))
      const seamOut = await dispatchValidateDecryptedBeap(req(content, rowId))

      expect(seamOut.ok).toBe(true)
      if (!seamOut.ok) return
      const seam = seamOut.value

      // Same accept/reject verdict.
      expect(seam.outcome.ok).toBe(inline.outcome.ok)

      if (inline.outcome.ok && seam.outcome.ok) {
        // Byte-identical validated content (the bytes the validator approved).
        expect(seam.outcome.sealed.canonical_json).toBe(inline.outcome.sealed.canonical_json)
        expect(seam.outcome.sealed.validator_version).toBe(inline.outcome.sealed.validator_version)
      } else if (!inline.outcome.ok && !seam.outcome.ok) {
        expect(seam.outcome.sealed_quarantine.rejection_reason).toBe(
          inline.outcome.sealed_quarantine.rejection_reason,
        )
      }
    })
  }
})
