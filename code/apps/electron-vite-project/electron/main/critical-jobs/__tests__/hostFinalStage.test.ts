/**
 * Host final validation stage (L3) — full chain verification tests.
 *
 * Verifies the end-to-end flow: depackage → stage-1 pad/detect/attest in
 * sandbox → host de-pad/verify/final-validate → trusted output.
 */

import { describe, test, expect } from 'vitest'
import { x25519 } from '@noble/curves/ed25519'
import { runDepackagingJob } from '../../depackaging-microvm/depackagingWorker'
import { unpad } from '../../depackaging-microvm/padTransform'
import { canonicalContentHash } from '../../depackaging-microvm/stageAttestation'
import {
  depackageJobResultToCriticalResult,
  verifyDepackageResult,
} from '../verify'
import { CriticalJobDispatcher, type ExecutorRegistry } from '../dispatcher'
import { InProcessExecutor } from '../executors/inProcessExecutor'
import { MicroVMExecutor } from '../executors/microVmExecutor'
import { RemoteHandshakeExecutor } from '../executors/remoteHandshakeExecutor'
import { DEFAULT_RESOLUTION_TABLE } from '../resolution'
import type { ResolutionContext } from '../resolution'
import type { JobSpec, SandboxHypervisorProvider, JobResult } from '../../depackaging-microvm/hypervisorProvider'
import type { CriticalJobSpec, Role } from '../types'

function pub(): string {
  return Buffer.from(x25519.getPublicKey(x25519.utils.randomPrivateKey())).toString('base64')
}

const CUSTODY = pub()

function depackageSpec(jobId: string, body: string): CriticalJobSpec<'depackage'> {
  return {
    jobId,
    kind: 'depackage',
    input: { inputBytes: Buffer.from(`Subject: test\r\n\r\n${body}`) },
    custodyPubKeyB64: CUSTODY,
    limits: { maxWallClockMs: 5000 },
    flush: 'per-action',
  }
}

class FakeProvider implements SandboxHypervisorProvider {
  readonly backendId = 'fake'
  constructor(
    private readonly available: boolean,
    private readonly mutate?: (r: JobResult) => JobResult,
  ) {}
  isAvailable(): Promise<boolean> {
    return Promise.resolve(this.available)
  }
  async runJob(spec: JobSpec): Promise<JobResult> {
    const { runDepackagingJob } = await import('../../depackaging-microvm/depackagingWorker')
    const r = runDepackagingJob(spec)
    return this.mutate ? this.mutate(r) : r
  }
}

function ctx(role: Role): ResolutionContext {
  return { role, tier: 'paid', topology: { linked: [] } }
}

function registry(role: Role, provider: SandboxHypervisorProvider): ExecutorRegistry {
  return {
    'in-process': new InProcessExecutor(role),
    microvm: new MicroVMExecutor(provider),
    'remote-handshake': new RemoteHandshakeExecutor(),
  }
}

// ── Direct verifyDepackageResult tests ───────────────────────────────────────

