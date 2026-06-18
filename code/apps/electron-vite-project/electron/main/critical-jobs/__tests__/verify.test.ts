/**
 * verify.ts — depackage signature + safe-text re-validation + defense-in-depth.
 *
 * Post-padding-teardown: the host final stage is:
 *   1. Ed25519 signature verification (transport integrity / VM provenance)
 *   2. validateSafeText (L5 schema + L2 blocklist)
 *   3. detectThreats (L3 defense-in-depth)
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

  test('E_SAFETEXT_REJECTED when safe-text has extra keys (schema re-validation)', () => {
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

  test('E_SAFETEXT_REJECTED when body contains threat (defense-in-depth detection)', () => {
    const threatSafeText = {
      schema: 'safe-text/v1' as const,
      subject: 'test',
      body_text: 'malicious eval(code) injection',
      attachment_refs: [] as string[],
    }
    const base = { jobId: 'threat1', ok: true as const, safeText: threatSafeText, artifacts: [] }
    const priv = ed25519.utils.randomPrivateKey()
    const sig = signJobResult(base, priv)
    priv.fill(0)
    const result = {
      jobId: 'threat1',
      ok: true,
      output: { safeText: threatSafeText, artifacts: [] },
      ...sig,
    }
    const r = verifyDepackageResult(result)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('E_SAFETEXT_REJECTED')
  })

  test('E_SAFETEXT_REJECTED when result has missing safe-text', () => {
    const base = { jobId: 'notext', ok: true as const, safeText: undefined, artifacts: [] }
    const priv = ed25519.utils.randomPrivateKey()
    const sig = signJobResult(base as unknown as JobResult, priv)
    priv.fill(0)
    const result = {
      jobId: 'notext',
      ok: true,
      output: { safeText: undefined as never, artifacts: [] },
      ...sig,
    }
    const r = verifyDepackageResult(result)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('E_SAFETEXT_REJECTED')
  })

  test('host stage no longer references padTransform or stageAttestation', () => {
    const r = verifyDepackageResult(realResult())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect((r.output as Record<string, unknown>).stage_attestation).toBeUndefined()
    }
  })

  test('detectThreats still runs as defense-in-depth (clean text passes)', () => {
    const r = verifyDepackageResult(realResult())
    expect(r.ok).toBe(true)
  })
})
