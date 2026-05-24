/**
 * Test utilities for sealed-storage property tests.
 *
 * Extracted from the now-deleted validator-process/index.ts (P1.12).
 * These are pure cryptographic helpers with no subprocess dependency;
 * they exist only to support structural-property tests that need to
 * create seals in the old validator-process format (nonce-bearing).
 *
 * MUST NOT be imported in production code.
 */

import { createHash, createHmac, randomBytes } from 'node:crypto'
import { hkdfSync } from 'crypto'
import { CONTENT_VALIDATOR_VERSION } from '@repo/ingestion-core'
import type { ValidateRequest } from '@repo/ingestion-core'
import { validatorOrchestrator } from './inProcessValidator'
import type { VaultService } from '../vault/service'

const VALIDATOR_VERSION = CONTENT_VALIDATOR_VERSION

/**
 * Compute a seal with an externally-supplied key (tests call this directly).
 * Uses the nonce-bearing format from the original validator-process/index.ts.
 */
export function computeSealForTest(
  canonicalJson: string,
  targetRowId: string,
  outcomeClass: 'validated' | 'rejected',
  validatorVersion: string,
  timestampUtc: string,
  key: Buffer,
): { seal: string; sealInputJson: string } {
  const contentSha256 = createHash('sha256').update(canonicalJson, 'utf8').digest('hex')
  const nonce = randomBytes(32).toString('base64')

  const sealInput = {
    content_sha256: contentSha256,
    nonce,
    row_id: targetRowId,
    outcome_class: outcomeClass,
    validator_version: validatorVersion,
    validated_at: timestampUtc,
  }

  const sealInputJson = JSON.stringify(sealInput)
  const seal = createHmac('sha256', key).update(sealInputJson, 'utf8').digest('base64')

  return { seal, sealInputJson }
}

/** Verify a seal against a known key. */
export function verifySeal(sealInputJson: string, expectedSeal: string, key: Buffer): boolean {
  const recomputed = createHmac('sha256', key).update(sealInputJson, 'utf8').digest('base64')
  const a = Buffer.from(recomputed, 'base64')
  const b = Buffer.from(expectedSeal, 'base64')
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

/**
 * Deterministic 32-byte synthetic vault master key for tests.
 * Stable across test runs; never present in production builds.
 */
const TEST_VAULT_MASTER_KEY = Buffer.from(
  'beap-test-vault-master-key-v1-B1-do-not-use-in-production-0000000',
  'utf8',
).subarray(0, 32)

/** Derive the test seal key from the synthetic vault master key. */
export function deriveTestSealKey(): Buffer {
  const result = hkdfSync(
    'sha256',
    TEST_VAULT_MASTER_KEY,
    Buffer.from('beap-application-key-derivation-v1'),
    Buffer.from('validator-seal-key-v1'),
    32,
  )
  return Buffer.from(result)
}

/** Build a minimal ValidateRequest for use in tests. */
export function makeTestValidateRequest(
  content = '{"capsule_type":"beap_message","schema_version":1,"attachments_canonical":[]}',
): Omit<ValidateRequest, 'request_id'> {
  return {
    target_row_id: 'test-row-id',
    plaintext_or_encrypted: {
      kind: 'plaintext',
      content,
    },
  }
}

export interface TestValidatorHandle {
  readonly orchestrator: typeof validatorOrchestrator
  readonly testSealKey: Buffer
  stop(): Promise<void>
}

/**
 * Start the in-process validator backed by the synthetic test vault.
 * Replaces the old startTestValidator() which forked a subprocess.
 */
export async function startTestValidator(): Promise<TestValidatorHandle> {
  const testSealKey = deriveTestSealKey()
  const mockVault: VaultService = {
    deriveApplicationKey: () => Buffer.from(testSealKey),
    destroy: () => {},
  } as unknown as VaultService

  await validatorOrchestrator.start(mockVault)
  return {
    orchestrator: validatorOrchestrator,
    testSealKey,
    stop: async () => {
      await validatorOrchestrator.stop()
    },
  }
}