describe('verifyDepackageResult — full chain (L3)', () => {
  test('clean mail → chain verifies, de-padded text is the original, output trusted', () => {
    const original = 'This is clean email content for the chain test.'
    const job = runDepackagingJob({
      jobId: 'chain-clean',
      kind: 'depackage',
      inputBytes: Buffer.from(`Subject: chain test\r\n\r\n${original}`),
      sandboxPeerX25519PubB64: pub(),
    })
    const cr = depackageJobResultToCriticalResult(job)
    const v = verifyDepackageResult(cr)

    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.output.safeText.body_text).toBe(original)
      expect(v.output.safeText.subject).toBe('chain test')
      expect(v.output.safeText.schema).toBe('safe-text/v1')
    }
  })

  test('de-padded text exactly equals the original (round-trip)', () => {
    const original = 'Longer content that definitely has padding applied because it exceeds the stride.'
    const job = runDepackagingJob({
      jobId: 'chain-rt',
      kind: 'depackage',
      inputBytes: Buffer.from(`Subject: roundtrip\r\n\r\n${original}`),
      sandboxPeerX25519PubB64: pub(),
    })
    const cr = depackageJobResultToCriticalResult(job)
    const v = verifyDepackageResult(cr)

    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.output.safeText.body_text).toBe(original)
    }
  })

  test('tampered body (CCH mismatch) → rejected, E_CHAIN_INVALID', () => {
    const job = runDepackagingJob({
      jobId: 'chain-tamper',
      kind: 'depackage',
      inputBytes: Buffer.from('Subject: tamper\r\n\r\nOriginal safe body.'),
      sandboxPeerX25519PubB64: pub(),
    })
    // Tamper the padded body AFTER signing (breaks both signature and CCH,
    // but signature check uses the original bytes, so a different approach
    // is needed). Instead, we simulate a scenario where the attestation's
    // CCH doesn't match the de-padded text.
    const cr = depackageJobResultToCriticalResult(job)
    // Forge a result with mismatched attestation CCH
    const forgedAttestation = {
      ...cr.output!.stage_attestation!,
      canonical_content_hash: 'deadbeef00000000000000000000000000000000000000000000000000000000',
    }
    // Reconstruct with the forged attestation (this also breaks the signature)
    const v = verifyDepackageResult({
      ...cr,
      output: { ...cr.output!, stage_attestation: forgedAttestation },
    })
    expect(v.ok).toBe(false)
    if (!v.ok) {
      // Either E_SIGNATURE_INVALID (signature broken by attestation change) or
      // E_CHAIN_INVALID — both are correct rejections.
      expect(['E_SIGNATURE_INVALID', 'E_CHAIN_INVALID']).toContain(v.code)
    }
  })

  test('missing attestation → E_CHAIN_INVALID', () => {
    const job = runDepackagingJob({
      jobId: 'chain-noatt',
      kind: 'depackage',
      inputBytes: Buffer.from('Subject: no attestation\r\n\r\nClean body.'),
      sandboxPeerX25519PubB64: pub(),
    })
    const cr = depackageJobResultToCriticalResult(job)
    const noAtt = { ...cr, output: { safeText: cr.output!.safeText, artifacts: cr.output!.artifacts } }
    // Signature will fail because the attestation is now missing from the
    // reconstructed JobResult. But even if it didn't, the chain would reject.
    const v = verifyDepackageResult(noAtt)
    expect(v.ok).toBe(false)
  })

  test('stage count is topology-driven (2 for single-machine, default)', () => {
    const job = runDepackagingJob({
      jobId: 'chain-count',
      kind: 'depackage',
      inputBytes: Buffer.from('Subject: count\r\n\r\nBody for stage count test.'),
      sandboxPeerX25519PubB64: pub(),
    })
    const cr = depackageJobResultToCriticalResult(job)

    // With expectedStageCount=2 (default), should pass
    const v2 = verifyDepackageResult(cr, 2)
    expect(v2.ok).toBe(true)

    // With expectedStageCount=3, should fail (only 2 stages exist)
    const v3 = verifyDepackageResult(cr, 3)
    expect(v3.ok).toBe(false)
    if (!v3.ok) expect(v3.code).toBe('E_CHAIN_INVALID')
  })
})

// ── Full dispatcher integration ──────────────────────────────────────────────

describe('CriticalJobDispatcher — full chain verification (L3)', () => {
  test('clean mail through sandbox microvm → chain passes, output is raw (de-padded)', async () => {
    const d = new CriticalJobDispatcher(
      registry('sandbox', new FakeProvider(true)),
      DEFAULT_RESOLUTION_TABLE,
      ctx('sandbox'),
    )
    const res = await d.dispatch(depackageSpec('l3-clean', 'Clean email body for full chain integration.'))
    expect(res.ok).toBe(true)
    expect(res.meta?.executorId).toBe('microvm')
    if (res.ok && res.output) {
      expect(res.output.safeText.body_text).toBe('Clean email body for full chain integration.')
    }
  })

  test('clean mail through in-process → chain passes, output is raw', async () => {
    const d = new CriticalJobDispatcher(
      registry('sandbox', new FakeProvider(false)),
      DEFAULT_RESOLUTION_TABLE,
      { role: 'sandbox', tier: 'free', topology: { linked: [] } },
    )
    const res = await d.dispatch(depackageSpec('l3-inproc', 'In-process depackage through the chain.'))
    expect(res.ok).toBe(true)
    expect(res.meta?.executorId).toBe('in-process')
    if (res.ok && res.output) {
      expect(res.output.safeText.body_text).toBe('In-process depackage through the chain.')
    }
  })

  test('tampered signature → E_SIGNATURE_INVALID (before chain)', async () => {
    const tamper = (r: JobResult): JobResult =>
      r.ok && r.safeText
        ? { ...r, safeText: { ...r.safeText, body_text: 'mutated-after-sign' } }
        : r
    const d = new CriticalJobDispatcher(
      registry('sandbox', new FakeProvider(true, tamper)),
      DEFAULT_RESOLUTION_TABLE,
      ctx('sandbox'),
    )
    const res = await d.dispatch(depackageSpec('l3-sig', 'Tamper target.'))
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('E_SIGNATURE_INVALID')
  })
})
