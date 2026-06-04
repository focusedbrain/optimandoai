/**
 * INVARIANT 2 — Blind courier.
 *
 * Proves the orchestrator, given EVERYTHING it stores (safe-text + ciphertext +
 * blob handles), has NO path to plaintext: no decrypt export, no private key in
 * the stored record, and decryption is possible ONLY with the sandbox's X25519
 * private key. Custody round-trips through the EXISTING audited
 * `decryptQuarantineBlob` — proving reuse, not reinvention.
 */

import { describe, test, expect } from 'vitest'
import { x25519 } from '@noble/curves/ed25519'
import { depackage } from '../depackagingWorker'
import { toCourierRecord } from '../blindCourier'
import * as blindCourierModule from '../blindCourier'
import { validateSafeText } from '../safeText'
import { decryptQuarantineBlob } from '../../quarantine-encrypt/index'
import { runDepackagingJob } from '../depackagingWorker'

const SECRET_MARKER = 'TOP-SECRET-ATTACHMENT-PAYLOAD-9f3a'

function makeSandboxKeys() {
  const priv = x25519.utils.randomPrivateKey()
  const pub = x25519.getPublicKey(priv)
  return {
    privB64: Buffer.from(priv).toString('base64'),
    pubB64: Buffer.from(pub).toString('base64'),
  }
}

function craftEmailWithSecretAttachment(): Buffer {
  const boundary = 'B0UND'
  return Buffer.from(
    [
      'Subject: with secret',
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain',
      '',
      'public body',
      `--${boundary}`,
      'Content-Type: application/octet-stream',
      'Content-Disposition: attachment; filename="secret.bin"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(SECRET_MARKER).toString('base64'),
      `--${boundary}--`,
      '',
    ].join('\r\n'),
    'utf8',
  )
}

describe('Invariant 2 — blind courier', () => {
  const sandbox = makeSandboxKeys()
  const out = depackage(craftEmailWithSecretAttachment(), sandbox.pubB64)
  const validated = validateSafeText(out.safeText)
  expect(validated.ok).toBe(true)
  const record = toCourierRecord(
    { jobId: 'j1', ok: true, safeText: out.safeText, artifacts: out.artifacts },
    (validated as { ok: true; value: any }).value,
  )

  test('the blind-courier module exposes NO decrypt/unwrap capability', () => {
    const exported = Object.keys(blindCourierModule)
    for (const name of exported) {
      expect(name.toLowerCase()).not.toMatch(/decrypt|unwrap|private|priv/)
    }
  })

  test('everything the orchestrator stores contains no plaintext and no private key', () => {
    const serialized = JSON.stringify(record)
    // The attachment plaintext marker must be absent from the entire stored record.
    expect(serialized).not.toContain(SECRET_MARKER)
    // No private-key fields of any kind.
    expect(serialized.toLowerCase()).not.toContain('private')
    expect(serialized).not.toContain('priv')
  })

  test('decryption is impossible without the sandbox private key (wrong key fails)', () => {
    const wrong = makeSandboxKeys()
    const artifact = record.artifacts[0]!
    const res = decryptQuarantineBlob(artifact.ciphertext, wrong.privB64)
    expect(res.ok).toBe(false)
  })

  test('ONLY the sandbox private key recovers the original (reuse of audited primitive)', () => {
    const artifact = record.artifacts.find((a) => a.content_type === 'application/octet-stream')!
    const res = decryptQuarantineBlob(artifact.ciphertext, sandbox.privB64)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.plaintext.toString('utf8')).toBe(SECRET_MARKER)
  })

  test('job result is signed and verification fails if safe-text is tampered', async () => {
    const { verifyJobResultSignature } = await import('../hypervisorProvider')
    const job = runDepackagingJob({
      jobId: 'j2',
      kind: 'depackage',
      inputBytes: craftEmailWithSecretAttachment(),
      sandboxPeerX25519PubB64: sandbox.pubB64,
    })
    expect(job.ok).toBe(true)
    expect(verifyJobResultSignature(job)).toBe(true)
    const tampered = { ...job, safeText: { ...job.safeText!, body_text: 'mutated' } }
    expect(verifyJobResultSignature(tampered as any)).toBe(false)
  })
})
