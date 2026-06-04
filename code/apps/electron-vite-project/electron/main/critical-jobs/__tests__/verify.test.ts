/**
 * verify.ts — depackage signature + safe-text re-validation gate.
 */

import { describe, test, expect } from 'vitest'
import { ed25519, x25519 } from '@noble/curves/ed25519'
import { runDepackagingJob } from '../../depackaging-microvm/depackagingWorker'
import { signJobResult, type JobResult } from '../../depackaging-microvm/hypervisorProvider'
import { depackageJobResultToCriticalResult, verifyDepackageResult } from '../verify'

function pub(): string {
  return Buffer.from(x25519.getPublicKey(x25519.utils.randomPrivateKey())).toString('base64')
}

function realResult() {
  const job = runDepackagingJob({
    jobId: 'v1',
    kind: 'depackage',
    inputBytes: Buffer.from('Subject: hi\r\n\r\nbody text'),
    sandboxPeerX25519PubB64: pub(),
  })
  return depackageJobResultToCriticalResult(job)
}

describe('verifyDepackageResult', () => {
  test('passes for a genuine signed worker result and returns validated safe-text', () => {
    const r = verifyDepackageResult(realResult())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.output.safeText.schema).toBe('safe-text/v1')
      expect(r.output.safeText.body_text).toContain('body text')
    }
  })

  test('E_SIGNATURE_INVALID when safe-text is tampered after signing', () => {
    const good = realResult()
    const tampered = {
      ...good,
      output: { safeText: { ...good.output!.safeText, body_text: 'mutated' }, artifacts: good.output!.artifacts },
    }
    const r = verifyDepackageResult(tampered)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('E_SIGNATURE_INVALID')
  })

  test('E_SAFETEXT_REJECTED when a validly-signed result carries an invalid safe-text', () => {
    // Sign over a safe-text that is structurally invalid (extra key). The
    // signature is valid, but the closed-schema re-validation must reject it.
    const badSafeText = {
      schema: 'safe-text/v1',
      subject: 'x',
      body_text: 'y',
      attachment_refs: [],
      smuggled: 'nope',
    }
    const base = { jobId: 'bad1', ok: true as const, safeText: badSafeText as never, artifacts: [] }
    const priv = ed25519.utils.randomPrivateKey()
    const sig = signJobResult(base as unknown as JobResult, priv)
    priv.fill(0)
    const result = {
      jobId: 'bad1',
      ok: true,
      output: { safeText: badSafeText as never, artifacts: [] },
      ...sig,
    }
    const r = verifyDepackageResult(result)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('E_SAFETEXT_REJECTED')
  })
})
