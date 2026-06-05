/**
 * B.5 proof obligations for the validation cutover (flag-on path):
 *
 *  1. Parity — validate-native-beap: dispatching through the seam yields a
 *     ValidationResult byte-identical to the inline `validateCapsule`, across a
 *     corpus of wire-path candidates (valid + adversarial).
 *  2. Parity — validate-decrypted-beap: the seam forwards the exact ValidateRequest
 *     to the same host-side validator and returns its ValidateResponse unchanged
 *     (proven with a mocked orchestrator, since the real one is a subprocess).
 *  3. Fail-closed — with a table lacking the transitional rules, a workstation
 *     dispatch of a validate kind yields E_NO_EXECUTOR (no implicit in-process
 *     fallback). The live sites map this to quarantine / retry, never an insert.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { validateCapsule } from '@repo/ingestion-core'
import type { ValidateResponse } from '@repo/ingestion-core'
import type { CandidateCapsuleEnvelope, ProvenanceMetadata } from '../../ingestion/types'

// ── Mock the validator subprocess so the decrypted-beap leg is exercisable in a
//    unit context. The InProcessExecutor dynamically imports this exact module.
const sentinelResponse: ValidateResponse = {
  request_id: 'will-be-overwritten',
  outcome: { ok: true, sealed: { canonical_json: '{"ok":true}' } as never },
}
const validateMock = vi.fn(async () => sentinelResponse)
vi.mock('../../validator-process/orchestrator', () => ({
  validatorOrchestrator: { validate: (req: unknown) => validateMock(req) },
}))

import {
  dispatchValidateNativeBeap,
  dispatchValidateDecryptedBeap,
} from '../liveValidationCutover'
import { CriticalJobDispatcher } from '../dispatcher'
import { InProcessExecutor } from '../executors/inProcessExecutor'
import { RemoteHandshakeExecutor } from '../executors/remoteHandshakeExecutor'
import type { ResolutionTable } from '../resolution'

/**
 * Strip volatile fields (timestamps) the spec permits to differ between two
 * independent validations (B.4.2: jobIds/timestamps/signatures may differ).
 */
function stripVolatile<T>(value: T): T {
  const VOLATILE = new Set(['validated_at', 'ingested_at', 'timestamp'])
  const clone = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(clone)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (VOLATILE.has(k)) continue
        out[k] = clone(val)
      }
      return out
    }
    return v
  }
  return clone(value) as T
}

function makeProvenance(): ProvenanceMetadata {
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

function makeCandidate(payload: unknown): CandidateCapsuleEnvelope {
  return {
    __brand: 'CandidateCapsule',
    provenance: makeProvenance(),
    raw_payload: payload,
    ingestion_error_flag: false,
  }
}

function validInitiate(): Record<string, unknown> {
  return {
    schema_version: 1,
    capsule_type: 'initiate',
    handshake_id: 'hs-001',
    sender_id: 'user-1',
    capsule_hash: 'a'.repeat(64),
    timestamp: '2026-01-01T00:00:00.000Z',
    wrdesk_policy_hash: 'b'.repeat(64),
    seq: 1,
    sender_public_key: 'c'.repeat(64),
    sender_signature: 'd'.repeat(128),
  }
}

// Wire-path corpus: a valid capsule plus several adversarial / malformed payloads.
const NATIVE_BEAP_CORPUS: ReadonlyArray<{ name: string; payload: unknown }> = [
  { name: 'valid initiate', payload: validInitiate() },
  { name: 'missing schema_version', payload: (() => { const p = validInitiate(); delete p.schema_version; return p })() },
  { name: 'unknown capsule_type', payload: { ...validInitiate(), capsule_type: 'unknown' } },
  { name: 'null payload', payload: null },
  { name: 'array payload', payload: [1, 2, 3] },
  { name: 'oversized field', payload: { ...validInitiate(), sender_id: 'x'.repeat(100_000) } },
]

describe('B.5 parity — validate-native-beap (seam vs inline validateCapsule)', () => {
  beforeEach(() => {
    process.env.WRDESK_ROLE = 'sandbox' // deterministic in-process resolution
  })
  afterEach(() => {
    delete process.env.WRDESK_ROLE
  })

  for (const { name, payload } of NATIVE_BEAP_CORPUS) {
    test(`parity: ${name}`, async () => {
      const candidate = makeCandidate(payload)
      const inline = validateCapsule(candidate)
      const out = await dispatchValidateNativeBeap(candidate)
      expect(out.ok).toBe(true)
      // Byte-identical modulo the timestamp the validator stamps per call.
      if (out.ok) expect(stripVolatile(out.value)).toEqual(stripVolatile(inline))
    })
  }
})

describe('B.5 parity — validate-decrypted-beap (seam forwards request, returns response unchanged)', () => {
  beforeEach(() => {
    process.env.WRDESK_ROLE = 'sandbox'
    validateMock.mockClear()
  })
  afterEach(() => {
    delete process.env.WRDESK_ROLE
  })

  test('the seam passes the identical request to the validator and returns its response', async () => {
    const input = {
      envelope: { kind: 'qbeap' } as never,
      plaintext_or_encrypted: { kind: 'plaintext' as const, content: '{"capsule":"x"}' },
      provenance: {} as never,
      target_row_id: 'row-1',
    }
    const out = await dispatchValidateDecryptedBeap(input)
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.value).toBe(sentinelResponse)
    // Forwarded byte-for-byte: same object the inline path would have passed.
    expect(validateMock).toHaveBeenCalledTimes(1)
    expect(validateMock).toHaveBeenCalledWith(input)
  })
})

describe('B.5 fail-closed — no transitional rule → E_NO_EXECUTOR, no in-process fallback', () => {
  // A table that does NOT grant the workstation transitional in-process rule.
  const NO_TRANSITIONAL_TABLE: ResolutionTable = [
    {
      role: 'workstation',
      perKind: {
        // Only the remote stub (unavailable in this build) — no in-process.
        'validate-native-beap': { executorId: 'remote-handshake' },
        'validate-decrypted-beap': { executorId: 'remote-handshake' },
      },
    },
  ]

  test('workstation validate-native-beap fails closed with E_NO_EXECUTOR', async () => {
    const inProcess = new InProcessExecutor('workstation')
    const runSpy = vi.spyOn(inProcess, 'run')
    const dispatcher = new CriticalJobDispatcher(
      { 'in-process': inProcess, 'remote-handshake': new RemoteHandshakeExecutor() },
      NO_TRANSITIONAL_TABLE,
      { role: 'workstation', tier: 'free', topology: { linked: [] } },
    )
    const res = await dispatcher.dispatch({
      jobId: 'fc1',
      kind: 'validate-native-beap',
      input: { candidate: makeCandidate(validInitiate()) },
      limits: { maxWallClockMs: 5000 },
      flush: 'session',
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('E_NO_EXECUTOR')
    // The in-process executor was never silently used as a fallback (INV-3).
    expect(runSpy).not.toHaveBeenCalled()
  })
})
